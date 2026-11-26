import type { ChatHub } from '../hub.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isSandboxPolicy } from '../../agents/permissions.js';
import type { AgentInspection } from '../../agents/status.js';
import { SessionSendError } from '../../agents/sessions/send.js';
import type { AgentResult, RateLimit, SandboxPolicy } from '../../agents/types.js';
import { parseQuestionAnswers } from '../../agents/question-answers.js';
import { publicPackRefusal, type PackAction } from '../../agents/pack.js';
import { artifactResponse } from '../../agents/artifacts.js';
import { contentHeaders, normalizeScriptHosts, parseByteRange } from '../../agents/media.js';
import type { SessionListing } from '../../agents/sessions/index.js';
import type { SessionInfo } from '../../agents/sessions/types.js';
import type { SessionTurn } from '../../agents/session.js';
import type { AgentShares } from '../../agents/sessions/shares.js';
import type { AskDecision, PendingAsk } from '../../agents/sessions/answer.js';
import type { ChatController, ChatSwitch, SwitchOrder } from '../controller.js';
import { approvalCommand, type ConfirmedCommand } from '../../react/work.js';
import { currentBranch, repoRoot } from '../../agents/pack-git.js';
import type { TowerDecision } from '../../agents/sessions/tower.js';
import {
  activeChatTruncation,
  chatTranscriptJson,
  formatChatTranscriptMarkdown,
  formatStoredSessionMarkdown,
  storedConversationMarkdown,
  storedSessionTranscriptJson,
  transcriptFilename,
  type TranscriptFormat,
  type TranscriptMeta,
} from '../transcript.js';
import type { UiRelease } from './release.js';
import { pageHtml } from './page.js';
import { parseShell, parseSlash, withAttached } from '../format.js';
import { MAX_UPLOAD_BYTES, type Upload, type Uploads } from '../uploads.js';
import type { FileRaw, ProjectFiles } from '../files.js';
import { PullRequestBusy, type PullRequestLookup } from '../pull-requests.js';
import { chatKey } from '../sidebar.js';

export interface WebUiOptions {
  hub?: ChatHub;
  projectTeams?: import('../../agents/pack-profile.js').ProjectTeams;
  controller: ChatController;
  /** The bundled browser script served at /app.js. */
  clientScript: string;
  /** Shown in the page header. */
  /** `project: false`: the page names no project, `cwd` is only where the chat's agent runs. */
  title: { version: string; cwd: string; project?: boolean; home?: boolean };
  /** Default 127.0.0.1. The UI can run any command through the agent, so keep it local. */
  host?: string;
  /** Default 0 (a free port). */
  port?: number;
  /** Fixed access token, for tests. Default: 32 random bytes. */
  token?: string;
  /**
   * Origins allowed to show the page in a frame (the Vite plugin's overlay). Read per request,
   * so it can grow once the host server knows its address. Default: none.
   */
  frameAncestors?: () => readonly string[];
  /**
   * Lists the sessions the agents keep (`listSessions`), for the page's Sessions view at
   * /api/sessions. `since` is epoch milliseconds. Without it the page has no such view.
   */
  sessions?: (query: {
    since?: number;
    /**
     * Only the conversations of the chat's own directory, and all of them: a chat of one prompt
     * reads like a program's run in the agent's store, and the listing leaves those out otherwise.
     */
    own?: boolean;
  }) => Promise<WebSessionListing>;
  /** Run a turn in the named local session. Enabled only in the standalone tower. */
  sendPrompt?: (
    source: string,
    id: string,
    prompt: string,
    sandbox: SandboxPolicy | undefined,
    signal: AbortSignal,
    onResponse: () => void,
  ) => Promise<AgentResult>;
  /**
   * How much of each agent's plan is used, as last seen (`knownLimits`), at GET /api/limits: the
   * page shows the chosen agent's when its session reported none yet.
   */
  limits?: () => Promise<Array<RateLimit & { agent: string }>>;
  /**
   * Which topics each agent's work went to since `since` (`topicShares`), at GET /api/shares: the
   * start screen shows it beside the plan limits.
   */
  shares?: (query: { since: number }) => Promise<AgentShares[]>;
  /** Answers a question a session holds open (`asks` of the listing), at POST /api/asks/<id>. */
  answer?: (id: string, decision: AskDecision) => Promise<boolean>;
  /** Archives sessions (`archived` false: brings them back), at POST /api/archive. */
  archive?: (sessions: Array<{ source: string; id: string }>, archived: boolean) => Promise<number>;
  /**
   * Where files the user attaches are kept (`createUploads`), at POST /api/upload: a prompt sent
   * with their ids names their paths to the agent. Without it the page takes text only.
   */
  uploads?: Uploads;
  /**
   * Reads project files (`createProjectFiles`) for GET /api/file?path=, so a path in the chat opens
   * as text in the page. Without it paths stay plain.
   */
  files?: ProjectFiles;
  /**
   * Local status of each supported agent (installed, version, sign-in, hints), at GET /api/agents.
   * Never calls a model. `?refresh=1` bypasses the short cache; `?env=1` also refreshes the host shell env.
   */
  agents?: (query?: {
    refresh?: boolean;
    refreshEnv?: boolean;
  }) => Promise<{ agents: AgentInspection[]; setup: boolean }>;
  /** Static files served at /assets/<name> without the token (the mascot and its bark). */
  assets?: ReadonlyMap<string, WebAsset>;
  /** Resolves the current chat session's raw file path on disk (for transcript metadata / Copy path). */
  sessionFile?: (session: { agent: string; sessionId: string }) => Promise<string | undefined>;
  /** Reads a stored session and its turns for GET /api/sessions/<source>/<id>/transcript. */
  sessionTranscript?: (
    source: string,
    id: string,
  ) => Promise<
    | {
        session: SessionInfo;
        turns: SessionTurn[];
        readable: boolean;
        truncated?: boolean;
        truncatedReason?: string;
      }
    | undefined
  >;
  /** The app that started the server and shows its page (the desktop app), when there is one. */
  hostApp?: HostApp;
  /**
   * Whether the pull request a delegated task's reply links to is open, merged or closed, and
   * whether the task opened it, at GET /api/pull-request?conversation=&turn=&task=. Only tasks of the
   * conversation shown are looked up. Without it the page shows such a pull request as a plain link.
   */
  pullRequest?: PullRequestLookup;
  release?: () => UiRelease;
  /** Live settings that the page can read and update (e.g. opt-in CDN hosts for HTML artifacts). */
  settings?: WebSettings;
}

export interface WebSettings {
  artifactCdn(): readonly string[];
  setArtifactCdn(hosts: readonly string[]): void;
  subscribe?(listener: () => void): () => void;
}

/**
 * What a host app tells the page and takes from it: update state for "Relaunch to update",
 * native file saving for transcripts, short status toasts triggered from native menu actions,
 * revealing a file in the OS file manager, and persisting desktop settings.
 */
export interface HostUpdate {
  version: string;
  /** Downloaded: a relaunch installs it. */
  ready: boolean;
  /** The relaunch was chosen and the app is replacing itself. */
  installing?: true;
}

export interface HostSaveRequest {
  chat?: string;
  format: TranscriptFormat;
  /** Present when saving a stored session from the Sessions view rather than the active chat. */
  source?: string;
  id?: string;
}

export interface HostApp {
  /** The newer version of the app, once one is known: still downloading, or waiting for a relaunch. */
  update(): HostUpdate | undefined;
  /** Calls `listener` when `update()` changes. Returns the way to stop. */
  subscribe(listener: () => void): () => void;
  /** The person asked for the relaunch. */
  relaunch(): void;
  /** The person asked to save a transcript using the host app's native Save dialog. */
  saveTranscript?(request: HostSaveRequest): void;
  /** Calls `listener` when the host app sends a transient status toast (e.g. from a menu action). */
  onToast?(listener: (text: string) => void): () => void;
  /** Ask the desktop shell to re-read the user's login shell environment (PATH, API keys). */
  refreshEnv?(): Promise<void>;
  /** Reveal an existing file on disk in Finder / the OS file manager. */
  reveal?(path: string): void;
  /** Persist updated desktop settings (e.g. `artifactCdn`) in the host shell. */
  saveSettings?(settings: { artifactCdn: readonly string[]; maxChats?: number }): void;
  /**
   * Ask the person for a folder with the host's own dialog (the project a new chat starts in).
   * Resolves to its absolute path, or undefined when they chose none.
   */
  chooseFolder?(): Promise<string | undefined>;
}

/** What GET /api/folder says of a path typed as the folder of a new chat. */
export interface WebFolder {
  /** The path as an absolute one (`~` is the home folder). */
  path: string;
  /** False when there is no such directory. */
  exists: boolean;
  /** True inside a git repository. */
  git?: boolean;
  /** The branch checked out there. */
  branch?: string;
}

/** The folder a path names once links are followed; the path itself when there is none. */
function realFolder(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A typed folder as an absolute path: `~` expanded, spaces around it dropped. Undefined when it is not one. */
function typedFolder(given: string, home: string): string | undefined {
  const typed = given.trim();
  const expanded = typed === '~' ? home : /^~[\\/]/.test(typed) ? join(home, typed.slice(2)) : typed;
  return expanded && isAbsolute(expanded) ? resolve(expanded) : undefined;
}

/** Reads what the new chat's project line shows of a typed path: whether it is there, a repository, and its branch. */
export async function inspectFolder(given: string, home = homedir()): Promise<WebFolder | undefined> {
  const path = typedFolder(given, home);
  return path === undefined ? undefined : describeFolder(path);
}

/**
 * The folder the host's dialog returned, exactly as given (a name may end in a space): its real
 * path, which is both what the person may open and where the chat then runs. Undefined when it is
 * not an existing directory.
 */
export async function chosenFolder(chosen: string): Promise<WebFolder | undefined> {
  if (!isAbsolute(chosen)) return undefined;
  let path: string;
  try {
    path = realpathSync(chosen);
  } catch {
    return undefined;
  }
  const folder = await describeFolder(path);
  return folder.exists ? folder : undefined;
}

/** Whether `path`, an absolute path, is a directory, a git repository, and its branch. */
async function describeFolder(path: string): Promise<WebFolder> {
  let exists = false;
  try {
    exists = statSync(path).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) return { path, exists };
  const git = !!(await repoRoot(path).catch(() => null));
  const branch = git ? await currentBranch(path).catch(() => undefined) : undefined;
  return { path, exists, git, ...(branch ? { branch } : {}) };
}

/**
 * `readable`: the sources (`SessionInfo.source`) whose sessions the chat can take over (`continue`).
 * `asks`: the questions held open for an answer from here. `topics`: what the view groups by.
 */
export type WebSessionListing = SessionListing & {
  readable?: string[];
  asks?: PendingAsk[];
  senders?: Array<{ agent: string; source: string; sandboxes: readonly SandboxPolicy[] }>;
  /** The topics kept by `genaicode topics`, and the topic id of each listed session by `source:id`. */
  topics?: Array<{ id: string; name: string }>;
  topicOf?: Record<string, string>;
};

export interface WebAsset {
  type: string;
  body: Buffer;
}

export interface WebUi {
  /** Open this in a browser; it carries the access token. */
  url: string;
  close(): Promise<void>;
}

/** What the browser can ask for. Anything else is rejected with 400. */
export type WebCommand = { generation?: number } & WebCommandBody;

type WebCommandBody =
  /** `files`: ids of uploads (POST /api/upload) that go with the prompt. */
  | { type: 'submit'; text: string; files?: string[] }
  /**
   * With `conversation` (`chatKey()` of the chat it was pressed in, from `../sidebar.js`) and `turn`, it stops only that
   * turn of that conversation: one that arrives after the window moved on changes nothing.
   */
  | { type: 'stop'; conversation?: string; turn?: number }
  | { type: 'approve'; id: string; decision: 'approve' | 'deny'; confirmed?: ConfirmedCommand }
  /** Answer a question of the agent: chosen option labels or typed text per question id. */
  | { type: 'answer'; id: string; answers: Record<string, string[]> }
  | { type: 'tower'; id: string; decision: TowerDecision }
  /** With `conversation`, refused unless that conversation is still the one shown. */
  | {
      type: 'pack-task';
      turnId: number;
      id: string;
      action: PackAction;
      conversation?: string;
      /** A discard the page offered because the task's pull request holds its work: checked again first. */
      pullRequest?: true;
    }
  | WebSwitchCommand
  | { type: 'agent'; name: string }
  | { type: 'model'; model: string }
  /**
   * `/auto on|off` for the conversation numbered `generation` (`ChatView.generation`), the one
   * shown when it was asked for: refused once another is shown.
   */
  | { type: 'auto'; on: boolean; generation: number };

/**
 * A request for another conversation (`ChatController.switchChat`). `order` says where it stands
 * among the requests of the page that sent it: one that arrives after a later one is answered
 * `{ ok: false, superseded: true }` and changes nothing.
 */
export type WebSwitchCommand = WebSwitchTarget & { order?: SwitchOrder; generation?: number };

type WebSwitchTarget =
  /**
   * Open the session with this id, the one in the store `source` when given, in place of the
   * conversation shown. `takeover`: `/continue <id>`, whose turns join it in `--cwd` mode.
   */
  | { type: 'continue'; id: string; source?: string; takeover?: true }
  /** Start a new conversation in the resolved directory of this topic (`--home` mode). */
  | { type: 'topic-chat'; topic: string }
  /** Start a new conversation in this directory, an absolute path (`--home` mode). */
  | { type: 'project-chat'; cwd: string }
  /** Start a new conversation: back in the neutral home in `--home` mode, as `/clear` otherwise. */
  | { type: 'home-chat' }
  /** Stay in the open conversation: drops the requests that still wait to open another. */
  | { type: 'stay-chat' };

const MAX_BODY = 64 * 1024;
/** Most files on one prompt. */
export const MAX_FILES = 8;
/** Cap on port-scoped cookies left on the host so repeated random-port runs do not bloat Cookie headers. */
const MAX_PORT_COOKIES = 8;

export function secretOk(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionCookies(cookieHeader: string | undefined, currentName: string, secret: string): string[] {
  const headers = [`${currentName}=${secret}; HttpOnly; SameSite=Lax; Path=/`];
  const others: string[] = [];
  for (const part of (cookieHeader ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== currentName && /^genaicode_\d+$/.test(name) && !others.includes(name)) others.push(name);
  }
  for (const stale of others.slice(0, Math.max(0, others.length - (MAX_PORT_COOKIES - 1)))) {
    headers.push(`${stale}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }
  return headers;
}

export function parseCommand(value: unknown): WebCommand | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const command = value as Record<string, unknown>;
  const { generation } = command;
  if (
    generation !== undefined &&
    (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0)
  )
    return undefined;
  const parsed = parseCommandBody(command);
  return parsed && generation !== undefined ? { ...parsed, generation } : parsed;
}

function parseCommandBody(command: Record<string, unknown>): WebCommandBody | undefined {
  const text = (key: string, max: number) =>
    typeof command[key] === 'string' && (command[key] as string).length <= max ? (command[key] as string) : undefined;
  switch (command.type) {
    case 'submit': {
      const body = text('text', 32_000);
      if (body === undefined) return undefined;
      const { files } = command;
      if (files === undefined) return { type: 'submit', text: body };
      if (!Array.isArray(files) || files.length > MAX_FILES || !files.every((id) => typeof id === 'string')) {
        return undefined;
      }
      return { type: 'submit', text: body, files: files as string[] };
    }
    case 'stop': {
      const conversation = text('conversation', 200);
      const { turn } = command;
      if (command.conversation !== undefined && conversation === undefined) return undefined;
      if (turn !== undefined && (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1)) return undefined;
      return {
        type: 'stop',
        ...(conversation !== undefined ? { conversation } : {}),
        ...(turn !== undefined ? { turn: turn as number } : {}),
      };
    }
    case 'pack-task': {
      const { turnId, action } = command;
      const id = text('id', 200);
      const conversation = text('conversation', 200);
      const scope = conversation !== undefined ? { conversation } : {};
      if (
        (command.conversation !== undefined && conversation === undefined) ||
        !id ||
        typeof turnId !== 'number' ||
        !Number.isSafeInteger(turnId) ||
        turnId < 1 ||
        !action ||
        typeof action !== 'object'
      )
        return undefined;
      const { type, text: input } = action as Record<string, unknown>;
      if (type === 'steer' && typeof input === 'string' && input.trim() && input.length <= 32_000)
        return { type: 'pack-task', turnId, id, action: { type, text: input }, ...scope };
      if (type === 'merge' || type === 'diff') {
        const { revision } = action as Record<string, unknown>;
        if (
          revision !== undefined &&
          (typeof revision !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision))
        )
          return undefined;
        const { checked, path } = action as Record<string, unknown>;
        if (checked !== undefined && (type !== 'merge' || checked !== true || !revision)) return undefined;
        if (
          path !== undefined &&
          (type !== 'diff' || typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0'))
        )
          return undefined;
        return {
          type: 'pack-task',
          turnId,
          id,
          action: {
            type,
            ...(revision ? { revision } : {}),
            ...(checked ? { checked: true as const } : {}),
            ...(path ? { path } : {}),
          },
          ...scope,
        };
      }
      if (type === 'discard') {
        // `empty`: the page showed no changes; the pack refuses if the worktree has some by now.
        const empty = (action as Record<string, unknown>).empty === true ? { empty: true as const } : {};
        return {
          type: 'pack-task',
          turnId,
          id,
          action: { type, ...empty },
          ...(command.pullRequest === true ? { pullRequest: true as const } : {}),
          ...scope,
        };
      }
      if (type === 'restore' || type === 'stop' || type === 'review' || type === 'verify')
        return { type: 'pack-task', turnId, id, action: { type }, ...scope };
      return undefined;
    }
    case 'tower': {
      const id = text('id', 1024);
      const decision = command.decision;
      if (!id || (decision !== 'send' && decision !== 'dismiss' && decision !== 'approve' && decision !== 'deny'))
        return undefined;
      return { type: 'tower', id, decision };
    }
    case 'approve': {
      const id = text('id', 200);
      const decision = command.decision;
      if (id === undefined || (decision !== 'approve' && decision !== 'deny')) return undefined;
      if (command.confirmed !== undefined) {
        if (!command.confirmed || typeof command.confirmed !== 'object') return undefined;
        const { turn, task, command: shown } = command.confirmed as Record<string, unknown>;
        if (
          typeof turn !== 'number' ||
          !Number.isSafeInteger(turn) ||
          turn < 1 ||
          typeof task !== 'string' ||
          typeof shown !== 'string'
        )
          return undefined;
        return { type: 'approve', id, decision, confirmed: { turn, task, command: shown } };
      }
      return { type: 'approve', id, decision };
    }
    case 'answer': {
      const id = text('id', 200);
      const answers = parseQuestionAnswers(command.answers);
      if (id === undefined || !answers) return undefined;
      return { type: 'answer', id, answers };
    }
    case 'continue':
    case 'topic-chat':
    case 'project-chat':
    case 'home-chat':
    case 'stay-chat': {
      let order: { order?: SwitchOrder } = {};
      if (command.order !== undefined) {
        const { window, seq } = (command.order ?? {}) as Record<string, unknown>;
        if (typeof window !== 'string' || !window || window.length > 100) return undefined;
        if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return undefined;
        order = { order: { window, seq } };
      }
      if (command.type === 'continue') {
        const id = text('id', 200);
        const source = text('source', 200);
        if (!id || (command.source !== undefined && !source)) return undefined;
        if (command.takeover !== undefined && command.takeover !== true) return undefined;
        const takeover = command.takeover ? { takeover: true as const } : {};
        return { type: 'continue', id, ...(source ? { source } : {}), ...takeover, ...order };
      }
      if (command.type === 'topic-chat') {
        const topic = text('topic', 200);
        return topic ? { type: 'topic-chat', topic, ...order } : undefined;
      }
      if (command.type === 'project-chat') {
        const cwd = text('cwd', 4096);
        return cwd ? { type: 'project-chat', cwd, ...order } : undefined;
      }
      return { type: command.type, ...order };
    }
    case 'agent': {
      const name = text('name', 100);
      return name === undefined ? undefined : { type: 'agent', name };
    }
    case 'model': {
      const model = text('model', 200);
      return model === undefined ? undefined : { type: 'model', model };
    }
    case 'auto': {
      const { on, generation } = command;
      if (
        typeof on !== 'boolean' ||
        typeof generation !== 'number' ||
        !Number.isSafeInteger(generation) ||
        generation < 0
      )
        return undefined;
      return { type: 'auto', on, generation };
    }
    default:
      return undefined;
  }
}

/** Serve the chat in a browser: one page, a server-sent event stream of views, and a command endpoint. */
export async function startWebUi(options: WebUiOptions): Promise<WebUi> {
  const { controller, hub } = options;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? randomBytes(32).toString('hex');
  // Separate secret for the reload-shell cookie only; cookies are shared across ports on the host,
  // so this cookie never authorizes /api/* endpoints and never returns cwd/session metadata.
  const pageCookieSecret = randomBytes(32).toString('hex');
  const streams = new Set<ServerResponse>();
  const sentViews = new WeakMap<ServerResponse, ReturnType<ChatController['get']>>();
  const viewers = new Map<ServerResponse, ChatController>();
  const lifetime = new AbortController();
  let port = 0;

  const allowedHost = (header: string | undefined) => {
    if (!header) return false;
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`].includes(header);
  };
  const cookieName = () => `genaicode_${port}`;
  const tokenOk = (candidate: string | null | undefined) => secretOk(candidate, token);
  /**
   * The task's worktree is still exactly its pull request (branch, head commit, nothing uncommitted),
   * checked now: a discard offered because the pull request holds the work loses nothing.
   */
  const holdsPullRequest = async (controller: ChatController, turnId: number, id: string): Promise<boolean> => {
    const task = controller
      .get()
      .session.turns.find((turn) => turn.id === turnId)
      ?.pack?.tasks.find((one) => one.id === id);
    if (!task?.pullRequest || task.mode !== 'worktree' || !options.pullRequest) return false;
    const status = await options
      .pullRequest(task.pullRequest.url, task.worktree ?? task.cwd, { fresh: true })
      .catch(() => undefined);
    return status?.ours === true;
  };
  /** Folders the person picked in the host app's dialog (real paths): a chat may start in them. */
  const chosenFolders = new Set<string>();
  const cookieOk = (req: IncomingMessage) => {
    const header = req.headers.cookie;
    if (!header) return false;
    const expectedName = cookieName();
    let ok = false;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === expectedName && secretOk(part.slice(eq + 1).trim(), pageCookieSecret)) ok = true;
    }
    return ok;
  };
  const send = (
    res: ServerResponse,
    status: number,
    type: string,
    body: string,
    headers: Record<string, string | string[]> = {},
  ) => {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    });
    res.end(body);
  };

  let pending: NodeJS.Timeout | undefined;
  // Coalesce bursts of changes (streamed text) into one message carrying the latest view.
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      const summaries = hub ? `event: chats\ndata: ${JSON.stringify(hub.summaries())}\n\n` : '';
      for (const stream of streams) {
        const active = viewers.get(stream) ?? controller;
        const view = active.get();
        if (sentViews.get(stream) !== view) {
          stream.write(`event: view\ndata: ${JSON.stringify(view)}\n\n`);
          sentViews.set(stream, view);
        }
        if (summaries) stream.write(summaries);
      }
    }, 40);
  };
  const unsubscribe = hub ? hub.subscribe(broadcast) : controller.subscribe(broadcast);
  const configEvent = () => {
    const update = options.hostApp?.update();
    const artifactCdn = options.settings?.artifactCdn() ?? controller.artifacts?.allowScriptHosts?.() ?? [];
    const config = {
      cwd: options.title.cwd,
      project: options.title.project !== false,
      ...(options.title.home ? { home: true } : {}),
      ...(hub ? { multiChat: true, initialChat: hub.initial, maxChats: hub.limit } : {}),
      sessions: !!options.sessions,
      ...(options.limits ? { limits: true } : {}),
      agents: !!options.agents,
      uploads: !!options.uploads,
      ...(options.projectTeams ? { projectTeams: true } : {}),
      files: !!options.files,
      ...(options.hostApp?.saveTranscript ? { nativeSave: true } : {}),
      reveal: !!options.hostApp?.reveal,
      ...(options.hostApp?.chooseFolder ? { chooseFolder: true } : {}),
      artifactCdn,
      canConfigureCdn: !!options.settings,
      ...(update ? { update } : {}),
    };
    return `event: config\ndata: ${JSON.stringify(config)}\n\n`;
  };
  if (hub)
    hub.onOpen = (chat) => {
      for (const stream of streams) stream.write(`event: open\ndata: ${JSON.stringify({ chat })}\n\n`);
    };
  const broadcastConfig = () => {
    const data = configEvent();
    for (const stream of streams) stream.write(data);
  };
  const unsubscribeHost = options.hostApp?.subscribe(broadcastConfig);
  const unsubscribeSettings = options.settings?.subscribe?.(broadcastConfig);
  const unsubscribeToast = options.hostApp?.onToast?.((text) => {
    const data = `event: toast\ndata: ${JSON.stringify({ text })}\n\n`;
    for (const stream of streams) stream.write(data);
  });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (!allowedHost(req.headers.host)) return send(res, 403, 'text/plain', 'Forbidden host');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const ancestors = options.frameAncestors?.() ?? [];
      const inFrame = ancestors.length > 0 || req.headers['sec-fetch-dest'] === 'iframe';
      const queryToken = url.searchParams.get('token');
      if (queryToken !== null) {
        if (!tokenOk(queryToken)) {
          return send(res, 403, 'text/plain', 'Open the link genaicode printed in your terminal (it carries a token).');
        }
        return send(
          res,
          200,
          'text/html; charset=utf-8',
          pageHtml({ ...options.title, sessions: !!options.sessions, stripToken: !inFrame }),
          {
            'content-security-policy': `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
            ...(inFrame ? {} : { 'set-cookie': sessionCookies(req.headers.cookie, cookieName(), pageCookieSecret) }),
          },
        );
      }
      if (!cookieOk(req)) {
        return send(res, 403, 'text/plain', 'Open the link genaicode printed in your terminal (it carries a token).');
      }
      // Reload shell only: holds no cwd or session metadata because cookies are shared across ports on the host.
      return send(res, 200, 'text/html; charset=utf-8', pageHtml({ version: options.title.version, cwd: '' }), {
        'content-security-policy': `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
      });
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      return send(res, 200, 'text/javascript; charset=utf-8', options.clientScript);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const asset = options.assets?.get(url.pathname.slice('/assets/'.length));
      if (!asset) return send(res, 404, 'text/plain', 'Not found');
      res.writeHead(200, {
        'content-type': asset.type,
        'content-length': asset.body.length,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      });
      return res.end(asset.body);
    }
    const chatId = url.searchParams.get('chat') ?? hub?.initial;
    let chat = chatId ? hub?.chats.get(chatId) : undefined;
    if (
      !chat &&
      hub &&
      chatId &&
      req.method === 'GET' &&
      url.pathname === '/api/events' &&
      tokenOk(
        typeof req.headers['x-genaicode-token'] === 'string'
          ? req.headers['x-genaicode-token']
          : url.searchParams.get('token'),
      )
    ) {
      chat = await hub.reopen(chatId);
    }
    if (hub && !chat) return send(res, 404, 'application/json', '{"reason":"gone"}');
    const controller = chat?.controller ?? options.controller;
    const files = chat?.files ?? options.files;
    const uploads = chat?.uploads ?? options.uploads;
    if (req.method === 'GET' && url.pathname === '/api/chats' && hub) {
      if (!tokenOk(req.headers['x-genaicode-token'] as string)) return send(res, 403, 'text/plain', 'Bad token');
      return send(
        res,
        200,
        'application/json',
        JSON.stringify(
          url.searchParams.has('running')
            ? { running: hub.running }
            : { running: hub.running, limit: hub.limit, chats: hub.summaries() },
        ),
      );
    }
    if (req.method === 'GET' && url.pathname.startsWith('/artifacts/')) {
      // No token: the frame that shows an artifact would see it in its own URL. The id is
      // unguessable and opens that one artifact only.
      const rawVersion = url.searchParams.get('v');
      const version = rawVersion !== null && /^\d+$/.test(rawVersion) ? Number(rawVersion) : undefined;
      const found = controller.artifacts?.read(url.pathname.slice('/artifacts/'.length), version);
      if (!found) return send(res, 404, 'text/plain', 'Not found');
      const response = artifactResponse(found.artifact, found.body, {
        range: req.headers.range,
        allowScriptHosts: options.settings?.artifactCdn() ?? controller.artifacts?.allowScriptHosts?.(),
        download: url.searchParams.get('download') === '1',
      });
      res.writeHead(response.status, response.headers);
      return res.end(response.body);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      // No token: capability URL minted by /api/file or /api/file/images, single-path and short-lived.
      const id = url.pathname.slice('/files/'.length);
      let found = files?.fromCapability(id);
      if (!found && hub) {
        for (const entry of hub.chats.values()) {
          found = entry.files.fromCapability(id);
          if (found) break;
        }
      }
      if (!found) return send(res, 404, 'text/plain', 'Not found');
      return streamRawFile(
        req,
        res,
        found,
        options.settings?.artifactCdn() ?? controller.artifacts?.allowScriptHosts?.(),
        url.searchParams.get('download') === '1',
      );
    }
    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
      // No token, as for artifacts: the id is unguessable and shows that one image only.
      const found = uploads?.image(url.pathname.slice('/uploads/'.length));
      if (!found) return send(res, 404, 'text/plain', 'Not found');
      res.writeHead(200, {
        'content-type': found.type,
        'content-length': found.body.length,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
      });
      return res.end(found.body);
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!uploads) return send(res, 404, 'application/json', '{"error":"no uploads"}');
      const name = (url.searchParams.get('name') ?? '').slice(0, 200) || 'file';
      let body: Buffer;
      try {
        body = await readBytes(req, MAX_UPLOAD_BYTES);
      } catch {
        // The rest of the body is not read.
        res.setHeader('connection', 'close');
        return send(res, 413, 'application/json', '{"error":"too large"}');
      }
      try {
        const kept = uploads.save(name, body);
        return send(res, 200, 'application/json', JSON.stringify({ id: kept.id, name: kept.name, size: kept.size }));
      } catch {
        // A full disk, a project that cannot be written to: the page says the message did not leave.
        return send(res, 500, 'application/json', '{"error":"not kept"}');
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/file') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!files) return send(res, 404, 'application/json', '{"error":"no files"}');
      const targetPath = url.searchParams.get('path') ?? '';
      const found = files.read(targetPath);
      if (typeof found === 'string') {
        const status = found === 'outside' || found === 'secret' ? 403 : 404;
        return send(res, status, 'application/json', JSON.stringify({ error: found }));
      }
      const cap = files.capability(targetPath);
      const payload = cap ? { ...found, rawUrl: `/files/${cap.id}`, fullPath: cap.raw.realPath } : found;
      return send(res, 200, 'application/json', JSON.stringify(payload), { 'cache-control': 'no-store' });
    }
    if (req.method === 'GET' && url.pathname === '/api/file/raw') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!files) return send(res, 404, 'application/json', '{"error":"no files"}');
      const found = files.raw(url.searchParams.get('path') ?? '');
      if (typeof found === 'string') {
        const status = found === 'outside' || found === 'secret' ? 403 : 404;
        return send(res, status, 'application/json', JSON.stringify({ error: found }));
      }
      return streamRawFile(
        req,
        res,
        found,
        options.settings?.artifactCdn() ?? controller.artifacts?.allowScriptHosts?.(),
        url.searchParams.get('download') === '1',
      );
    }
    if (req.method === 'POST' && url.pathname === '/api/file/images') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!files) return send(res, 404, 'application/json', '{"error":"no files"}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let paths: string[] | undefined;
      try {
        const body = JSON.parse(await readBody(req)) as { paths?: unknown };
        if (
          Array.isArray(body?.paths) &&
          body.paths.length <= 100 &&
          body.paths.every((p: unknown) => typeof p === 'string' && p.length <= 4096)
        ) {
          paths = body.paths as string[];
        }
      } catch {
        paths = undefined;
      }
      if (!paths) return send(res, 400, 'application/json', '{"error":"bad paths"}');
      const urls: Record<string, string> = {};
      for (const item of paths) {
        const cap = files.capability(item, { onlyKind: 'image' });
        if (cap) urls[item] = `/files/${cap.id}`;
      }
      return send(res, 200, 'application/json', JSON.stringify({ urls }), { 'cache-control': 'no-store' });
    }
    if (req.method === 'GET' && url.pathname === '/api/folder') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      // `cwd`: a folder by its exact absolute path (the chat's own), taken as it is. `path`: one typed
      // in, where `~` is expanded and spaces around it are dropped.
      const exact = url.searchParams.get('cwd');
      const given = exact ?? url.searchParams.get('path') ?? '';
      const path =
        given.length > 4096
          ? undefined
          : exact !== null
            ? isAbsolute(exact)
              ? exact
              : undefined
            : typedFolder(given, homedir());
      if (path === undefined) return send(res, 400, 'application/json', '{"error":"bad path"}');
      // With a fixed project (`--cwd`) the page asks only about the folder the chat is in, that very
      // folder: `repo\` or `repo ` beside it is another one.
      const project = controller.session.get().cwd;
      if (!options.title.home && realFolder(path) !== realFolder(project)) {
        return send(res, 403, 'application/json', '{"error":"not this project"}');
      }
      const folder = await describeFolder(options.title.home ? path : project);
      return send(res, 200, 'application/json', JSON.stringify(folder), { 'cache-control': 'no-store' });
    }
    if (req.method === 'POST' && url.pathname === '/api/choose-folder') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.hostApp?.chooseFolder) {
        return send(res, 404, 'application/json', '{"error":"no folder dialog"}');
      }
      const chosen = await options.hostApp.chooseFolder().catch(() => undefined);
      // The exact path the dialog returned, by its real path: what the person picked may be opened,
      // also when no session worked there yet, and nothing beside it.
      const folder = chosen ? await chosenFolder(chosen) : undefined;
      if (folder) chosenFolders.add(folder.path);
      return send(res, 200, 'application/json', JSON.stringify(folder ? { folder } : {}), {
        'cache-control': 'no-store',
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/reveal') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.hostApp?.reveal || !files) {
        return send(res, 404, 'application/json', '{"error":"reveal unavailable"}');
      }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let targetPath: string | undefined;
      try {
        const body = JSON.parse(await readBody(req)) as { path?: unknown };
        if (typeof body?.path === 'string' && body.path.length > 0 && body.path.length <= 4096) {
          targetPath = body.path;
        }
      } catch {
        targetPath = undefined;
      }
      if (!targetPath) return send(res, 400, 'application/json', '{"error":"bad path"}');
      const resolved = files.revealPath(targetPath);
      if (!resolved.ok) {
        const status = resolved.reason === 'missing' ? 404 : 403;
        return send(res, status, 'application/json', JSON.stringify({ error: resolved.reason }));
      }
      options.hostApp.reveal(resolved.realPath);
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.settings && !hub) return send(res, 404, 'application/json', '{"error":"settings unavailable"}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let hosts: string[] | undefined;
      let limit: number | undefined;
      try {
        const body = JSON.parse(await readBody(req)) as { artifactCdn?: unknown; maxChats?: unknown };
        if (body?.maxChats !== undefined) {
          if (
            !hub ||
            typeof body.maxChats !== 'number' ||
            !Number.isInteger(body.maxChats) ||
            body.maxChats < 1 ||
            body.maxChats > 8
          )
            throw new Error('Choose 1 to 8 chats.');
          limit = body.maxChats;
        }
        if (
          Array.isArray(body?.artifactCdn) &&
          body.artifactCdn.length <= 32 &&
          body.artifactCdn.every((item: unknown) => typeof item === 'string')
        ) {
          hosts = normalizeScriptHosts(body.artifactCdn as string[]);
        }
      } catch (error) {
        return send(
          res,
          400,
          'application/json',
          JSON.stringify({ error: error instanceof Error ? error.message : 'invalid settings' }),
        );
      }
      if ((!hosts || !options.settings) && limit === undefined)
        return send(res, 400, 'application/json', '{"error":"bad settings"}');
      if (hosts) options.settings?.setArtifactCdn(hosts);
      if (limit !== undefined) hub?.setLimit(limit);
      options.hostApp?.saveSettings?.({
        artifactCdn: hosts ?? options.settings?.artifactCdn() ?? [],
        ...(hub ? { maxChats: hub.limit } : {}),
      });
      broadcastConfig();
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, artifactCdn: hosts }));
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const header = req.headers['x-genaicode-token'];
      const candidate =
        header !== undefined ? (typeof header === 'string' ? header : null) : url.searchParams.get('token');
      if (!tokenOk(candidate)) return send(res, 403, 'text/plain', 'Bad token');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        connection: 'keep-alive',
      });
      res.write(`event: view\ndata: ${JSON.stringify(controller.get())}\n\n`);
      res.write(configEvent());
      if (options.release) res.write(`event: release\ndata: ${JSON.stringify(options.release())}\n\n`);
      streams.add(res);
      viewers.set(res, controller);
      const hide = chatId ? hub?.shown(chatId) : undefined;
      if (hub) res.write(`event: chats\ndata: ${JSON.stringify(hub.summaries())}\n\n`);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(ping);
        hide?.();
        viewers.delete(res);
        streams.delete(res);
      });
      return;
    }
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/agents') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.agents) return send(res, 404, 'application/json', '{"error":"no agent status here"}');
      const refresh = req.method === 'POST' || url.searchParams.get('refresh') === '1';
      const refreshEnv = req.method === 'POST' || url.searchParams.get('env') === '1';
      const status = await options.agents({ refresh, refreshEnv });
      return send(res, 200, 'application/json', JSON.stringify(status));
    }
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/pack-profile') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined))
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      if (!options.projectTeams) return send(res, 404, 'application/json', '{"error":"no project teams"}');
      const selected = url.searchParams.get('project');
      const active = controller.session.get().cwd;
      const chooseProject = options.title.project === false && (!options.title.home || active === options.title.cwd);
      const cwd = chooseProject ? selected || '' : active;
      if (selected && selected !== cwd)
        return send(res, 409, 'application/json', '{"error":"The project changed. Open its team again."}');
      try {
        if (req.method === 'GET')
          return send(res, 200, 'application/json', JSON.stringify(await options.projectTeams.load(cwd)));
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
          return send(res, 415, 'application/json', '{"error":"expected JSON"}');
        await options.projectTeams.save(cwd, JSON.parse(await readBody(req)));
        return send(res, 200, 'application/json', '{"ok":true}');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not open the project team.';
        return send(res, 400, 'application/json', JSON.stringify({ error: message }));
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/limits') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      const limits = options.limits ? await options.limits().catch(() => []) : [];
      return send(res, 200, 'application/json', JSON.stringify({ limits }));
    }
    if (req.method === 'GET' && url.pathname === '/api/pull-request') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      // Only a pull request a task of the conversation shown links to: the page cannot make the
      // server ask GitHub about anything else.
      const shown = controller.get();
      const turnId = Number(url.searchParams.get('turn'));
      const taskId = url.searchParams.get('task') ?? '';
      const task =
        url.searchParams.get('conversation') === chatKey(shown)
          ? shown.session.turns.find((turn) => turn.id === turnId)?.pack?.tasks.find((one) => one.id === taskId)
          : undefined;
      if (!task?.pullRequest) return send(res, 404, 'application/json', '{"error":"no such task"}');
      let status: Awaited<ReturnType<PullRequestLookup>>;
      try {
        status = options.pullRequest
          ? await options.pullRequest(
              task.pullRequest.url,
              task.mode === 'worktree' ? (task.worktree ?? task.cwd) : undefined,
            )
          : undefined;
      } catch (error) {
        if (error instanceof PullRequestBusy) return send(res, 429, 'application/json', '{"error":"busy"}');
        status = undefined;
      }
      return send(res, 200, 'application/json', JSON.stringify(status ?? {}), { 'cache-control': 'no-store' });
    }
    if (req.method === 'GET' && url.pathname === '/api/shares') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      const days = Number(url.searchParams.get('days'));
      const since = Date.now() - (Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 7) * 86_400_000;
      const shares = options.shares ? await options.shares({ since }).catch(() => []) : [];
      return send(res, 200, 'application/json', JSON.stringify({ shares }));
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.sessions) return send(res, 404, 'application/json', '{"error":"no sessions here"}');
      const days = Number(url.searchParams.get('days'));
      const listing = await options.sessions({
        ...(Number.isFinite(days) && days > 0 ? { since: Date.now() - Math.min(days, 3650) * 86_400_000 } : {}),
        ...(url.searchParams.get('own') === '1' ? { own: true } : {}),
      });
      return send(res, 200, 'application/json', JSON.stringify(listing));
    }
    if (req.method === 'GET' && url.pathname === '/api/transcript') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      const format = url.searchParams.get('format') ?? 'md';
      if (format !== 'md' && format !== 'json' && format !== 'meta') {
        return send(res, 400, 'application/json', '{"error":"bad format"}');
      }
      const view = controller.get();
      const { session } = view;
      const sessionPath =
        session.sessionId && options.sessionFile
          ? await options.sessionFile({ agent: session.agent, sessionId: session.sessionId }).catch(() => undefined)
          : undefined;
      const now = new Date();
      const exportedAt = now.toISOString();
      const filenameMd = transcriptFilename({
        agent: session.agent,
        sessionId: session.sessionId,
        format: 'md',
        exportedAt: now,
      });
      const filenameJson = transcriptFilename({
        agent: session.agent,
        sessionId: session.sessionId,
        format: 'json',
        exportedAt: now,
      });
      if (format === 'meta') {
        const truncatedReason = activeChatTruncation(session);
        const meta: TranscriptMeta = {
          version: options.title.version,
          agent: session.agent,
          ...(session.model ? { model: session.model } : {}),
          ...(session.effort ? { effort: session.effort } : {}),
          ...(session.cwd ? { cwd: session.cwd } : {}),
          ...(session.sessionId ? { sessionId: session.sessionId } : {}),
          ...(sessionPath ? { sessionPath } : {}),
          turns: session.turns.length,
          ...(truncatedReason ? { truncated: true, truncatedReason } : {}),
          filenameMd,
          filenameJson,
        };
        const body = JSON.stringify(meta);
        return send(res, 200, 'application/json; charset=utf-8', body, {
          'content-length': String(Buffer.byteLength(body)),
        });
      }
      if (format === 'json') {
        const body = `${JSON.stringify(
          chatTranscriptJson({ view, version: options.title.version, sessionPath, exportedAt }),
          null,
          2,
        )}\n`;
        return send(res, 200, 'application/json; charset=utf-8', body, {
          'content-disposition': `attachment; filename="${filenameJson}"`,
          'x-genaicode-filename': filenameJson,
          'content-length': String(Buffer.byteLength(body)),
        });
      }
      const body = formatChatTranscriptMarkdown({
        view,
        version: options.title.version,
        sessionPath,
        exportedAt,
        readArtifact: controller.artifacts ? (id) => controller.artifacts!.read(id) : undefined,
      });
      return send(res, 200, 'text/markdown; charset=utf-8', body, {
        'content-disposition': `attachment; filename="${filenameMd}"`,
        'x-genaicode-filename': filenameMd,
        'content-length': String(Buffer.byteLength(body)),
      });
    }
    const transcriptTarget = /^\/api\/sessions\/([^/]+)\/([^/]+)\/transcript$/.exec(url.pathname);
    if (req.method === 'GET' && transcriptTarget) {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.sessionTranscript) return send(res, 404, 'application/json', '{"error":"no sessions here"}');
      const format = url.searchParams.get('format') ?? 'md';
      if (format !== 'md' && format !== 'json' && format !== 'meta' && format !== 'view') {
        return send(res, 400, 'application/json', '{"error":"bad format"}');
      }
      let source: string, id: string;
      try {
        source = decodeURIComponent(transcriptTarget[1]!);
        id = decodeURIComponent(transcriptTarget[2]!);
      } catch {
        return send(res, 400, 'application/json', '{"error":"invalid session id"}');
      }
      let found:
        | {
            session: SessionInfo;
            turns: SessionTurn[];
            readable: boolean;
            truncated?: boolean;
            truncatedReason?: string;
          }
        | undefined;
      try {
        found = await options.sessionTranscript(source, id);
      } catch {
        return send(res, 500, 'application/json', '{"error":"Could not read the session transcript."}');
      }
      if (!found) return send(res, 404, 'application/json', '{"error":"session not found"}');
      if (format === 'view') return send(res, 200, 'text/markdown; charset=utf-8', storedConversationMarkdown(found));
      const now = new Date();
      const exportedAt = now.toISOString();
      const filenameMd = transcriptFilename({
        agent: found.session.agent,
        sessionId: found.session.id,
        format: 'md',
        exportedAt: now,
      });
      const filenameJson = transcriptFilename({
        agent: found.session.agent,
        sessionId: found.session.id,
        format: 'json',
        exportedAt: now,
      });
      if (format === 'meta') {
        const meta: TranscriptMeta = {
          version: options.title.version,
          agent: found.session.agent,
          source: found.session.source,
          ...(found.session.model ? { model: found.session.model } : {}),
          ...(found.session.cwd ? { cwd: found.session.cwd } : {}),
          sessionId: found.session.id,
          ...(found.session.path ? { sessionPath: found.session.path } : {}),
          turns: found.turns.length,
          readable: found.readable,
          ...(found.truncated ? { truncated: true, truncatedReason: found.truncatedReason } : {}),
          filenameMd,
          filenameJson,
        };
        const body = JSON.stringify(meta);
        return send(res, 200, 'application/json; charset=utf-8', body, {
          'content-length': String(Buffer.byteLength(body)),
        });
      }
      if (format === 'json') {
        const body = `${JSON.stringify(
          storedSessionTranscriptJson({
            session: found.session,
            turns: found.turns,
            readable: found.readable,
            truncated: found.truncated,
            truncatedReason: found.truncatedReason,
            version: options.title.version,
            exportedAt,
          }),
          null,
          2,
        )}\n`;
        return send(res, 200, 'application/json; charset=utf-8', body, {
          'content-disposition': `attachment; filename="${filenameJson}"`,
          'x-genaicode-filename': filenameJson,
          'content-length': String(Buffer.byteLength(body)),
        });
      }
      const body = formatStoredSessionMarkdown({
        session: found.session,
        turns: found.turns,
        readable: found.readable,
        truncated: found.truncated,
        truncatedReason: found.truncatedReason,
        version: options.title.version,
        exportedAt,
      });
      return send(res, 200, 'text/markdown; charset=utf-8', body, {
        'content-disposition': `attachment; filename="${filenameMd}"`,
        'x-genaicode-filename': filenameMd,
        'content-length': String(Buffer.byteLength(body)),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/save-transcript') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.hostApp?.saveTranscript) return send(res, 404, 'application/json', '{"ok":false}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let saveRequest: HostSaveRequest | undefined;
      try {
        const body = JSON.parse(await readBody(req)) as { format?: unknown; source?: unknown; id?: unknown };
        if (body.format === 'md' || body.format === 'json') {
          const validPart = (value: unknown) =>
            typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\r\n\0]/.test(value);
          if (body.source === undefined && body.id === undefined) {
            saveRequest = { format: body.format, ...(url.searchParams.has('chat') && chatId ? { chat: chatId } : {}) };
          } else if (validPart(body.source) && validPart(body.id)) {
            saveRequest = { format: body.format, source: body.source as string, id: body.id as string };
          }
        }
      } catch {
        saveRequest = undefined;
      }
      if (!saveRequest) return send(res, 400, 'application/json', '{"error":"bad save request"}');
      options.hostApp.saveTranscript(saveRequest);
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    const target = /^\/api\/sessions\/([^/]+)\/([^/]+)\/send$/.exec(url.pathname);
    if (req.method === 'POST' && target) {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"delivery":"not-sent","error":"bad token"}');
      }
      if (!options.sendPrompt)
        return send(res, 404, 'application/json', '{"delivery":"not-sent","error":"no session sender here"}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"delivery":"not-sent","error":"expected JSON"}');
      }
      let source: string, id: string, prompt: string, sandbox: SandboxPolicy | undefined;
      try {
        source = decodeURIComponent(target[1]!);
        id = decodeURIComponent(target[2]!);
        const body = JSON.parse(await readBody(req));
        if (
          typeof body?.prompt !== 'string' ||
          !body.prompt.trim() ||
          body.prompt.length > 32_000 ||
          (body.sandbox !== undefined && !isSandboxPolicy(body.sandbox))
        )
          throw new Error();
        prompt = body.prompt;
        sandbox = body.sandbox;
      } catch {
        return send(
          res,
          400,
          'application/json',
          '{"delivery":"not-sent","error":"invalid session prompt or sandbox"}',
        );
      }
      let responded = false;
      try {
        const result = await options.sendPrompt(source, id, prompt, sandbox, lifetime.signal, () => {
          responded = true;
        });
        if (!result.ok) {
          const kind = result.failure?.kind;
          const reasons = {
            auth: 'The agent is not signed in or its credentials were refused.',
            quota: 'The agent has reached its quota.',
            unavailable: 'The agent could not start.',
            crash: 'The agent crashed.',
            budget: 'The turn exceeded its budget.',
          };
          const error =
            [kind && reasons[kind], result.error?.trim()].filter(Boolean).join(' ') || `The turn ${result.status}.`;
          const delivery = responded ? 'reached' : kind === 'unavailable' ? 'not-sent' : 'unknown';
          return send(res, 422, 'application/json', JSON.stringify({ error, kind, delivery }));
        }
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, text: result.text }));
      } catch (error) {
        if (error instanceof SessionSendError)
          return send(
            res,
            error.reason === 'missing' ? 404 : 409,
            'application/json',
            JSON.stringify({ error: error.publicMessage, delivery: 'not-sent' }),
          );
        return send(
          res,
          500,
          'application/json',
          JSON.stringify({ delivery: responded ? 'reached' : 'unknown', error: 'Could not send the session prompt.' }),
        );
      }
    }
    const asked = /^\/api\/asks\/([a-f0-9]{12})$/.exec(url.pathname);
    if (req.method === 'POST' && asked) {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.answer) return send(res, 404, 'application/json', '{"error":"no questions here"}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let decision: AskDecision | undefined;
      try {
        const body = JSON.parse(await readBody(req)) as { behavior?: unknown; message?: unknown };
        if (body.behavior === 'allow') decision = { behavior: 'allow' };
        else if (body.behavior === 'deny') {
          decision = { behavior: 'deny', ...(typeof body.message === 'string' ? { message: body.message } : {}) };
        }
      } catch {
        decision = undefined;
      }
      if (!decision) return send(res, 400, 'application/json', '{"error":"bad answer"}');
      const ok = await options.answer(asked[1]!, decision);
      return send(res, ok ? 200 : 409, 'application/json', JSON.stringify({ ok }));
    }
    if (req.method === 'POST' && url.pathname === '/api/archive') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!options.archive) return send(res, 404, 'application/json', '{"error":"no sessions here"}');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let request: { sessions: Array<{ source: string; id: string }>; archived: boolean } | undefined;
      try {
        const body = JSON.parse(await readBody(req)) as { sessions?: unknown; archived?: unknown };
        const sessions = Array.isArray(body.sessions) ? body.sessions : [];
        const valid = sessions.every(
          (one: unknown) =>
            typeof one === 'object' &&
            one !== null &&
            typeof (one as { source?: unknown }).source === 'string' &&
            typeof (one as { id?: unknown }).id === 'string',
        );
        if (valid && sessions.length && sessions.length <= 1000 && typeof body.archived === 'boolean') {
          request = {
            sessions: (sessions as Array<{ source: string; id: string }>).map(({ source, id }) => ({ source, id })),
            archived: body.archived,
          };
        }
      } catch {
        request = undefined;
      }
      if (!request) return send(res, 400, 'application/json', '{"error":"bad request"}');
      const changed = await options.archive(request.sessions, request.archived);
      return send(res, 200, 'application/json', JSON.stringify({ changed }));
    }
    if (req.method === 'POST' && url.pathname === '/api/relaunch') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      // Only what the host itself announced as ready can be asked for.
      if (!options.hostApp?.update()?.ready) return send(res, 404, 'application/json', '{"ok":false}');
      options.hostApp.relaunch();
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/api/command') {
      if (!tokenOk(req.headers['x-genaicode-token'] as string | undefined)) {
        return send(res, 403, 'application/json', '{"error":"bad token"}');
      }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, 'application/json', '{"error":"expected JSON"}');
      }
      let command: WebCommand | undefined;
      try {
        command = parseCommand(JSON.parse(await readBody(req)));
      } catch {
        command = undefined;
      }
      if (!command) return send(res, 400, 'application/json', '{"error":"bad command"}');
      // A command pressed in one conversation never acts on the next one the window moved to.
      if (
        (!isSwitch(command) &&
          command.generation !== undefined &&
          command.generation !== controller.get().generation) ||
        ((command.type === 'pack-task' || command.type === 'stop') &&
          command.conversation !== undefined &&
          command.conversation !== chatKey(controller.get()))
      )
        return send(
          res,
          409,
          'application/json',
          JSON.stringify({ ok: false, error: 'The conversation changed: nothing was done.', reason: 'conversation' }),
        );
      if (
        (command.type === 'approve' || command.type === 'answer') &&
        url.searchParams.has('turn') &&
        controller.get().session.turns.at(-1)?.id !== Number(url.searchParams.get('turn'))
      )
        return send(res, 409, 'application/json', '{"ok":false,"reason":"turn"}');
      if (command.type === 'stop' && hub && chatId) {
        const draft = hub.cancel(chatId);
        if (draft) return send(res, 200, 'application/json', JSON.stringify({ ok: true, draft }));
      }
      if (command.type === 'stop' && command.turn !== undefined) {
        const turns = controller.get().session.turns;
        const current = turns.at(-1);
        if (!current || current.id !== command.turn || current.result)
          return send(
            res,
            409,
            'application/json',
            JSON.stringify({ ok: false, error: 'That turn already ended: nothing was stopped.', reason: 'turn' }),
          );
      }
      if (command.type === 'pack-task') {
        if (!controller.session.actOnPackTask)
          return send(res, 404, 'application/json', '{"ok":false,"error":"Pack controls are unavailable."}');
        if (command.pullRequest && !(await holdsPullRequest(controller, command.turnId, command.id)))
          return send(
            res,
            409,
            'application/json',
            JSON.stringify({
              ok: false,
              error:
                'The worktree no longer matches its pull request: it has work the pull request does not. Nothing was discarded.',
              reason: 'stale',
            }),
          );
        try {
          if (command.generation !== undefined && command.generation !== controller.get().generation)
            return send(
              res,
              409,
              'application/json',
              '{"ok":false,"reason":"conversation","error":"The conversation changed."}',
            );
          const text = await controller.session.actOnPackTask(command.turnId, command.id, command.action);
          return send(res, 200, 'application/json', JSON.stringify({ ok: true, text }));
        } catch (error) {
          const refusal = publicPackRefusal(error);
          if (refusal)
            return send(
              res,
              refusal.reason === 'missing' ? 404 : 409,
              'application/json',
              JSON.stringify({ ok: false, error: refusal.message, reason: refusal.reason }),
            );
          return send(res, 500, 'application/json', '{"ok":false,"error":"Could not run the pack task action."}');
        }
      }
      if (isSwitch(command)) {
        if (hub && chatId) {
          const opened = await hub.open(chatId, switchTarget(command, chosenFolders));
          return send(res, 200, 'application/json', JSON.stringify({ ok: !!opened, chat: opened }));
        }
        const result = await controller.switchChat(
          switchTarget(command, chosenFolders),
          command.order,
          command.generation,
        );
        return send(
          res,
          200,
          'application/json',
          JSON.stringify({ ok: result === 'done', ...(result === 'superseded' ? { superseded: true } : {}) }),
        );
      }
      let attachedFiles: Upload[] = [];
      if (command.type === 'submit' && command.files?.length) {
        const found = command.files.map((id) => uploads?.find(id));
        if (found.some((one) => !one)) return send(res, 400, 'application/json', '{"error":"unknown file"}');
        attachedFiles = found as Upload[];
      }
      const ok = await run(controller, command, attachedFiles);
      return send(res, 200, 'application/json', JSON.stringify({ ok }));
    }
    send(res, 404, 'text/plain', 'Not found');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'text/plain', 'Server error');
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;

  return {
    url: `http://${shown}:${port}/?token=${token}`,
    close: () =>
      new Promise((resolve) => {
        lifetime.abort();
        unsubscribe();
        unsubscribeHost?.();
        unsubscribeToast?.();
        unsubscribeSettings?.();
        if (pending) clearTimeout(pending);
        for (const stream of streams) stream.end();
        streams.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

const SWITCHES: ReadonlySet<string> = new Set<WebSwitchCommand['type']>([
  'continue',
  'topic-chat',
  'project-chat',
  'home-chat',
  'stay-chat',
]);
const isSwitch = (command: WebCommand): command is WebSwitchCommand => SWITCHES.has(command.type);

/** The conversation a command asks for. */
function switchTarget(command: WebSwitchCommand, chosenFolders: ReadonlySet<string>): ChatSwitch {
  switch (command.type) {
    case 'continue':
      return {
        type: 'continue',
        id: command.id,
        ...(command.source ? { source: command.source } : {}),
        ...(command.takeover ? { takeover: true } : {}),
      };
    case 'topic-chat':
      return { type: 'topic', topic: command.topic };
    case 'project-chat': {
      // What the person picked in the host's dialog may be opened, whoever worked there before. The
      // path is resolved once: the one checked is the one opened, also when a link is moved meanwhile.
      const real = realFolder(command.cwd);
      return chosenFolders.has(real)
        ? { type: 'project', cwd: real, chosen: true }
        : { type: 'project', cwd: command.cwd };
    }
    case 'home-chat':
      return { type: 'home' };
    case 'stay-chat':
      return { type: 'stay' };
  }
}

async function run(
  controller: ChatController,
  command: Exclude<WebCommand, { type: 'pack-task' } | WebSwitchCommand>,
  files: readonly Upload[] = [],
): Promise<boolean> {
  switch (command.type) {
    case 'submit': {
      // A command is the host's, not the agent's: nothing there would read the files.
      const own = parseShell(command.text) !== undefined || parseSlash(command.text) !== undefined;
      if (own && files.length) controller.note('Files go with a prompt, not with a command: they were not sent.');
      const text = own
        ? command.text
        : withAttached(
            command.text,
            files.map((file) => file.path),
          );
      if (controller.submit(text, 'web') === 'quit') {
        controller.note('The browser UI keeps running until you stop genaicode in the terminal (Ctrl-C).');
      }
      return true;
    }
    case 'stop':
      controller.stop();
      return true;
    case 'approve':
      if (command.confirmed) {
        const { turn, task, command: shown } = command.confirmed;
        const state = controller.get().session;
        const request = state.approvals.find((one) => one.id === command.id);
        if (
          turn !== state.turns.at(-1)?.id ||
          request?.kind !== 'command' ||
          request.subtaskId !== task ||
          request.scope === 'turn' ||
          approvalCommand(request) !== shown
        )
          return false;
      }
      return controller.approve(command.id, command.decision);
    case 'answer':
      return controller.answer(command.id, command.answers);
    case 'tower':
      return controller.decideTower(command.id, command.decision);
    case 'agent':
      return controller.selectAgent(command.name);
    case 'model':
      controller.setModel(command.model.trim() || undefined);
      return true;
    case 'auto':
      return controller.setAutoApprove(command.on, command.generation);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  return (await readBytes(req, MAX_BODY)).toString('utf8');
}

async function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > max) throw new Error('Request too large');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error('Request too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Stream a verified file with shared CSP headers and HTTP `Range` support. */
function streamRawFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: FileRaw,
  allowScriptHosts: readonly string[] | undefined,
  download: boolean,
): void {
  const headers = contentHeaders({
    kind: file.contentKind,
    mimeType: file.mimeType,
    filename: file.filename,
    size: file.size,
    allowScriptHosts,
    download,
  });
  const parsed = parseByteRange(req.headers.range, file.size);
  if (parsed?.status === 416) {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${file.size}`, 'content-length': '0' });
    res.end();
    return;
  }
  if (file.size === 0) {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  let streamOptions: { start?: number; end?: number } | undefined;
  if (parsed?.status === 206) {
    const { start, end } = parsed;
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${file.size}`,
      'content-length': String(end - start + 1),
    });
    streamOptions = { start, end };
  } else {
    res.writeHead(200, headers);
  }
  const stream = createReadStream(file.realPath, streamOptions);
  const cleanup = () => stream.destroy();
  res.once('close', cleanup);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(404, { 'content-type': 'text/plain' });
    res.end();
  });
  stream.pipe(res);
}
