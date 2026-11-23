import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { render } from 'ink';
import { startArtifactChannel, type ArtifactChannel } from '../agents/artifacts.js';
import { startQuestionChannel } from '../agents/ask-user.js';
import type { CodingAgent } from '../agents/types.js';
import { detectAgents } from '../agents/discovery.js';
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
  listSessions,
  pendingAsks,
} from '../agents/sessions/index.js';
import { createUploads } from './uploads.js';
import { createProjectFiles } from './files.js';
import { startWebUi, type HostApp, type HostUpdate, type WebAsset, type WebUi } from './web/server.js';
import { startWelcome } from './web/welcome.js';

export { NoAgentError };

/**
 * Interactive front ends for `genaicode chat` and `genaicode ui`.
 *
 * This module is bundled with Ink and React into `dist/ui/`, so the library itself keeps
 * no UI dependencies. The CLI loads it only for these two commands, and the Vite plugin
 * (`genaicode/vite`) for `startEmbeddedWeb`.
 */
export interface UiRunOptions extends ChatOptions {
  projectTeams?: import('../agents/pack-profile.js').ProjectTeams;
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
async function openArtifacts(options: ChatOptions): Promise<ArtifactChannel | undefined> {
  if (options.artifacts === false) return undefined;
  return startArtifactChannel({ cwd: options.cwd }).catch(() => undefined);
}

/**
 * The session's MCP servers: artifacts, and `ask_user` for agents that cannot ask on their own.
 * A port that will not open only means the agent goes without that one.
 */
async function openChannels(options: ChatOptions) {
  const [artifactChannel, questionChannel] = await Promise.all([
    openArtifacts(options),
    startQuestionChannel().catch(() => undefined),
  ]);
  return {
    artifactChannel,
    questionChannel,
    closeChannels: async () => {
      await Promise.all([artifactChannel?.close(), questionChannel?.close()]);
    },
  };
}

export async function runChat(options: WebRunOptions): Promise<number> {
  let controller: ChatController;
  const web = webLink(options, () => controller);
  const { artifactChannel, questionChannel, closeChannels } = await openChannels(options);
  try {
    controller = createChatController({ ...options, web, artifactChannel, questionChannel });
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

/**
 * While no agent CLI is installed, `genaicode ui` serves a page that says which ones it can use
 * and how to get one. Resolves with the link the chat then takes over, or `null` when stopped first.
 */
async function welcome(options: WebRunOptions): Promise<{ port: number; token: string } | null | undefined> {
  if (options.agent || detectAgents(options.agents, options.env).some(({ path }) => path)) return undefined;
  const page = await startWelcome({
    agents: options.agents,
    env: options.env,
    version: options.version,
    host: options.host,
    port: options.port,
    assets: options.assets ?? loadAssets(new URL('./assets/', import.meta.url)),
  });
  options.stderr.write(
    `genaicode ${options.version} · no agent CLI found on PATH\n` +
      `Open ${page.url}\n(it says how to install one, and goes on to the chat once one is there; Ctrl-C stops the server)\n`,
  );
  if (options.open !== false) (options.openUrl ?? openBrowser)(page.url);
  const watchEnd = options.exitWithStdin === true && !(options.stdin.isTTY && options.stdout.isTTY);
  const found = await new Promise<boolean>((resolve) => {
    if (options.signal?.aborted) return resolve(false);
    const settle = (value: boolean) => {
      options.signal?.removeEventListener('abort', stop);
      if (watchEnd) {
        options.stdin.off('end', stop);
        // A stream left flowing would keep the process alive after a signal.
        options.stdin.pause();
      }
      resolve(value);
    };
    const stop = () => settle(false);
    options.signal?.addEventListener('abort', stop, { once: true });
    if (watchEnd) {
      // The host app's listener reads stdin from the start: its end may already be past.
      if (options.stdin.readableEnded) return stop();
      options.stdin.once('end', stop);
      options.stdin.resume();
    }
    void page.found.then(() => settle(true));
  });
  await page.close();
  return found ? { port: page.port, token: page.token } : null;
}

/** What the host app writes to stdin about a newer version of itself: being downloaded, then ready. */
const UPDATE_LINE = /^update-(?:(downloading|ready|installing) ([0-9A-Za-z.+-]{1,40})|(none))$/;
/** What the host app reads from stderr when the page asks for that relaunch. */
export const RELAUNCH_LINE = 'Relaunch to update';

/**
 * The other end of an app that started the server with `--exit-with-stdin` (the desktop app). It
 * says `update-downloading <version>` on stdin while it downloads a newer version of itself,
 * `update-ready <version>` once that waits, `update-installing <version>` while it replaces itself
 * and `update-none` when a download failed; the page shows each and offers "Relaunch to update"
 * for the one that waits, and a click prints `RELAUNCH_LINE` on stderr.
 */
function hostApp(options: WebRunOptions): HostApp {
  let update: HostUpdate | undefined;
  let rest = '';
  const listeners = new Set<() => void>();
  options.stdin.on('data', (chunk: Buffer | string) => {
    const lines = (rest + chunk.toString()).split('\n');
    rest = (lines.pop() ?? '').slice(-200);
    for (const line of lines) {
      const found = UPDATE_LINE.exec(line.trim());
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
  });
  return {
    update: () => update,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    relaunch: () => void options.stderr.write(`${RELAUNCH_LINE}\n`),
  };
}

export async function runWeb(options: WebRunOptions): Promise<number> {
  // Before anything waits: what the app says while the welcome page shows is kept for the chat.
  if (options.exitWithStdin === true && !(options.stdin.isTTY && options.stdout.isTTY))
    options = { ...options, hostApp: hostApp(options) };
  const welcomed = await welcome(options);
  if (welcomed === null) return 0;
  // The chat answers on the link the welcome page had, which the browser already shows.
  if (welcomed) options = { ...options, ...welcomed, open: false };
  let controller: ChatController;
  const web = webLink(options, () => controller);
  const { artifactChannel, questionChannel, closeChannels } = await openChannels(options);
  try {
    controller = createChatController({ ...options, web, artifactChannel, questionChannel });
  } catch (error) {
    await closeChannels();
    if (!(error instanceof NoAgentError)) throw error;
    options.stderr.write(`${error.message}\n`);
    return 2;
  }
  let url: string;
  try {
    url = await web.start();
  } catch (error) {
    controller.close();
    await closeChannels();
    throw error;
  }
  // From a terminal, Enter brings the same session into it: the browser stays connected.
  const terminal = !!(options.stdin.isTTY && options.stdout.isTTY);
  options.stderr.write(
    `genaicode ${options.version} · ${controller.get().session.agent} in ${options.cwd}\n` +
      `Open ${url}\n(the link carries an access token; Ctrl-C stops the server)\n` +
      (terminal ? 'Press Enter to chat in this terminal too; it shares the session with the browser.\n' : ''),
  );
  const taken = !options.continueFrom || (await controller.continueSession(options.continueFrom));
  if (options.firstPrompt && taken) controller.submit(options.firstPrompt);
  if (options.open !== false) (options.openUrl ?? openBrowser)(url);
  const next = await new Promise<'stop' | 'terminal'>((resolve) => {
    if (options.signal?.aborted) return resolve('stop');
    const watchEnd = !terminal && options.exitWithStdin === true;
    const onAbort = () => {
      options.stdin.off('data', onData);
      options.stdin.off('end', onAbort);
      options.signal?.removeEventListener('abort', onAbort);
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
  if (next === 'terminal') await runTerminal(controller, options);
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
function webLink(options: WebRunOptions, controller: () => ChatController): WebHandoff & { start(): Promise<string> } {
  let running: Promise<WebUi> | undefined;
  const agents = options.sessionAgents ?? options.agents;
  const senders = detectAgents(agents, options.env).flatMap(({ agent, path }) =>
    path && agent.capabilities.resume && agent.sessions?.where === 'local'
      ? [{ agent: agent.name, source: agent.sessions.name, sandboxes: agent.capabilities.permissions?.sandbox ?? [] }]
      : [],
  );
  const start = () =>
    (running ??= startWebUi({
      controller: controller(),
      clientScript: options.clientScript ?? readFileSync(new URL('./web-client.js', import.meta.url), 'utf8'),
      title: { version: options.version, cwd: options.cwd, ...(options.noProject ? { project: false } : {}) },
      uploads: createUploads(options.cwd),
      files: createProjectFiles(options.cwd),
      host: options.host,
      port: options.port,
      token: options.token,
      hostApp: options.hostApp,
      assets: options.assets ?? loadAssets(new URL('./assets/', import.meta.url)),
      // The Sessions view: what every one of these agents has going on, on this machine.
      sessions: async ({ own, ...query }) => {
        const sources = options.sessionSources ?? agentSessionSources(options.agents);
        const listing = await listSessions(sources, {
          ...query,
          // The chat's own conversations: asked for its directory, with the one-prompt ones too.
          ...(own ? { cwd: options.cwd, automated: true, live: false } : {}),
          ...(options.env ? { env: options.env } : {}),
        });
        const readable = sources.filter((source) => source.read).map((source) => source.name);
        // Questions held open by `genaicode hooks install --answer`, to answer from the page.
        const asks = await pendingAsks(options.env).catch(() => []);
        // The topics the sessions were sorted into, for the view to group by.
        const store = await readTopics(options.env).catch(() => undefined);
        const topicOf: Record<string, string> = {};
        for (const session of listing.sessions) {
          const topic = store?.sessions[`${session.source}:${session.id}`];
          if (topic) topicOf[`${session.source}:${session.id}`] = topic;
        }
        const sorted = store?.topics.length ? { topics: store.topics, topicOf } : {};
        return { ...listing, readable, asks, senders, ...sorted };
      },
      sendPrompt: (source, id, prompt, sandbox, signal) =>
        sendSession(agents, id, prompt, {
          source,
          env: options.env,
          signal,
          permissions: sandbox ? { sandbox } : undefined,
        }),
      limits: () => knownLimits(options.env),
      projectTeams: options.projectTeams,
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
