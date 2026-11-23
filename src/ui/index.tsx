import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { render } from 'ink';
import { startArtifactChannel, type ArtifactChannel } from '../agents/artifacts.js';
import { startQuestionChannel } from '../agents/ask-user.js';
import type { CodingAgent } from '../agents/types.js';
import { detectAgents } from '../agents/discovery.js';
import { createAgentInspector, type AgentInspector } from '../agents/status.js';
import { sendSession } from '../agents/sessions/send.js';
import { knownLimits } from '../agents/sessions/limits.js';
import { readTopics } from '../agents/sessions/topics.js';
import { topicShares } from '../agents/sessions/shares.js';
import { partsSince } from '../agents/sessions/window.js';
import type { EmbeddedWeb as PublicEmbeddedWeb, EmbeddedWebBundleOptions } from '../ui.js';
import {
  createChatController,
  NoAgentError,
  type ChatController,
  type ChatOptions,
  type WebHandoff,
} from './controller.js';
import { ChatApp } from './tui/app.js';
import {
  agentSessionSources,
  answerAsk,
  archiveSessions,
  isSameDir,
  listSessions,
  pendingAsks,
  readConversations,
  startProjectChannel,
} from '../agents/sessions/index.js';
import { createUploads } from './uploads.js';
import { createProjectFiles } from './files.js';
import { startWebUi, type HostApp, type HostUpdate, type WebAsset, type WebUi } from './web/server.js';

export { NoAgentError };

/**
 * Interactive front ends for `genaicode chat` and `genaicode ui`.
 *
 * This module is bundled with Ink and React into `dist/ui/`, so the library itself keeps
 * no UI dependencies. The CLI loads it only for these two commands, and the Vite plugin
 * (`genaicode/vite`) for `startEmbeddedWeb`.
 */
export interface UiRunOptions extends ChatOptions {
  agents: readonly CodingAgent[];
  sessionAgents?: readonly CodingAgent[];
  version: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadStream;
  signal?: AbortSignal;
  /** Sent as soon as the chat opens. */
  firstPrompt?: string;
  /** A session to take over before anything is sent (`ChatController.continueSession`). */
  continueFrom?: string;
}

export interface WebRunOptions extends UiRunOptions {
  /** `genaicode chat --web`: open the browser on the terminal's session right away. */
  openWeb?: boolean;
  host?: string;
  port?: number;
  /** The link's access token. Default: a random one. */
  token?: string;
  /** The app that shows the page under `exitWithStdin`. */
  hostApp?: HostApp;
  open?: boolean;
  /** Browser bundle. Default: `web-client.js` next to this module. */
  clientScript?: string;
  /** Mascot and bark. Default: the `assets/` folder next to this module. */
  assets?: ReadonlyMap<string, WebAsset>;
  /** Opens the link. Default: the system browser. */
  openUrl?(url: string): void;
  /**
   * Stop when stdin ends (`--exit-with-stdin`): a host app that starts the server through a
   * launcher such as npx stops it by closing the pipe, which also reaches the server itself.
   */
  exitWithStdin?: boolean;
  /**
   * The page names no project (`ui --no-project`): the chat is about the sessions of every
   * project, and the directory it runs in is only where its own agent starts.
   */
  noProject?: boolean;
  /**
   * Per-conversation working directory mode (`ui --home`): no fixed project folder; each
   * conversation resolves its own cwd, starting in `~/.genaicode/home`.
   */
  home?: boolean;
}

const ASSET_TYPES: Record<string, string> = {
  'wolf-64.png': 'image/png',
  'wolf.webp': 'image/webp',
  'wolf-dark.webp': 'image/webp',
  'bark.mp3': 'audio/mpeg',
};

/** The web UI's static files; a missing one only means no picture or no sound. */
export function loadAssets(dir: URL): Map<string, WebAsset> {
  const assets = new Map<string, WebAsset>();
  for (const [name, type] of Object.entries(ASSET_TYPES)) {
    const file = new URL(name, dir);
    if (existsSync(file)) assets.set(name, { type, body: readFileSync(file) });
  }
  return assets;
}

/** The agent's way to publish artifacts. A port that will not open only means no artifacts. */
async function openArtifacts(
  options: ChatOptions,
  getController?: () => ChatController | undefined,
): Promise<ArtifactChannel | undefined> {
  if (options.artifacts === false) return undefined;
  return startArtifactChannel({ cwd: () => getController?.()?.get().session.cwd ?? options.cwd }).catch(
    () => undefined,
  );
}

/**
 * The session's MCP servers: artifacts, `ask_user` for agents that cannot ask on their own, and
 * `open_project` in `--home` mode. A port that will not open only means the agent goes without that one.
 */
async function openChannels(options: ChatOptions, getController?: () => ChatController | undefined) {
  const [artifactChannel, questionChannel, openProjectChannel] = await Promise.all([
    openArtifacts(options, getController),
    startQuestionChannel().catch(() => undefined),
    options.home
      ? startProjectChannel({
          env: options.env,
          loadSessions: async () => {
            const sources = options.sessionSources ?? agentSessionSources(options.agents);
            return (await listSessions(sources, { env: options.env, readOnly: true, live: false })).sessions;
          },
          enabled: () => {
            const conversation = getController?.()?.get().conversation;
            return !conversation || conversation.origin === 'home' || conversation.origin === 'unresolved';
          },
          onMove: (target) => {
            getController?.()?.moveProject(target);
          },
        }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  return {
    artifactChannel,
    questionChannel,
    openProjectChannel,
    closeChannels: async () => {
      await Promise.all([artifactChannel?.close(), questionChannel?.close(), openProjectChannel?.close()]);
    },
  };
}

export async function runChat(options: WebRunOptions): Promise<number> {
  const liveEnv = options.env ?? process.env;
  let controller: ChatController | undefined;
  const inspector = createAgentInspector({
    agents: options.agents,
    getEnv: () => liveEnv,
    onUpdate: (inspections) => controller?.updateAgents(inspections),
  });
  const web = webLink({ ...options, env: liveEnv }, () => controller!, inspector);
  const { artifactChannel, questionChannel, openProjectChannel, closeChannels } = await openChannels(
    { ...options, env: liveEnv },
    () => controller,
  );
  try {
    controller = createChatController({
      ...options,
      env: liveEnv,
      web,
      artifactChannel,
      questionChannel,
      openProjectChannel,
      onAuthFailure: () => {
        inspector.invalidate();
        void inspector.check({ refresh: true });
      },
    });
  } catch (error) {
    await closeChannels();
    if (!(error instanceof NoAgentError)) throw error;
    options.stderr.write(`${error.message}\n`);
    return 2;
  }
  // A first prompt about a session that could not be taken over would start without it.
  const taken = !options.continueFrom || (await controller.continueSession(options.continueFrom));
  if (options.openWeb) controller.submit('/web');
  if (options.firstPrompt && taken) controller.submit(options.firstPrompt);
  await runTerminal(controller, options);
  await web.close();
  controller.close();
  await closeChannels();
  return 0;
}

/** What the host app writes to stdin about a newer version of itself: being downloaded, then ready. */
const UPDATE_LINE = /^update-(?:(downloading|ready|installing) ([0-9A-Za-z.+-]{1,40})|(none))$/;
/** What the host app writes to stdin when the person clicks a waiting session in the menu bar. */
const OPEN_SESSION_LINE = /^open-session ([A-Za-z0-9_.:-]{1,200})$/;
/** What the host app reads from stderr when the page asks for that relaunch. */
export const RELAUNCH_LINE = 'Relaunch to update';
/** What the host app reads from stderr when Check again asks to re-read the login shell environment. */
export const REFRESH_ENV_LINE = 'Refresh env';
/** Max buffered bytes for one partial stdin line from the host shell (a full login env JSON). */
const HOST_LINE_MAX = 256 * 1024;
/** Max wait for the desktop shell to reply with `env <json>` (just above its 5 s login-shell cap). */
const ENV_REFRESH_TIMEOUT_MS = 6_000;

interface ManagedHostApp extends HostApp {
  close(): void;
}

/**
 * The other end of an app that started the server with `--exit-with-stdin` (the desktop app). It
 * says `update-downloading <version>` on stdin while it downloads a newer version of itself,
 * `update-ready <version>` once that waits, `update-installing <version>` while it replaces itself
 * and `update-none` when a download failed; the page shows each and offers "Relaunch to update"
 * for the one that waits, and a click prints `RELAUNCH_LINE` on stderr. `open-session <id>`
 * brings a session from the menu bar directly into the chat.
 *
 * When started by the desktop shell (`GENAICODE_DESKTOP_SHELL=1`), clicking Check again prints
 * `REFRESH_ENV_LINE` on stderr and the shell replies with `env <json>` containing the refreshed
 * login shell environment, merged into `liveEnv` without restarting the server.
 */
function hostApp(
  options: WebRunOptions,
  liveEnv: NodeJS.ProcessEnv,
  onOpenSession?: (id: string) => void,
): ManagedHostApp {
  let update: HostUpdate | undefined;
  let rest = '';
  const listeners = new Set<() => void>();
  let envRefresh: Promise<void> | undefined;
  let resolveEnv: (() => void) | undefined;
  let envTimer: ReturnType<typeof setTimeout> | undefined;

  const finishEnvRefresh = () => {
    if (envTimer) {
      clearTimeout(envTimer);
      envTimer = undefined;
    }
    const done = resolveEnv;
    resolveEnv = undefined;
    envRefresh = undefined;
    done?.();
  };

  const applyEnvLine = (payload: string) => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value !== 'string' || key === 'GENAICODE_NO_AUTO_UPDATE') continue;
          liveEnv[key] = value;
        }
      }
    } catch {
      // Ignore malformed env payloads and keep the current environment.
    }
    finishEnvRefresh();
  };

  const onData = (chunk: Buffer | string) => {
    const lines = (rest + chunk.toString()).split('\n');
    rest = (lines.pop() ?? '').slice(-HOST_LINE_MAX);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('env ')) {
        applyEnvLine(line.slice(4));
        continue;
      }
      const openMatch = OPEN_SESSION_LINE.exec(line);
      if (openMatch?.[1]) {
        onOpenSession?.(openMatch[1]);
        continue;
      }
      const found = UPDATE_LINE.exec(line);
      if (!found) continue;
      // `update-none`: a download that failed, so there is nothing to show any more.
      const next: HostUpdate | undefined = found[3]
        ? undefined
        : {
            version: found[2]!,
            ready: found[1] === 'ready',
            ...(found[1] === 'installing' ? { installing: true as const } : {}),
          };
      if (JSON.stringify(update) === JSON.stringify(next)) continue;
      update = next;
      for (const listener of listeners) listener();
    }
  };
  const onEnd = () => finishEnvRefresh();
  options.stdin.on('data', onData);
  options.stdin.once('end', onEnd);

  const canRefreshEnv = liveEnv.GENAICODE_DESKTOP_SHELL === '1';
  return {
    update: () => update,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    relaunch: () => void options.stderr.write(`${RELAUNCH_LINE}\n`),
    ...(canRefreshEnv
      ? {
          refreshEnv() {
            if (envRefresh) return envRefresh;
            envRefresh = new Promise<void>((resolve) => {
              resolveEnv = resolve;
              envTimer = setTimeout(finishEnvRefresh, ENV_REFRESH_TIMEOUT_MS);
              envTimer.unref?.();
              options.stderr.write(`${REFRESH_ENV_LINE}\n`);
            });
            return envRefresh;
          },
        }
      : {}),
    close() {
      finishEnvRefresh();
      options.stdin.off('data', onData);
      options.stdin.off('end', onEnd);
      listeners.clear();
    },
  };
}

export async function runWeb(options: WebRunOptions): Promise<number> {
  const liveEnv = options.env ?? process.env;
  const terminal = !!(options.stdin.isTTY && options.stdout.isTTY);
  const watchEnd = !terminal && options.exitWithStdin === true;
  let controller: ChatController | undefined;
  let pendingOpen: string | undefined;
  const openSession = (id: string) => {
    if (controller) void controller.continueSession(id);
    else pendingOpen = id;
  };
  const host = watchEnd ? hostApp(options, liveEnv, openSession) : undefined;
  const webOptions: WebRunOptions = { ...options, env: liveEnv, ...(host ? { hostApp: host } : {}) };
  const inspector = createAgentInspector({
    agents: webOptions.agents,
    getEnv: () => liveEnv,
    refreshEnv: host?.refreshEnv,
    onUpdate: (inspections) => controller?.updateAgents(inspections),
  });
  const web = webLink(webOptions, () => controller!, inspector);
  const { artifactChannel, questionChannel, openProjectChannel, closeChannels } = await openChannels(
    webOptions,
    () => controller,
  );
  try {
    controller = createChatController({
      ...webOptions,
      web,
      artifactChannel,
      questionChannel,
      openProjectChannel,
      allowNoAgent: true,
      onAuthFailure: () => {
        inspector.invalidate();
        void inspector.check({ refresh: true });
      },
    });
  } catch (error) {
    host?.close();
    await closeChannels();
    if (!(error instanceof NoAgentError)) throw error;
    options.stderr.write(`${error.message}\n`);
    return 2;
  }
  let url: string;
  try {
    url = await web.start();
  } catch (error) {
    host?.close();
    controller.close();
    await closeChannels();
    throw error;
  }
  // Never block page load on sign-in checks; kick off initial inspection in the background.
  void inspector.check();
  const inSetup = controller.get().setup === true;
  options.stderr.write(
    (inSetup
      ? `genaicode ${options.version} · no agent CLI found on PATH (setup mode)\n`
      : `genaicode ${options.version} · ${controller.get().session.agent} in ${options.cwd}\n`) +
      `Open ${url}\n(the link carries an access token; Ctrl-C stops the server)\n` +
      (terminal ? 'Press Enter to chat in this terminal too; it shares the session with the browser.\n' : ''),
  );
  const initialSession = pendingOpen ?? options.continueFrom;
  pendingOpen = undefined;
  const taken = !initialSession || (await controller.continueSession(initialSession));
  let pendingFirstPrompt = options.firstPrompt && taken ? options.firstPrompt : undefined;
  let offFirstPrompt: (() => void) | undefined;
  if (pendingFirstPrompt) {
    if (!controller.get().setup) {
      const prompt = pendingFirstPrompt;
      pendingFirstPrompt = undefined;
      controller.submit(prompt);
    } else {
      // Wait for onboarding to finish (e.g. `genaicode embed --ui` started before an agent is installed).
      offFirstPrompt = controller.subscribe((view) => {
        if (view.setup || !pendingFirstPrompt) return;
        const prompt = pendingFirstPrompt;
        pendingFirstPrompt = undefined;
        offFirstPrompt?.();
        offFirstPrompt = undefined;
        queueMicrotask(() => {
          if (!options.signal?.aborted && !controller?.get().setup) controller?.submit(prompt);
        });
      });
    }
  }
  if (options.open !== false) (options.openUrl ?? openBrowser)(url);
  const next = await new Promise<'stop' | 'terminal'>((resolve) => {
    if (options.signal?.aborted) return resolve('stop');
    const onAbort = () => {
      options.stdin.off('data', onData);
      options.stdin.off('end', onAbort);
      options.signal?.removeEventListener('abort', onAbort);
      offFirstPrompt?.();
      offFirstPrompt = undefined;
      pendingFirstPrompt = undefined;
      host?.close();
      if (terminal || watchEnd) options.stdin.pause();
      resolve('stop');
    };
    const onData = () => {
      options.signal?.removeEventListener('abort', onAbort);
      options.stdin.pause();
      resolve('terminal');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (terminal) options.stdin.once('data', onData);
    else if (watchEnd) {
      // The host app's listener reads stdin from the start: its end may already be past.
      if (options.stdin.readableEnded) return onAbort();
      // Read (and drop) whatever arrives, so the end of the stream is noticed.
      options.stdin.once('end', onAbort);
      options.stdin.resume();
    }
  });
  if (next === 'terminal') await runTerminal(controller, webOptions);
  offFirstPrompt?.();
  pendingFirstPrompt = undefined;
  host?.close();
  await web.close();
  controller.close();
  await closeChannels();
  return 0;
}

/** The terminal chat, until the person quits or `signal` aborts. */
async function runTerminal(controller: ChatController, options: UiRunOptions) {
  const app = render(<ChatApp controller={controller} cwd={options.cwd} version={options.version} />, {
    stdout: options.stdout,
    stdin: options.stdin,
    exitOnCtrlC: false,
  });
  const onAbort = () => app.unmount();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  await app.waitUntilExit();
  options.signal?.removeEventListener('abort', onAbort);
}

/**
 * The browser UI on the terminal's session, started on demand (`/web`, `genaicode chat --web`)
 * or up front (`genaicode ui`). Both front ends drive one controller, so they stay in step.
 */
function webLink(
  options: WebRunOptions,
  controller: () => ChatController,
  inspector?: AgentInspector,
): WebHandoff & { start(): Promise<string> } {
  let running: Promise<WebUi> | undefined;
  const agents = options.sessionAgents ?? options.agents;
  const currentSenders = () =>
    detectAgents(agents, options.env).flatMap(({ agent, path }) =>
      path && agent.capabilities.resume && agent.sessions?.where === 'local'
        ? [{ agent: agent.name, source: agent.sessions.name, sandboxes: agent.capabilities.permissions?.sandbox ?? [] }]
        : [],
    );
  const start = () =>
    (running ??= startWebUi({
      controller: controller(),
      clientScript: options.clientScript ?? readFileSync(new URL('./web-client.js', import.meta.url), 'utf8'),
      title: {
        version: options.version,
        cwd: options.cwd,
        ...(options.noProject ? { project: false } : {}),
        ...(options.home ? { home: true } : {}),
      },
      uploads: createUploads(() => controller().get().session.cwd),
      files: createProjectFiles(() => controller().get().session.cwd),
      host: options.host,
      port: options.port,
      token: options.token,
      hostApp: options.hostApp,
      ...(inspector ? { agents: (query) => inspector.check(query) } : {}),
      assets: options.assets ?? loadAssets(new URL('./assets/', import.meta.url)),
      // The Sessions view: what every one of these agents has going on, on this machine.
      sessions: async ({ own, ...query }) => {
        const sources = options.sessionSources ?? agentSessionSources(options.agents);
        const recorded = options.home ? await readConversations(options.env).catch(() => []) : [];
        const recordedIds = new Set(recorded.flatMap((conv) => (conv.sessionId ? [conv.sessionId] : [])));
        const listing = await listSessions(sources, {
          ...query,
          // In `--cwd`/`--no-project` mode, own conversations live in `options.cwd`.
          // In `--home` mode, own conversations can run in any project directory and are tracked in `conversations.json`.
          ...(own
            ? options.home
              ? { automated: true, live: false }
              : { cwd: options.cwd, automated: true, live: false }
            : {}),
          ...(options.env ? { env: options.env } : {}),
        });
        const sessions =
          own && options.home
            ? listing.sessions.filter(
                (session) =>
                  recordedIds.has(session.id) ||
                  (session.where === 'local' && !!session.cwd && isSameDir(session.cwd, options.cwd)),
              )
            : listing.sessions;
        const readable = sources.filter((source) => source.read).map((source) => source.name);
        // Questions held open by `genaicode hooks install --answer`, to answer from the page.
        const asks = await pendingAsks(options.env).catch(() => []);
        // The topics the sessions were sorted into, for the view to group by.
        const store = await readTopics(options.env).catch(() => undefined);
        const topics = [...(store?.topics ?? [])];
        const topicOf: Record<string, string> = {};
        const recordedById = new Map(
          recorded.flatMap((conv) => (conv.sessionId ? [[conv.sessionId, conv] as const] : [])),
        );
        for (const session of sessions) {
          const key = `${session.source}:${session.id}`;
          const topic = store?.sessions[key];
          if (topic) {
            topicOf[key] = topic;
          } else {
            const conv = recordedById.get(session.id);
            if (conv?.topicId && conv.topicName) {
              topicOf[key] = conv.topicId;
              if (!topics.some((t) => t.id === conv.topicId)) topics.push({ id: conv.topicId, name: conv.topicName });
            }
          }
        }
        const sorted = topics.length ? { topics, topicOf } : {};
        return { ...listing, sessions, readable, asks, senders: currentSenders(), ...sorted };
      },
      sendPrompt: (source, id, prompt, sandbox, signal) =>
        sendSession(agents, id, prompt, {
          source,
          env: options.env,
          signal,
          permissions: sandbox ? { sandbox } : undefined,
        }),
      limits: () => knownLimits(options.env),
      // Automatic runs too: they use the plan like everything else.
      shares: async (query) => {
        const sources = options.sessionSources ?? agentSessionSources(options.agents);
        const env = options.env ? { env: options.env } : {};
        const listing = await listSessions(sources, { ...query, ...env, automated: true, live: false });
        // Only what was done in the period: a session's own figures cover its whole life.
        const parts = await partsSince(listing.sessions, query.since, env);
        return topicShares(listing.sessions, await readTopics(options.env), parts);
      },
      answer: (id, decision) => answerAsk(id, decision, options.env),
      archive: (sessions, archived) => archiveSessions(sessions, archived, options.env ? { env: options.env } : {}),
    }).catch((error: unknown) => {
      running = undefined;
      throw error;
    }));
  return {
    start: async () => (await start()).url,
    async open() {
      const { url } = await start();
      (options.openUrl ?? openBrowser)(url);
      return url;
    },
    async close() {
      const ui = running;
      if (!ui) return false;
      running = undefined;
      await (await ui).close();
      return true;
    },
  };
}

/** See `EmbeddedWebOptions` in src/ui.ts (`genaicode/ui`), which fills in the defaults. */
export interface EmbeddedWebOptions extends ChatOptions {
  version: string;
  /** Origins of the pages that show the UI in a frame. */
  frameAncestors: () => readonly string[];
  port?: number;
  clientScript?: string;
  assets?: ReadonlyMap<string, WebAsset>;
}

export interface EmbeddedWeb {
  /** The UI with its access token, for the overlay's frame. */
  url: string;
  controller: ChatController;
  close(): Promise<void>;
}

/**
 * The browser UI for a host that shows it in its own page (the Vite plugin), and that sends
 * prompts itself through `controller`. Throws `NoAgentError` when no agent is installed.
 */
export async function startEmbeddedWeb(options: EmbeddedWebOptions): Promise<EmbeddedWeb> {
  const { artifactChannel, questionChannel, closeChannels } = await openChannels(options);
  let controller: ChatController;
  try {
    controller = createChatController({ ...options, artifactChannel, questionChannel });
  } catch (error) {
    await closeChannels();
    throw error;
  }
  try {
    const ui = await startWebUi({
      controller,
      clientScript: options.clientScript ?? readFileSync(new URL('./web-client.js', import.meta.url), 'utf8'),
      title: { version: options.version, cwd: options.cwd },
      port: options.port,
      frameAncestors: options.frameAncestors,
      assets: options.assets ?? loadAssets(new URL('./assets/', import.meta.url)),
    });
    return {
      url: ui.url,
      controller,
      close: async () => {
        await ui.close();
        controller.close();
        await closeChannels();
      },
    };
  } catch (error) {
    controller.close();
    await closeChannels();
    throw error;
  }
}

// `genaicode/ui` (src/ui.ts) calls this through a dynamic import; keep the two in step.
export type { PublicEmbeddedWeb, EmbeddedWebBundleOptions };
startEmbeddedWeb satisfies (options: EmbeddedWebBundleOptions) => Promise<PublicEmbeddedWeb>;

function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser opener: the URL is printed anyway.
  }
}
