import path from 'node:path';
import {
  ACTIVE_MS,
  ending,
  findFiles,
  homeOf,
  headAndTail,
  isRecord,
  isWithin,
  mapLimited,
  oneLine,
  type SessionFile,
} from './files.js';
import type { SessionInfo, SessionSource } from './types.js';

export interface ClaudeSessionsOptions {
  /** Claude Code's config directory. Default `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
  dir?: string;
  env?: NodeJS.ProcessEnv;
}

// Text Claude Code writes into user turns itself: commands, hook output, injected context.
const NOT_A_PROMPT = /^(<[a-z][\w-]*[\s>]|Caveat: |\[Request interrupted)/;

function textOf(content: unknown, type: string): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((block) =>
    isRecord(block) && block.type === type && typeof block.text === 'string' ? [block.text] : [],
  );
  return parts.length ? parts.join('\n') : undefined;
}

/** What the user typed in a transcript line, or undefined for tool results and Claude Code's own notes. */
function promptOf(line: Record<string, unknown>): string | undefined {
  if (line.type !== 'user' || line.isMeta === true || line.isSidechain === true || !isRecord(line.message))
    return undefined;
  const text = textOf(line.message.content, 'text')?.trim();
  return text && !NOT_A_PROMPT.test(text) ? text : undefined;
}

/** Read one Claude Code transcript (`<config>/projects/<project>/<session>.jsonl`). */
export async function readClaudeSession(file: SessionFile, now = Date.now()): Promise<SessionInfo | null> {
  const { head, tail } = await headAndTail(file);
  const info: SessionInfo = {
    source: 'claude',
    agent: 'claude',
    id: path.basename(file.path, '.jsonl'),
    where: 'local',
    updatedAt: file.mtimeMs,
    path: file.path,
  };
  let conversed = false;
  for (const line of head) {
    if (!isRecord(line)) continue;
    if (line.isSidechain === true) return null;
    if (typeof line.cwd === 'string' && !info.cwd) info.cwd = line.cwd;
    if (typeof line.timestamp === 'string' && info.startedAt === undefined) {
      const at = Date.parse(line.timestamp);
      if (!Number.isNaN(at)) info.startedAt = at;
    }
    if (line.type === 'user' || line.type === 'assistant') conversed = true;
    const prompt = promptOf(line);
    if (prompt && !info.firstPrompt) info.firstPrompt = oneLine(prompt);
  }
  let agentLast = false;
  for (const line of tail) {
    if (!isRecord(line)) continue;
    // The directory it started in names the project; later lines follow the agent's `cd`.
    if (typeof line.cwd === 'string' && !info.cwd) info.cwd = line.cwd;
    if (typeof line.gitBranch === 'string' && line.gitBranch && line.gitBranch !== 'HEAD') info.branch = line.gitBranch;
    if (line.type === 'summary' && typeof line.summary === 'string') info.title = oneLine(line.summary, 120);
    if (line.type === 'ai-title' && typeof line.aiTitle === 'string') info.title = oneLine(line.aiTitle, 120);
    if (line.type === 'custom-title' && typeof line.customTitle === 'string')
      info.title = oneLine(line.customTitle, 120);
    if (line.type === 'cost-state' && typeof line.totalCostUSD === 'number') info.costUsd = line.totalCostUSD;
    if (line.type === 'user' || line.type === 'assistant') conversed = true;
    const prompt = promptOf(line);
    if (prompt) {
      info.lastPrompt = oneLine(prompt);
      agentLast = false;
    } else if (line.type === 'user' && line.isMeta !== true) {
      // A tool result: the agent was in the middle of its turn.
      agentLast = false;
    }
    if (line.type === 'assistant' && line.isSidechain !== true && isRecord(line.message)) {
      if (typeof line.message.model === 'string' && line.message.model !== '<synthetic>')
        info.model = line.message.model;
      const text = textOf(line.message.content, 'text')?.trim();
      if (text) info.lastReply = ending(text);
      const content = line.message.content;
      const callsTool = Array.isArray(content) && content.some((block) => isRecord(block) && block.type === 'tool_use');
      agentLast = !callsTool && !!text;
    }
  }
  if (!conversed) return null;
  info.lastPrompt ??= info.firstPrompt;
  info.state = now - file.mtimeMs < ACTIVE_MS ? 'active' : agentLast ? 'waiting' : 'unfinished';
  return info;
}

/** Sessions Claude Code keeps on this machine. */
export function claudeSessions(options: ClaudeSessionsOptions = {}): SessionSource {
  return {
    name: 'claude',
    where: 'local',
    async list(query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? env.CLAUDE_CONFIG_DIR ?? path.join(homeOf(env), '.claude');
      // projects/<project>/<session>.jsonl; deeper files are subagent transcripts.
      const files = (await findFiles(path.join(dir, 'projects'), 1, (name) => name.endsWith('.jsonl'))).filter(
        (file) => query.since === undefined || file.mtimeMs >= query.since,
      );
      const sessions: SessionInfo[] = [];
      const wanted = query.limit ?? Infinity;
      // Newest first, a batch at a time, so a small `limit` does not open every file.
      for (let at = 0; at < files.length && sessions.length < wanted; at += 32) {
        query.signal?.throwIfAborted();
        const batch = await mapLimited(files.slice(at, at + 32), 8, (file) =>
          readClaudeSession(file).catch(() => null),
        );
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
