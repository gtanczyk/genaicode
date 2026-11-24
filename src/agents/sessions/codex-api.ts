import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { RpcPeer } from '../rpc.js';
import type { SessionTurn } from '../session.js';
import { activeIfRecent, isRecord, isWithin, oneLine, promptLine } from './files.js';
import { transcriptBuilder } from './transcript.js';
import type { SessionInfo, SessionQuery, SessionReadOptions } from './types.js';

/** A `codex app-server` asked over JSON-RPC on stdio. */
export interface CodexServer {
  request(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

export interface CodexServerOptions {
  /** The Codex executable. Default `codex`. */
  command?: string;
  /** Codex's home directory, when not the default one. */
  dir?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** How long one request may take. Default 15 seconds. */
  timeoutMs?: number;
}

/**
 * Start Codex's own app server (`codex app-server`) and greet it. It answers from Codex's stores
 * in Codex's own words, so its answers hold across Codex versions; it also keeps its state and
 * logs in Codex's home, like any Codex process.
 */
export async function openCodexServer(options: CodexServerOptions = {}): Promise<CodexServer> {
  const env = { ...(options.env ?? process.env), ...(options.dir ? { CODEX_HOME: options.dir } : {}) };
  const timeout = options.timeoutMs ?? 15_000;
  const child = spawn(options.command ?? 'codex', ['app-server'], {
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const peer = new RpcPeer((line) => child.stdin.write(`${line}\n`), {
    notification() {},
    // A reader asks; it grants nothing the server asks for.
    request(method) {
      throw new Error(`genaicode only reads sessions here: ${method} is not answered.`);
    },
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      peer.receive(JSON.parse(line));
    } catch {
      // Not a message: the server's own chatter.
    }
  });
  const close = () => {
    options.signal?.removeEventListener('abort', close);
    lines.close();
    child.kill();
  };
  const failed = (error: Error) => peer.fail(error);
  child.on('error', failed);
  child.on('exit', () => failed(new Error('codex app-server exited.')));
  child.stdin.on('error', failed);
  options.signal?.addEventListener('abort', close, { once: true });
  try {
    options.signal?.throwIfAborted();
    await peer.request('initialize', { clientInfo: { name: 'genaicode', version: '2' } }, timeout);
    peer.notify('initialized');
  } catch (error) {
    close();
    throw error;
  }
  return { request: (method, params) => peer.request(method, params, timeout), close };
}

/** Sources of threads a user talks to; helper threads Codex spawns are left out. */
const SOURCE_KINDS = ['cli', 'vscode', 'exec', 'appServer'];
const PAGE = 100;
/** No listing asks for more pages than this. */
const MAX_PAGES = 100;

function sessionOf(thread: unknown, now: number): SessionInfo | undefined {
  if (!isRecord(thread) || typeof thread.id !== 'string') return undefined;
  const seconds = typeof thread.updatedAt === 'number' ? thread.updatedAt : thread.createdAt;
  if (typeof seconds !== 'number' || thread.ephemeral === true || typeof thread.parentThreadId === 'string') {
    return undefined;
  }
  const updatedAt = seconds * 1000;
  const git = isRecord(thread.gitInfo) ? thread.gitInfo : {};
  const status = isRecord(thread.status) ? thread.status : {};
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const preview = text(thread.preview);
  // A loaded thread says what it does; a stored one is judged by its rollout, like before.
  const state: Partial<SessionInfo> =
    status.type !== 'active'
      ? status.type === 'idle'
        ? { state: 'waiting' }
        : activeIfRecent(updatedAt, now)
      : flags.includes('waitingOnApproval')
        ? { state: 'waiting', waitingFor: 'approval' }
        : flags.includes('waitingOnUserInput')
          ? { state: 'waiting', waitingFor: 'reply' }
          : { state: 'active' };
  return {
    source: 'codex',
    agent: 'codex',
    id: thread.id,
    where: 'local',
    updatedAt,
    ...(text(thread.cwd) ? { cwd: text(thread.cwd)! } : {}),
    ...(text(git.branch) ? { branch: text(git.branch)! } : {}),
    ...(text(git.originUrl) ? { repository: text(git.originUrl)! } : {}),
    ...(text(thread.name) ? { title: oneLine(text(thread.name)!, 120) } : {}),
    ...(preview ? { firstPrompt: promptLine(preview), lastPrompt: promptLine(preview) } : {}),
    ...(typeof thread.createdAt === 'number' ? { startedAt: thread.createdAt * 1000 } : {}),
    ...(text(thread.model) ? { model: text(thread.model)! } : {}),
    ...(text(thread.path) ? { path: text(thread.path)! } : {}),
    ...(status.type === 'active' ? { turnInProgress: true as const } : {}),
    // `codex exec`: a headless run nobody typed into.
    ...(thread.source === 'exec' ? { automated: true as const } : {}),
    ...state,
  };
}

/**
 * The threads Codex's app server lists (`thread/list`), newest first, as sessions: what
 * `query` asks for, without the latest prompt and reply (the list has only the first one).
 */
export async function codexThreads(
  server: CodexServer,
  query: SessionQuery = {},
  now = Date.now(),
): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  const wanted = query.limit ?? Infinity;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES && sessions.length < wanted; page += 1) {
    query.signal?.throwIfAborted();
    const result = await server.request('thread/list', {
      cursor,
      limit: PAGE,
      sortKey: 'updated_at',
      sourceKinds: SOURCE_KINDS,
      // Every provider, not only the one configured now.
      modelProviders: [],
      // Listing changes nothing: no repair of Codex's index from here.
      useStateDbOnly: true,
    });
    const data = isRecord(result) && Array.isArray(result.data) ? result.data : [];
    let older = false;
    for (const thread of data) {
      const session = sessionOf(thread, now);
      if (!session) continue;
      if (query.since !== undefined && session.updatedAt < query.since) {
        older = true;
        continue;
      }
      if (query.cwd !== undefined && !(session.cwd && isWithin(session.cwd, query.cwd))) continue;
      sessions.push(session);
    }
    cursor = isRecord(result) && typeof result.nextCursor === 'string' ? result.nextCursor : null;
    // Newest first: after a thread from before `since`, the rest is older still.
    if (!cursor || older || !data.length) break;
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, query.limit);
}

function inputText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
    .trim();
}

function resultText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (isRecord(value) && Array.isArray(value.content)) {
    const texts = value.content.flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []));
    if (texts.length) return texts.join('\n');
  }
  return JSON.stringify(value);
}

/** The turns of a stored thread as the app server gives them (`thread/turns/list`), oldest first. */
export function codexTurns(turns: readonly unknown[], options: SessionReadOptions = {}): SessionTurn[] {
  const builder = transcriptBuilder('codex', options);
  const ms = (seconds: unknown) => (typeof seconds === 'number' ? seconds * 1000 : undefined);
  for (const turn of turns) {
    if (!isRecord(turn) || !Array.isArray(turn.items)) continue;
    const started = ms(turn.startedAt);
    const ended = ms(turn.completedAt);
    for (const item of turn.items) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === 'string' ? item.id : undefined;
      const from = typeof item.startedAtMs === 'number' ? item.startedAtMs : started;
      const to = typeof item.completedAtMs === 'number' ? item.completedAtMs : (ended ?? from);
      if (item.type === 'userMessage') {
        const text = inputText(item.content);
        if (text) builder.prompt(text, from);
      } else if ((item.type === 'agentMessage' || item.type === 'plan') && typeof item.text === 'string') {
        builder.text(item.text, to);
      } else if (item.type === 'commandExecution') {
        builder.tool(id, 'shell', { command: item.command, cwd: item.cwd }, from);
        const failed = typeof item.exitCode === 'number' && item.exitCode !== 0;
        builder.toolResult(id, resultText(item.aggregatedOutput), failed, to);
      } else if (item.type === 'fileChange') {
        const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
        builder.tool(id, 'apply_patch', { files: changes.map((change) => change.path) }, from);
        builder.toolResult(
          id,
          changes.map((change) => `${String(change.path)}\n${String(change.diff ?? '')}`).join('\n'),
          item.status === 'failed',
          to,
        );
      } else if (item.type === 'mcpToolCall') {
        builder.tool(id, `${String(item.server)}.${String(item.tool)}`, item.arguments, from);
        builder.toolResult(id, resultText(item.error ?? item.result), Boolean(item.error), to);
      } else if (item.type === 'dynamicToolCall') {
        builder.tool(id, String(item.tool), item.arguments, from);
        builder.toolResult(id, resultText(item.contentItems), item.success === false, to);
      } else if (item.type === 'webSearch') {
        builder.tool(id, 'web_search', { query: item.query }, from);
        builder.toolResult(id, undefined, false, to);
      }
    }
  }
  return builder.turns();
}

/** What was said in a thread, asked of the app server: the latest `maxTurns` turns. */
export async function readCodexThread(
  server: CodexServer,
  id: string,
  options: SessionReadOptions = {},
): Promise<SessionTurn[]> {
  const wanted = options.maxTurns ?? 100;
  const turns: unknown[] = [];
  let cursor: string | null = null;
  // Newest first, a page at a time, until there are enough.
  while (turns.length < wanted) {
    const result = await server.request('thread/turns/list', {
      threadId: id,
      cursor,
      limit: Math.min(50, wanted - turns.length),
      sortDirection: 'desc',
      itemsView: 'full',
    });
    const data = isRecord(result) && Array.isArray(result.data) ? result.data : [];
    turns.push(...data);
    cursor = isRecord(result) && typeof result.nextCursor === 'string' ? result.nextCursor : null;
    if (!cursor || !data.length) break;
  }
  if (cursor && turns.length >= wanted) options.onTruncated?.('max-turns');
  return codexTurns(turns.reverse(), options);
}
