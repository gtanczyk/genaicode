import path from 'node:path';
import {
  ACTIVE_MS,
  ending,
  findFiles,
  findLastLineMatch,
  homeOf,
  headAndTail,
  isRecord,
  isWithin,
  mapLimited,
  oneLine,
  promptLine,
  timeOf,
  type SessionFile,
} from './files.js';
import type { SessionTurn } from '../session.js';
import type { AgentMode } from '../types.js';
import { personText } from '../host-text.js';
import { transcriptBuilder, transcriptLines } from './transcript.js';
import type { SessionInfo, SessionReadOptions, SessionSource } from './types.js';

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

// Prompts that reach Claude Code wrapped: a scheduled task, a message relayed from another session, a paste, `!cmd`.
const WRAPPED_PROMPT = /^<(scheduled-task|relay|wake|pasted_content|bash-input)[\s>]/;

const SCHEDULED = /^\s*<scheduled-task[\s>]/;
// How a session relayed from a claude.ai project names it: by id in a message's envelope, and by
// name in the snapshot of its instructions.
const PROJECT_ID = /<project id="(chan_[A-Za-z0-9]+)"/;
const PROJECT_LINES = 6;
const PROJECT_NAMED = /Project: "([^"\n]{1,120})" \(id: `?(chan_[A-Za-z0-9]+)`?\)/;
// The thread of that project the session works for, as its title there.
const PROJECT_TOPIC = /\nTopic: "([^"\n]{1,200})"/;
const messageOf = (line: Record<string, unknown>): unknown =>
  isRecord(line.message) ? line.message.content : undefined;

/** A wrapped prompt without its tags. */
function unwrapped(text: string): string | undefined {
  if (!WRAPPED_PROMPT.test(text)) return undefined;
  // One pass, not a regular expression: a transcript can hold megabytes of `<`.
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<', at);
    const close = open < 0 ? -1 : text.indexOf('>', open);
    if (close < 0) break;
    out += `${text.slice(at, open)} `;
    at = close + 1;
  }
  return (out + text.slice(at)).trim() || undefined;
}

/**
 * What a transcript line asks of the agent: `typed` by the user, or `wrapped` (a scheduled task or a
 * relayed message, which is all some sessions have). Tool results and Claude Code's own notes are neither.
 */
function promptOf(line: Record<string, unknown>): { typed?: string; wrapped?: string } {
  if (line.type === 'last-prompt' && typeof line.lastPrompt === 'string') {
    const text = line.lastPrompt.trim();
    return NOT_A_PROMPT.test(text) ? { wrapped: unwrapped(text) } : text ? { typed: text } : {};
  }
  if (line.type !== 'user' || line.isSidechain === true || !isRecord(line.message)) return {};
  const text = textOf(line.message.content, 'text')?.trim();
  if (!text) return {};
  // Relayed messages are stored as meta lines; the rest of the meta lines are Claude Code's own.
  if (line.isMeta === true || NOT_A_PROMPT.test(text)) return { wrapped: unwrapped(text) };
  return { typed: text };
}

/**
 * A title record sets the session's name; a later one replaces an earlier one. Returns whether the
 * title is Claude Code's own (`ai-title`), which it writes from the first message.
 */
function titleOf(line: Record<string, unknown>, info: SessionInfo): boolean | undefined {
  if (line.type === 'summary' && typeof line.summary === 'string') info.title = oneLine(line.summary, 120);
  else if (line.type === 'ai-title' && typeof line.aiTitle === 'string') info.title = oneLine(line.aiTitle, 120);
  else if (line.type === 'custom-title' && typeof line.customTitle === 'string')
    info.title = oneLine(line.customTitle, 120);
  else return undefined;
  return line.type === 'ai-title';
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
  // Claude Code titled the session itself, and its first message opened with a briefing genaicode
  // put there (before briefings became system instructions): that title names the briefing.
  let aiTitle = false;
  let briefed: boolean | undefined;
  let firstWrapped: string | undefined;
  let lastWrapped: string | undefined;
  // Who sent the prompts, where Claude Code notes it (`origin.kind`, `turnOrigin`): a person, a
  // task, or a program driving it (`sdk`).
  let sent = false;
  let human = false;
  let program = true;
  let scheduled = false;
  let typed = false;
  let entrypoint: string | undefined;
  const prompts = new Set<unknown>();
  const sender = (line: Record<string, unknown>, asked: boolean) => {
    if (typeof line.entrypoint === 'string') entrypoint ??= line.entrypoint;
    if (!asked || line.type !== 'user') return;
    // A summary Claude Code wrote when it compacted the context is no prompt of anybody's.
    if (line.isCompactSummary !== true) prompts.add(line);
    const kinds = [isRecord(line.origin) ? line.origin.kind : undefined, line.turnOrigin].filter(
      (kind): kind is string => typeof kind === 'string',
    );
    if (!kinds.length) return;
    sent = true;
    if (kinds.includes('human')) human = true;
    if (kinds.some((kind) => kind !== 'sdk')) program = false;
  };
  // The claude.ai project a relayed message came from, with its name where the context gives it:
  // looked for in what the first few user lines say.
  let looked = 0;
  let thread: string | undefined;
  const project = (line: Record<string, unknown>) => {
    if (info.project?.name) return;
    let text: string | undefined;
    if (line.type === 'attachment' && isRecord(line.attachment) && line.attachment.type === 'prompt_snapshot') {
      // The snapshot of the session's instructions is where the project is named.
      const prompt = line.attachment.systemPrompt;
      text = Array.isArray(prompt) ? prompt.filter((part) => typeof part === 'string').join('\n') : undefined;
      if (typeof prompt === 'string') text = prompt;
      const topic = text && PROJECT_NAMED.test(text) ? PROJECT_TOPIC.exec(text)?.[1] : undefined;
      if (topic) thread = oneLine(topic, 120);
    } else if (line.type === 'user' && looked < PROJECT_LINES) {
      text = textOf(messageOf(line), 'text');
      if (text) looked += 1;
    }
    if (!text) return;
    const named = PROJECT_NAMED.exec(text);
    const id = named?.[2] ?? PROJECT_ID.exec(text)?.[1];
    if (!id || (info.project && info.project.id !== id)) return;
    info.project = { id, ...(named ? { name: oneLine(named[1]!, 80) } : {}) };
  };
  for (const line of head) {
    if (!isRecord(line)) continue;
    if (line.isSidechain === true) return null;
    if (typeof line.cwd === 'string' && !info.cwd) info.cwd = line.cwd;
    if (typeof line.timestamp === 'string' && info.startedAt === undefined) {
      const at = Date.parse(line.timestamp);
      if (!Number.isNaN(at)) info.startedAt = at;
    }
    if (line.type === 'user' || line.type === 'assistant') conversed = true;
    aiTitle = titleOf(line, info) ?? aiTitle;
    project(line);
    const prompt = promptOf(line);
    if (prompt.typed && line.type === 'user') briefed ??= personText(prompt.typed) !== prompt.typed;
    if (prompt.typed && line.type === 'user') typed = true;
    if (prompt.typed && !info.firstPrompt && line.type === 'user') info.firstPrompt = promptLine(prompt.typed);
    if (prompt.wrapped && line.type === 'user') {
      if (firstWrapped === undefined && !info.firstPrompt)
        scheduled = SCHEDULED.test(textOf(messageOf(line), 'text') ?? '');
      firstWrapped ??= promptLine(prompt.wrapped);
    }
    sender(line, !!(prompt.typed ?? prompt.wrapped));
  }
  let agentLast = false;
  for (const line of tail) {
    if (!isRecord(line)) continue;
    // The directory it started in names the project; later lines follow the agent's `cd`.
    if (typeof line.cwd === 'string' && !info.cwd) info.cwd = line.cwd;
    if (typeof line.gitBranch === 'string' && line.gitBranch && line.gitBranch !== 'HEAD') info.branch = line.gitBranch;
    aiTitle = titleOf(line, info) ?? aiTitle;
    if (typeof line.permissionMode === 'string') info.mode = line.permissionMode === 'plan' ? 'plan' : 'default';
    if (line.type === 'cost-state' && typeof line.totalCostUSD === 'number') info.costUsd = line.totalCostUSD;
    if (line.type === 'user' || line.type === 'assistant') conversed = true;
    const prompt = promptOf(line);
    sender(line, !!(prompt.typed ?? prompt.wrapped));
    if (prompt.wrapped) lastWrapped = promptLine(prompt.wrapped);
    if (line.type === 'last-prompt') {
      // Claude Code's own note of the latest prompt; it says nothing about whose turn it is.
      if (prompt.typed) info.lastPrompt = promptLine(prompt.typed);
    } else if (prompt.typed) {
      typed = true;
      info.lastPrompt = promptLine(prompt.typed);
      agentLast = false;
    } else if (prompt.wrapped) {
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
  if (aiTitle && briefed && info.firstPrompt) delete info.title;
  // A session nobody typed into (a scheduled task, a relayed one) is known by what it was sent.
  // A session relayed from a claude.ai thread is called what the thread is, unless it has a title of its own.
  if (info.project) info.title ??= thread;
  info.firstPrompt ??= firstWrapped;
  info.lastPrompt ??= lastWrapped ?? info.firstPrompt;
  // Nobody typed into it: every prompt Claude Code noted a sender for came from a task, or, where it
  // notes none, the session is a headless run or opens with a scheduled task and no typed prompt is seen.
  // A program driving Claude Code (`sdk`) with one prompt is a run, with more a chat somebody has
  // through that program.
  // Only a transcript read whole says so: the middle of a long one may hold more prompts.
  const run = head === tail && prompts.size <= 1;
  if (sent ? !human && (!program || run) : entrypoint?.startsWith('sdk') ? run : scheduled && !typed)
    info.automated = true;
  info.state = now - file.mtimeMs < ACTIVE_MS ? 'active' : agentLast ? 'waiting' : 'unfinished';
  return info;
}

/** The turns in the lines of a Claude Code transcript. Subagent lines and Claude Code's own notes are left out. */
export function claudeTranscript(lines: readonly unknown[], options: SessionReadOptions = {}): SessionTurn[] {
  const builder = transcriptBuilder('claude', options);
  for (const line of lines) {
    if (!isRecord(line) || line.isSidechain === true || line.type === 'last-prompt') continue;
    const at = timeOf(line.timestamp);
    // The summary Claude Code writes when it compacts is its own text, not something the user asked.
    const prompt = line.isCompactSummary === true ? {} : promptOf(line);
    const asked = prompt.typed ?? prompt.wrapped;
    if (asked) {
      builder.prompt(asked, at);
      continue;
    }
    if (!isRecord(line.message)) continue;
    const content = line.message.content;
    if (line.type === 'assistant') {
      if (typeof content === 'string') builder.text(content, at);
      else if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === 'text' && typeof block.text === 'string') builder.text(block.text, at);
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            builder.tool(typeof block.id === 'string' ? block.id : undefined, block.name, block.input, at);
          }
        }
      }
    } else if (line.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        builder.toolResult(block.tool_use_id, textOf(block.content, 'text'), block.is_error === true, at);
      }
    }
  }
  return builder.turns();
}

const claudeModeCache = new Map<string, AgentMode | undefined>();

function claudePermissionModeLine(line: string): { found: true; value: AgentMode } | { found: false } {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed) || typeof parsed.permissionMode !== 'string') return { found: false };
    return { found: true, value: parsed.permissionMode === 'plan' ? 'plan' : 'default' };
  } catch {
    return { found: false };
  }
}

async function resolveClaudeMode(info: SessionInfo, file: SessionFile, signal?: AbortSignal): Promise<void> {
  if (info.mode !== undefined || file.size <= 512 * 1024) return;
  const key = `${file.path}:${file.mtimeMs}:${file.size}`;
  if (claudeModeCache.has(key)) {
    const cached = claudeModeCache.get(key);
    if (cached) info.mode = cached;
    return;
  }
  const mode = await findLastLineMatch(
    file.path,
    file.size,
    '"permissionMode"',
    claudePermissionModeLine,
    signal,
  ).catch(() => undefined);
  if (claudeModeCache.size >= 256) claudeModeCache.clear();
  claudeModeCache.set(key, mode);
  if (mode) info.mode = mode;
}

/** Sessions Claude Code keeps on this machine. */
export function claudeSessions(options: ClaudeSessionsOptions = {}): SessionSource {
  return {
    name: 'claude',
    where: 'local',
    verified: '2.1.327',
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
    async find(id, query = {}) {
      const env = query.env ?? options.env ?? process.env;
      const dir = options.dir ?? env.CLAUDE_CONFIG_DIR ?? path.join(homeOf(env), '.claude');
      // The file is named after the session, so only the matching ones are opened.
      const files = await findFiles(
        path.join(dir, 'projects'),
        1,
        (name) => name.endsWith('.jsonl') && name.startsWith(id),
      );
      const recent = files.filter((file) => query.since === undefined || file.mtimeMs >= query.since);
      const sessions = await mapLimited(recent, 8, async (file) => {
        const info = await readClaudeSession(file).catch(() => null);
        if (info) await resolveClaudeMode(info, file, query.signal);
        return info;
      });
      return sessions.filter(
        (session): session is SessionInfo =>
          session !== null && (query.cwd === undefined || (!!session.cwd && isWithin(session.cwd, query.cwd))),
      );
    },
    async read(session, readOptions) {
      if (!session.path) throw new Error(`Session ${session.id} has no transcript file.`);
      return claudeTranscript(await transcriptLines(session.path, readOptions), readOptions);
    },
  };
}
