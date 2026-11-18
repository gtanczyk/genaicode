import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TokenUsage } from '../../core/types.js';
import {
  ACTIVE_MS,
  activeIfRecent,
  ending,
  findFiles,
  headAndTail,
  homeOf,
  isRecord,
  isWithin,
  mapLimited,
  oneLine,
  select,
  type SessionFile,
} from './files.js';
import { number, queryDatabase, tableColumns, text } from './sqlite.js';
import type { SessionInfo, SessionSource } from './types.js';

export interface CodexSessionsOptions {
  /** Codex's home directory. Default `$CODEX_HOME`, else `~/.codex`. */
  dir?: string;
  env?: NodeJS.ProcessEnv;
}

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
  return text && !text.startsWith('<') ? text : undefined;
}

/** Read one Codex rollout (`<home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`). */
export async function readCodexSession(file: SessionFile, now = Date.now()): Promise<SessionInfo | null> {
  const { head, tail } = await headAndTail(file);
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
  const scan = (lines: unknown[], first: boolean) => {
    for (const line of lines) {
      if (!isRecord(line)) continue;
      // Rollouts before the typed format start with the bare session meta.
      const payload = isRecord(line.payload) ? line.payload : line.type === undefined ? line : undefined;
      if (!payload) continue;
      if (line.type === 'session_meta' || line.type === undefined) {
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
        if (first && !info.firstPrompt) info.firstPrompt = oneLine(prompt);
        if (!first) info.lastPrompt = oneLine(prompt);
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
  if (!conversed) return null;
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

/** Threads from Codex's own index, or null when this Codex keeps none (older versions). */
async function indexedSessions(dir: string): Promise<SessionInfo[] | null> {
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
    'archived',
  ];
  const columns = await tableColumns(file, 'threads');
  if (!columns?.has('id')) return null;
  const present = wanted.filter((column) => columns.has(column));
  const found = (await queryDatabase(file, `SELECT ${present.join(', ')} FROM threads`)) ?? [];
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
    const named = text(row.name) ?? text(row.title);
    const tokens = number(row.tokens_used);
    const rollout = text(row.rollout_path);
    return [
      {
        source: 'codex',
        agent: 'codex',
        id,
        where: 'local',
        updatedAt,
        ...(text(row.cwd) ? { cwd: text(row.cwd)! } : {}),
        ...(text(row.git_branch) ? { branch: text(row.git_branch)! } : {}),
        ...(text(row.git_origin_url) ? { repository: text(row.git_origin_url)! } : {}),
        ...(named ? { title: oneLine(named, 120) } : {}),
        ...(first ? { firstPrompt: oneLine(first), lastPrompt: oneLine(first) } : {}),
        ...(created !== undefined ? { startedAt: created } : {}),
        ...(text(row.model) ? { model: text(row.model)! } : {}),
        ...(tokens ? { usage: { totalTokens: tokens } } : {}),
        ...(rollout ? { path: rollout } : {}),
        ...activeIfRecent(updatedAt),
      },
    ];
  });
}

/** Add the latest prompt, reply and state from a thread's rollout, when it is still a plain `.jsonl`. */
async function fromRollout(info: SessionInfo): Promise<void> {
  if (!info.path) return;
  try {
    const stat = await fs.stat(info.path);
    // Whether it is active is the index's to say (its own `updatedAt`), not the file's.
    const read = await readCodexSession({ path: info.path, mtimeMs: stat.mtimeMs, size: stat.size }, Infinity);
    if (!read) return;
    if (read.lastPrompt) info.lastPrompt = read.lastPrompt;
    if (read.lastReply) info.lastReply = read.lastReply;
    if (read.usage) info.usage = read.usage;
    if (info.state !== 'active') info.state = read.state;
  } catch {
    // Compressed (`.jsonl.zst`) or gone: the index row is what there is.
  }
}

/**
 * Sessions the Codex CLI keeps on this machine: its thread index (`state_<n>.sqlite`) where there
 * is one, else the rollout files under `sessions/`.
 */
export function codexSessions(options: CodexSessionsOptions = {}): SessionSource {
  return {
    name: 'codex',
    where: 'local',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? env.CODEX_HOME ?? path.join(homeOf(env), '.codex');
      const indexed = await indexedSessions(dir);
      if (indexed) {
        const chosen = select(indexed, query);
        await mapLimited(chosen.slice(0, 200), 8, fromRollout);
        return chosen;
      }
      const files = (
        await findFiles(path.join(dir, 'sessions'), 3, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'))
      ).filter((file) => query.since === undefined || file.mtimeMs >= query.since);
      const sessions: SessionInfo[] = [];
      const wanted = query.limit ?? Infinity;
      for (let at = 0; at < files.length && sessions.length < wanted; at += 32) {
        query.signal?.throwIfAborted();
        const batch = await mapLimited(files.slice(at, at + 32), 8, (file) => readCodexSession(file).catch(() => null));
        for (const session of batch) {
          if (!session) continue;
          if (query.cwd !== undefined && !(session.cwd && isWithin(session.cwd, query.cwd))) continue;
          sessions.push(session);
        }
      }
      return sessions.slice(0, query.limit);
    },
  };
}
