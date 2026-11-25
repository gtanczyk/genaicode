import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TokenUsage } from '../../core/types.js';
import {
  ACTIVE_MS,
  activeIfRecent,
  ending,
  findFiles,
  findLastLineMatch,
  chunksOf,
  headAndTail,
  homeOf,
  isRecord,
  isWithin,
  mapLimited,
  oneLine,
  promptLine,
  select,
  timeOf,
  type SessionFile,
} from './files.js';
import { personText } from '../host-text.js';
import type { SessionTurn } from '../session.js';
import type { AgentMode } from '../types.js';
import { linesOf, transcriptBuilder, transcriptLines, zstdFile } from './transcript.js';
import { number, queryDatabase, tableColumns, text } from './sqlite.js';
import type { SessionInfo, SessionQuery, SessionReadOptions, SessionSource } from './types.js';
import { findExecutable } from '../discovery.js';
import { codexThreads, openCodexServer, readCodexThread, type CodexServer } from './codex-api.js';

export interface CodexSessionsOptions {
  /** Codex's home directory. Default `$CODEX_HOME`, else `~/.codex`. */
  dir?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * How to get at the sessions. `files` (default): read Codex's index and rollouts, which changes
   * nothing. `app-server`: ask Codex's own app server (`thread/list`, `thread/turns/list`), which
   * holds across Codex versions but starts a Codex process that keeps its state and logs in
   * Codex's home; the files are read when it cannot be asked. `auto`: the app server when the
   * `codex` command is installed. `$GENAICODE_CODEX_SESSIONS` sets it from outside.
   */
  via?: CodexSessionsVia;
  /** The Codex executable for `app-server`. Default `codex`. */
  command?: string;
}

export type CodexSessionsVia = 'files' | 'app-server' | 'auto';

const ROLLOUT_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

function usageOf(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: TokenUsage = {};
  if (typeof value.input_tokens === 'number') usage.inputTokens = value.input_tokens;
  if (typeof value.cached_input_tokens === 'number') usage.cachedInputTokens = value.cached_input_tokens;
  if (typeof value.output_tokens === 'number') usage.outputTokens = value.output_tokens;
  if (typeof value.total_tokens === 'number') usage.totalTokens = value.total_tokens;
  return Object.keys(usage).length ? usage : undefined;
}

/** A user or assistant message of the model's own history; Codex's injected context is not a prompt. */
function itemText(payload: Record<string, unknown>, role: string): string | undefined {
  if (payload.type !== 'message' || payload.role !== role || !Array.isArray(payload.content)) return undefined;
  const text = payload.content
    .flatMap((block) => (isRecord(block) && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
    .trim();
  // Only user records carry the injected context (`<environment_context>`); an answer may start with markup.
  return text && !(role === 'user' && text.startsWith('<')) ? text : undefined;
}

const codexModeCache = new Map<string, AgentMode | undefined>();

function turnContextMode(line: string): { found: true; value: AgentMode | undefined } | { found: false } {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed) || parsed.type !== 'turn_context' || !isRecord(parsed.payload)) return { found: false };
    const cm = parsed.payload.collaboration_mode;
    const mode = isRecord(cm) && (cm.mode === 'plan' || cm.mode === 'default') ? cm.mode : undefined;
    return { found: true, value: mode };
  } catch {
    return { found: false };
  }
}

/** Resolve the latest `turn_context` mode of a large rollout, cached by file revision. */
async function resolveCodexMode(info: SessionInfo, signal?: AbortSignal): Promise<void> {
  if (!info.path || info.mode !== undefined) return;
  try {
    const stat = await fs.stat(info.path).catch(() => undefined);
    if (stat) {
      if (stat.size <= 512 * 1024) return;
      const key = `${info.path}:${stat.mtimeMs}:${stat.size}`;
      if (codexModeCache.has(key)) {
        const cached = codexModeCache.get(key);
        if (cached) info.mode = cached;
        return;
      }
      const mode = await findLastLineMatch(info.path, stat.size, '"turn_context"', turnContextMode, signal);
      if (codexModeCache.size >= 256) codexModeCache.clear();
      codexModeCache.set(key, mode);
      if (mode) info.mode = mode;
      return;
    }
    const zstPath = `${info.path}.zst`;
    const zstStat = await fs.stat(zstPath).catch(() => undefined);
    if (!zstStat) return;
    const key = `${zstPath}:${zstStat.mtimeMs}:${zstStat.size}`;
    if (codexModeCache.has(key)) {
      const cached = codexModeCache.get(key);
      if (cached) info.mode = cached;
      return;
    }
    const data = await zstdFile(zstPath);
    if (!data) return;
    const mode = lastTurnContextModeInBuffer(data);
    if (codexModeCache.size >= 256) codexModeCache.clear();
    codexModeCache.set(key, mode);
    if (mode) info.mode = mode;
  } catch {
    signal?.throwIfAborted();
  }
}

function lastTurnContextModeInBuffer(data: Buffer): AgentMode | undefined {
  const needle = Buffer.from('"turn_context"', 'utf8');
  let cursor = data.length;
  while (cursor > 0) {
    const nl = data.lastIndexOf(0x0a, cursor - 1);
    const slice = data.subarray(nl + 1, cursor);
    if (slice.length && slice.includes(needle)) {
      const result = turnContextMode(slice.toString('utf8'));
      if (result.found) return result.value;
    }
    if (nl < 0) break;
    cursor = nl;
  }
  return undefined;
}

/** Read one Codex rollout (`<home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`). */
export async function readCodexSession(file: SessionFile, now = Date.now()): Promise<SessionInfo | null> {
  return fromLines(file, now, await headAndTail(file));
}

function fromLines(file: SessionFile, now: number, { head, tail }: { head: unknown[]; tail: unknown[] }) {
  const id = ROLLOUT_ID.exec(file.path)?.[1];
  const info: SessionInfo = {
    source: 'codex',
    agent: 'codex',
    id: id ?? path.basename(file.path, '.jsonl'),
    where: 'local',
    updatedAt: file.mtimeMs,
    path: file.path,
  };
  let agentLast = false;
  let conversed = false;
  let subagent = false;
  const scan = (lines: unknown[], first: boolean) => {
    for (const line of lines) {
      if (!isRecord(line)) continue;
      // Rollouts before the typed format start with the bare session meta.
      const payload = isRecord(line.payload) ? line.payload : line.type === undefined ? line : undefined;
      if (!payload) continue;
      if (line.type === 'session_meta' || line.type === undefined) {
        // A helper thread another session started, as the thread index marks them.
        if (JSON.stringify(payload.source ?? '').includes('subagent')) subagent = true;
        // `codex exec`: a headless run nobody typed into.
        if (payload.source === 'exec' || payload.originator === 'codex_exec') info.automated = true;
        if (typeof payload.id === 'string') info.id = payload.id;
        if (typeof payload.cwd === 'string') info.cwd = payload.cwd;
        if (typeof payload.timestamp === 'string') {
          const at = Date.parse(payload.timestamp);
          if (!Number.isNaN(at)) info.startedAt = at;
        }
        if (isRecord(payload.git)) {
          if (typeof payload.git.branch === 'string') info.branch = payload.git.branch;
          if (typeof payload.git.repository_url === 'string') info.repository = payload.git.repository_url;
        }
      }
      if (line.type === 'turn_context') {
        if (typeof payload.cwd === 'string' && !info.cwd) info.cwd = payload.cwd;
        if (typeof payload.model === 'string') info.model = payload.model;
        // Only record collaboration mode from `tail` (which is the whole file when small) so a
        // large rollout's stale `head` turn_context cannot mask a newer one in the middle.
        if (!first && isRecord(payload.collaboration_mode)) {
          const mode = payload.collaboration_mode.mode;
          if (mode === 'plan' || mode === 'default') info.mode = mode;
        }
      }
      let prompt: string | undefined;
      let reply: string | undefined;
      if (line.type === 'event_msg') {
        if (payload.type === 'user_message' && typeof payload.message === 'string') prompt = payload.message.trim();
        if (payload.type === 'agent_message' && typeof payload.message === 'string') reply = payload.message.trim();
        if (payload.type === 'token_count' && isRecord(payload.info)) {
          const usage = usageOf(payload.info.total_token_usage);
          if (usage) info.usage = usage;
        }
        if (payload.type === 'task_complete' || payload.type === 'turn_complete') agentLast = true;
        if (payload.type === 'turn_aborted' || payload.type === 'task_started') agentLast = false;
      } else if (line.type === 'token_usage_record') {
        const usage = usageOf(payload.thread_token_usage);
        if (usage) info.usage = usage;
      } else if (line.type === 'response_item') {
        prompt = itemText(payload, 'user');
        reply = itemText(payload, 'assistant');
        if (/_call$/.test(String(payload.type))) agentLast = false;
      }
      if (prompt) {
        conversed = true;
        if (first && !info.firstPrompt) info.firstPrompt = promptLine(prompt);
        if (!first) info.lastPrompt = promptLine(prompt);
        agentLast = false;
      }
      if (reply) {
        conversed = true;
        if (!first) info.lastReply = ending(reply);
        agentLast = true;
      }
    }
  };
  scan(head, true);
  agentLast = false;
  scan(tail, false);
  if (!conversed || subagent) return null;
  info.lastPrompt ??= info.firstPrompt;
  info.state = now - file.mtimeMs < ACTIVE_MS ? 'active' : agentLast ? 'waiting' : 'unfinished';
  return info;
}

/** The newest `state_<n>.sqlite` in Codex's home: its thread index. */
async function stateDatabase(dir: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return undefined;
  }
  const versions = names
    .flatMap((name) => {
      const match = /^state_(\d+)\.sqlite$/.exec(name);
      return match ? [{ name, version: Number(match[1]) }] : [];
    })
    .sort((a, b) => b.version - a.version);
  return versions[0] ? path.join(dir, versions[0].name) : undefined;
}

/**
 * Whether nobody typed into a thread, as the index says: a headless `codex exec`, or a thread the
 * desktop app's server ran for another program (`thread_source` is `user` for those somebody
 * started). Threads genaicode started are somebody's chat in an app built on it, and stay.
 */
function unattended(row: Record<string, unknown>): boolean {
  if (text(row.source) === 'exec' || text(row.originator) === 'codex_exec') return true;
  return row.thread_source === '' && text(row.originator) === 'Codex Desktop';
}

/** A project of the Codex desktop app: its name and the directories it holds. */
export interface CodexProject {
  id: string;
  name: string;
  roots: string[];
}

/**
 * The projects the Codex desktop app keeps (`projects` and `project_roots` of its index), for
 * `folderTopics()`. Empty when this Codex keeps none.
 */
export async function codexProjects(options: Pick<CodexSessionsOptions, 'dir' | 'env'> = {}): Promise<CodexProject[]> {
  const env = options.env ?? process.env;
  const file = await stateDatabase(options.dir ?? env.CODEX_HOME ?? path.join(homeOf(env), '.codex'));
  if (!file) return [];
  try {
    const [named, placed] = await Promise.all([tableColumns(file, 'projects'), tableColumns(file, 'project_roots')]);
    if (!named?.has('id') || !named.has('name') || !placed?.has('project_id') || !placed.has('path')) return [];
    const roots = (await queryDatabase(file, 'SELECT project_id, path FROM project_roots')) ?? [];
    return ((await queryDatabase(file, 'SELECT id, name FROM projects')) ?? []).flatMap((row): CodexProject[] => {
      const id = text(row.id) ?? (number(row.id) === undefined ? undefined : String(number(row.id)));
      const name = text(row.name);
      if (!id || !name) return [];
      const own = roots
        .filter((root) => String(root.project_id) === id)
        .flatMap((root) => (text(root.path) ? [text(root.path)!] : []));
      return own.length ? [{ id, name, roots: own }] : [];
    });
  } catch {
    return [];
  }
}

/** Threads from Codex's own index, or null when this Codex keeps none (older versions). */
async function indexedSessions(dir: string, prefix = ''): Promise<SessionInfo[] | null> {
  const file = await stateDatabase(dir);
  if (!file) return null;
  const wanted = [
    'id',
    'rollout_path',
    'cwd',
    'title',
    'name',
    'first_user_message',
    'model',
    'tokens_used',
    'git_branch',
    'git_origin_url',
    'created_at',
    'created_at_ms',
    'updated_at',
    'updated_at_ms',
    'source',
    'thread_source',
    'originator',
    'archived',
  ];
  const columns = await tableColumns(file, 'threads');
  if (!columns?.has('id')) return null;
  const present = wanted.filter((column) => columns.has(column));
  const sql = `SELECT ${present.join(', ')} FROM threads`;
  const found =
    (await queryDatabase(
      file,
      prefix ? sql + ' WHERE substr(id, 1, length(?)) = ?' : sql,
      prefix ? [prefix, prefix] : [],
    )) ?? [];
  return found.flatMap((row): SessionInfo[] => {
    const id = text(row.id);
    const seconds = number(row.updated_at) ?? number(row.created_at);
    const updatedAt = number(row.updated_at_ms) ?? (seconds === undefined ? undefined : seconds * 1000);
    // Subagent threads (reviewers, spawned helpers) are not conversations the user had.
    if (!id || updatedAt === undefined || number(row.archived) === 1 || /subagent/.test(text(row.source) ?? ''))
      return [];
    const created =
      number(row.created_at_ms) ?? (number(row.created_at) === undefined ? undefined : number(row.created_at)! * 1000);
    const first = text(row.first_user_message);
    // Codex stores the first user message as `title`: a briefing an older pack() put there is not a name.
    const named = text(row.name) ?? (text(row.title) ? personText(text(row.title)!) || undefined : undefined);
    const tokens = number(row.tokens_used);
    const rollout = text(row.rollout_path);
    return [
      {
        source: 'codex',
        agent: 'codex',
        id,
        where: 'local',
        updatedAt,
        ...(unattended(row) ? { automated: true as const } : {}),
        ...(text(row.cwd) ? { cwd: text(row.cwd)! } : {}),
        ...(text(row.git_branch) ? { branch: text(row.git_branch)! } : {}),
        ...(text(row.git_origin_url) ? { repository: text(row.git_origin_url)! } : {}),
        ...(named ? { title: oneLine(named, 120) } : {}),
        ...(first ? { firstPrompt: promptLine(first), lastPrompt: promptLine(first) } : {}),
        ...(created !== undefined ? { startedAt: created } : {}),
        ...(text(row.model) ? { model: text(row.model)! } : {}),
        ...(tokens ? { usage: { totalTokens: tokens } } : {}),
        ...(rollout ? { path: rollout } : {}),
        ...activeIfRecent(updatedAt),
      },
    ];
  });
}

/** Add the latest prompt, reply and state from a thread's rollout: a `.jsonl`, or the `.jsonl.zst` Codex made of it. */
async function fromRollout(info: SessionInfo): Promise<void> {
  if (!info.path) return;
  try {
    let read: SessionInfo | null;
    const stat = await fs.stat(info.path).catch(() => undefined);
    // Whether it is active is the index's to say (its own `updatedAt`), not the file's.
    if (stat) read = await readCodexSession({ path: info.path, mtimeMs: stat.mtimeMs, size: stat.size }, Infinity);
    else {
      const data = await zstdFile(`${info.path}.zst`);
      if (!data) return;
      read = fromLines({ path: info.path, mtimeMs: 0, size: data.length }, Infinity, chunksOf(data));
    }
    if (!read) return;
    if (read.lastPrompt) info.lastPrompt = read.lastPrompt;
    if (read.lastReply) info.lastReply = read.lastReply;
    if (read.usage) info.usage = read.usage;
    if (read.mode) info.mode = read.mode;
    if (read.automated) info.automated = true;
    // A state the app server reported (it asks for approval) is not the rollout's to change.
    if (info.state !== 'active' && !info.waitingFor) info.state = read.state;
  } catch {
    // Gone, or compressed where this Node has no zstd: the index row is what there is.
  }
}

function outputText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  // Newer rollouts: `{ content, success }` or content blocks.
  if (isRecord(value) && typeof value.content === 'string') return value.content;
  return JSON.stringify(value);
}

function callInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** The turns in the lines of a Codex rollout. */
export function codexTranscript(lines: readonly unknown[], options: SessionReadOptions = {}): SessionTurn[] {
  const builder = transcriptBuilder('codex', options);
  const payloadOf = (line: unknown) => (isRecord(line) && isRecord(line.payload) ? line.payload : undefined);
  // Newer rollouts say each message twice, as an event and as an item of the model's history;
  // one file can hold both formats. The second saying of a message is left out.
  let saidPrompt: string | undefined;
  let saidReply: string | undefined;
  const prompt = (text: string, at: number | undefined) => {
    if (text === saidPrompt) return;
    builder.prompt(text, at);
    saidPrompt = text;
    saidReply = undefined;
  };
  const reply = (text: string, at: number | undefined) => {
    if (text === saidReply) return;
    builder.text(text, at);
    saidReply = text;
    saidPrompt = undefined;
  };
  for (const line of lines) {
    const payload = payloadOf(line);
    if (!isRecord(line) || !payload) continue;
    const at = timeOf(line.timestamp);
    if (line.type === 'event_msg') {
      if (payload.type === 'user_message' && typeof payload.message === 'string' && payload.message.trim()) {
        prompt(payload.message.trim(), at);
      }
      if (payload.type === 'agent_message' && typeof payload.message === 'string' && payload.message.trim()) {
        reply(payload.message.trim(), at);
      }
    } else if (line.type === 'response_item') {
      const asked = itemText(payload, 'user');
      if (asked) prompt(asked, at);
      const answered = itemText(payload, 'assistant');
      if (answered) reply(answered, at);
      const id = typeof payload.call_id === 'string' ? payload.call_id : undefined;
      const called =
        payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'local_shell_call';
      // Work between two sayings of a message means the second one is a new message.
      if (called) saidPrompt = saidReply = undefined;
      if (payload.type === 'function_call' && typeof payload.name === 'string') {
        builder.tool(id, payload.name, callInput(payload.arguments), at);
      } else if (payload.type === 'custom_tool_call' && typeof payload.name === 'string') {
        builder.tool(id, payload.name, payload.input, at);
      } else if (payload.type === 'local_shell_call') {
        builder.tool(id, 'shell', payload.action, at);
      } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
        builder.toolResult(id, outputText(payload.output), false, at);
      }
    }
  }
  return builder.turns();
}

/**
 * Sessions the Codex CLI keeps on this machine: its thread index (`state_<n>.sqlite`) where there
 * is one, else the rollout files under `sessions/`.
 */
export function codexSessions(options: CodexSessionsOptions = {}): SessionSource {
  const envOf = (query?: SessionQuery) => query?.env ?? options.env ?? process.env;
  const dirOf = (env: NodeJS.ProcessEnv) => options.dir ?? env.CODEX_HOME ?? path.join(homeOf(env), '.codex');
  /** Ask Codex's app server, when this source may and can; undefined says to read the files. */
  const ask = async <T>(
    env: NodeJS.ProcessEnv,
    signal: AbortSignal | undefined,
    question: (server: CodexServer) => Promise<T>,
    always = false,
  ): Promise<T | undefined> => {
    const chosen = options.via ?? env.GENAICODE_CODEX_SESSIONS ?? 'files';
    const command = options.command ?? 'codex';
    if (!always && chosen !== 'app-server' && chosen !== 'auto') return undefined;
    if (!findExecutable(command, env)) return undefined;
    let server: CodexServer | undefined;
    try {
      server = await openCodexServer({ command, dir: dirOf(env), env, ...(signal ? { signal } : {}) });
      return await question(server);
    } catch {
      signal?.throwIfAborted();
      return undefined;
    } finally {
      server?.close();
    }
  };
  // Where each session listed through the app server came from, so reading it asks the same one.
  const listedIn = new Map<string, NodeJS.ProcessEnv>();
  const listed = async (query: SessionQuery, always = false, prefix = '') => {
    const env = envOf(query);
    const found = await ask(
      env,
      query.signal,
      (server) => codexThreads(server, prefix ? { ...query, limit: undefined } : query),
      always,
    );
    const threads = prefix ? found?.filter((thread) => thread.id.startsWith(prefix)).slice(0, query.limit) : found;
    if (threads?.length) {
      for (const thread of threads) listedIn.set(thread.id, env);
      // Kept small: the latest listings are the ones read from.
      for (const id of [...listedIn.keys()].slice(0, Math.max(0, listedIn.size - 2000))) listedIn.delete(id);
      await mapLimited(threads.slice(0, 200), 8, fromRollout);
    }
    return threads;
  };
  const list = async (query: SessionQuery = {}, prefix = '') => {
    const env = envOf(query);
    const dir = dirOf(env);
    // An app server that lists nothing may just not know this home: the files say.
    const threads = await listed(query, false, prefix);
    if (threads?.length) return threads;
    const indexed = await indexedSessions(dir, prefix);
    if (indexed) {
      // Resolve an old thread's state from its own rollout even outside the newest 200.
      const chosen = select(indexed, query);
      await mapLimited(chosen.slice(0, 200), 8, fromRollout);
      return chosen;
    }
    const files = (
      await findFiles(
        path.join(dir, 'sessions'),
        3,
        (name) =>
          name.startsWith('rollout-') &&
          name.endsWith('.jsonl') &&
          (!prefix || (ROLLOUT_ID.exec(name)?.[1]?.startsWith(prefix) ?? true)),
      )
    ).filter((file) => query.since === undefined || file.mtimeMs >= query.since);
    const sessions: SessionInfo[] = [];
    const wanted = query.limit ?? Infinity;
    for (let at = 0; at < files.length && sessions.length < wanted; at += 32) {
      query.signal?.throwIfAborted();
      const batch = await mapLimited(files.slice(at, at + 32), 8, (file) => readCodexSession(file).catch(() => null));
      for (const session of batch) {
        if (!session || !session.id.startsWith(prefix)) continue;
        if (query.cwd !== undefined && !(session.cwd && isWithin(session.cwd, query.cwd))) continue;
        sessions.push(session);
      }
    }
    return sessions.slice(0, query.limit);
  };
  return {
    name: 'codex',
    where: 'local',
    verified: '0.170',
    reference: (query = {}) => listed(query, true),
    list,
    async find(id, query) {
      const found = await list(query, id);
      await mapLimited(found, 8, (session) => resolveCodexMode(session, query?.signal));
      return found;
    },
    async read(session, readOptions) {
      const env = listedIn.get(session.id) ?? envOf();
      const turns = await ask(env, undefined, (server) => readCodexThread(server, session.id, readOptions));
      if (turns?.length) return turns;
      if (!session.path) throw new Error(`Session ${session.id} has no rollout file.`);
      const plain = await transcriptLines(session.path, readOptions).catch(() => undefined);
      if (plain) return codexTranscript(plain, readOptions);
      const packed = await zstdFile(`${session.path}.zst`);
      if (!packed) throw new Error(`Cannot read the rollout of session ${session.id}.`);
      return codexTranscript(linesOf(packed, readOptions), readOptions);
    },
  };
}
