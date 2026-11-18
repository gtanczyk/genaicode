import { homedir } from 'node:os';
import path from 'node:path';
import type { TokenUsage } from '../../core/types.js';
import {
  ACTIVE_MS,
  ending,
  findFiles,
  headAndTail,
  isRecord,
  isWithin,
  mapLimited,
  oneLine,
  type SessionFile,
} from './files.js';
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
      } else if (line.type === 'response_item') {
        prompt = itemText(payload, 'user');
        reply = itemText(payload, 'assistant');
        if (payload.type === 'function_call' || payload.type === 'local_shell_call') agentLast = false;
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

/** Sessions the Codex CLI keeps on this machine. */
export function codexSessions(options: CodexSessionsOptions = {}): SessionSource {
  return {
    name: 'codex',
    where: 'local',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? env.CODEX_HOME ?? path.join(env.HOME ?? homedir(), '.codex');
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
