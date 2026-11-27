import { describeFailover } from '../agents/failover.js';
import type { SessionEntry, SessionState, SessionTurn } from '../agents/session.js';
import type { SessionInfo } from '../agents/sessions/types.js';
import type { Artifact } from '../agents/types.js';
import {
  formatBytes,
  formatDuration,
  formatUsage,
  packTaskTitle,
  toolArgument,
  visibleReply,
} from '../react/format.js';
import type { ChatView, Notice } from './controller.js';

/** The content of an artifact's latest version (`ArtifactStore.read`). */
export type ReadArtifact = (id: string) => { artifact: Artifact; body: Buffer } | undefined;

export type TranscriptFormat = 'md' | 'json';

export interface TranscriptMeta {
  version?: string;
  agent: string;
  source?: string;
  model?: string;
  effort?: string;
  cwd?: string;
  sessionId?: string;
  sessionPath?: string;
  turns: number;
  readable?: boolean;
  truncated?: boolean;
  truncatedReason?: string;
  filenameMd: string;
  filenameJson: string;
}

export interface ChatTranscriptInput {
  view: ChatView;
  version?: string;
  sessionPath?: string;
  exportedAt?: string;
  readArtifact?: ReadArtifact;
}

export interface ChatTranscriptJson {
  format: 'genaicode-transcript';
  formatVersion: 1;
  version?: string;
  exportedAt: string;
  sessionId?: string;
  sessionPath?: string;
  truncated?: boolean;
  truncatedReason?: string;
  session: SessionState;
  notices: Notice[];
  autoApprove: boolean;
  tower?: ChatView['tower'];
}

export interface StoredSessionTranscriptInput {
  session: SessionInfo;
  turns: readonly SessionTurn[];
  readable: boolean;
  truncated?: boolean;
  truncatedReason?: string;
  version?: string;
  exportedAt?: string;
}

export interface StoredSessionTranscriptJson {
  format: 'genaicode-session-transcript';
  formatVersion: 1;
  version?: string;
  exportedAt: string;
  readable: boolean;
  truncated: boolean;
  truncatedReason?: string;
  session: SessionInfo;
  turns: SessionTurn[];
}

// Inline artifact content limit (matches handoff.ts): keeps exports readable without embedding huge blobs.
const ARTIFACT_CONTENT_MAX = 16_000;

/** Safe, readable filename for an exported transcript, e.g. `genaicode-claude-0195abcd.md`. */
export function transcriptFilename(options: {
  agent?: string;
  sessionId?: string;
  format: TranscriptFormat;
  exportedAt?: Date;
}): string {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const agent = clean(options.agent || 'chat').slice(0, 32) || 'chat';
  const cleanedId = options.sessionId ? clean(options.sessionId) : '';
  const idPart = cleanedId.length > 12 ? cleanedId.slice(-8).replace(/^-+/, '') : cleanedId;
  const stamp = (options.exportedAt ?? new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = idPart || stamp;
  return `genaicode-${agent}-${suffix}.${options.format}`;
}

/** Human-readable explanation when a transcript reader omitted earlier bytes or turns. */
export function formatTruncationReason(
  reasons: ReadonlySet<'max-turns' | 'tail-bytes'>,
  maxTurns: number,
  verb: 'exported' | 'loaded' = 'exported',
): string | undefined {
  if (reasons.has('tail-bytes') && reasons.has('max-turns')) {
    return `Only the last 8 MB of the session file and at most the latest ${maxTurns} turns were ${verb}; earlier turns were omitted.`;
  }
  if (reasons.has('tail-bytes')) {
    return 'Only the last 8 MB of the session file was read; earlier turns were omitted.';
  }
  if (reasons.has('max-turns')) {
    return `Only the latest ${maxTurns} turns were ${verb}; earlier turns were omitted.`;
  }
  return undefined;
}

/** Reason when an active chat omitted earlier turns (in-memory cap or adopting a truncated session). */
export function activeChatTruncation(session: SessionState): string | undefined {
  return session.truncatedReason;
}

/** Structured JSON snapshot of the active chat (full SessionState, notices and metadata). */
export function chatTranscriptJson(input: ChatTranscriptInput): ChatTranscriptJson {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const { view } = input;
  const truncatedReason = activeChatTruncation(view.session);
  return {
    format: 'genaicode-transcript',
    formatVersion: 1,
    ...(input.version ? { version: input.version } : {}),
    exportedAt,
    ...(view.session.sessionId ? { sessionId: view.session.sessionId } : {}),
    ...(input.sessionPath ? { sessionPath: input.sessionPath } : {}),
    ...(truncatedReason ? { truncated: true, truncatedReason } : {}),
    session: view.session,
    notices: view.notices,
    autoApprove: view.autoApprove,
    ...(view.tower ? { tower: view.tower } : {}),
  };
}

/** Structured JSON snapshot of a session read from an agent's store (`Sessions` / `Chats`). */
export function storedSessionTranscriptJson(input: StoredSessionTranscriptInput): StoredSessionTranscriptJson {
  const truncated = input.truncated === true;
  const truncatedReason =
    input.truncatedReason ??
    (truncated ? 'Earlier turns were omitted from this export; only the latest portion is included.' : undefined);
  return {
    format: 'genaicode-session-transcript',
    formatVersion: 1,
    ...(input.version ? { version: input.version } : {}),
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    readable: input.readable,
    truncated,
    ...(truncatedReason ? { truncatedReason } : {}),
    session: input.session,
    turns: [...input.turns],
  };
}

/** Full active conversation as Markdown: metadata, interleaved notices, turns, tool calls, diffs, pack tasks. */
export function formatChatTranscriptMarkdown(input: ChatTranscriptInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const { view } = input;
  const { session } = view;
  const truncatedReason = activeChatTruncation(session);
  const out: string[] = ['# Genaicode transcript', ''];

  const meta: Array<[string, string | undefined]> = [
    ['Version', input.version],
    ['Agent', session.agent],
    ['Model', session.model],
    ['Effort', session.effort],
    ['Directory', session.cwd],
    ['Session ID', session.sessionId],
    ['Session file', input.sessionPath],
    ['Status', session.status === 'running' ? 'running' : undefined],
    ['Auto-approve', view.autoApprove ? 'on' : undefined],
    ['Fallback', session.fallback?.length ? session.fallback.join(' → ') : undefined],
    ['Usage', formatUsage(session.usage, session.costUsd) || undefined],
    ['Incomplete', truncatedReason],
    ['Exported', exportedAt],
  ];
  for (const [label, value] of meta) {
    if (value) out.push(`- **${label}:** ${value}`);
  }
  out.push('');
  if (truncatedReason) out.push(`> **Note:** ${truncatedReason}`, '');

  const notices = [...view.notices].sort((a, b) => a.afterTurn - b.afterTurn);
  const flushNotices = (upTo: number) => {
    while (notices.length && notices[0]!.afterTurn <= upTo) {
      const notice = notices.shift()!;
      const tag = notice.tone === 'error' ? 'Error notice' : 'Notice';
      out.push(`> **${tag}:** ${notice.text.replace(/\n/g, '\n> ')}`, '');
    }
  };

  const latest = latestArtifactVersions(session.turns);
  session.turns.forEach((turn, index) => {
    flushNotices(index);
    renderTurn(out, turn, { cwd: session.cwd, latestArtifacts: latest, readArtifact: input.readArtifact });
  });
  flushNotices(Number.MAX_SAFE_INTEGER);

  if (session.queued.length) {
    out.push('## Queued prompts', '');
    for (const queued of session.queued) out.push(`- ${queued.trim()}`);
    out.push('');
  }

  if (!session.turns.length && !view.notices.length) {
    out.push('_No turns yet._', '');
  }

  return `${out.join('\n').trimEnd()}\n`;
}

/** A stored session (`SessionInfo` + turns read from its store) as Markdown. */
export function formatStoredSessionMarkdown(input: StoredSessionTranscriptInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const { session } = input;
  const truncatedReason = input.truncated
    ? (input.truncatedReason ?? 'Earlier turns were omitted from this export; only the latest portion is included.')
    : undefined;
  const out: string[] = ['# Session transcript', ''];

  const state =
    session.waitingFor === 'approval'
      ? `approval${session.waitingTool ? ` (${session.waitingTool})` : ''}`
      : session.state;
  const meta: Array<[string, string | undefined]> = [
    ['Version', input.version],
    ['Agent', session.agent],
    ['Source', session.source !== session.agent ? session.source : undefined],
    ['Session ID', session.id],
    ['Session file', session.path],
    ['URL', session.url],
    ['Directory', session.cwd],
    ['Repository', session.repository],
    ['Branch', session.branch],
    ['Title', session.title],
    ['Model', session.model],
    ['State', state],
    [
      'Usage',
      session.usage || session.costUsd !== undefined
        ? formatUsage(session.usage ?? {}, session.costUsd) || undefined
        : undefined,
    ],
    ['Incomplete', truncatedReason],
    ['Updated', session.updatedAt ? new Date(session.updatedAt).toISOString() : undefined],
    ['Exported', exportedAt],
  ];
  for (const [label, value] of meta) {
    if (value) out.push(`- **${label}:** ${value}`);
  }
  out.push('');

  return out.join('\n') + '\n' + storedConversationMarkdown(input);
}

/** The read-only session page starts with the conversation, omitting export metadata. */
export function storedConversationMarkdown(input: StoredSessionTranscriptInput): string {
  const { session, turns, readable } = input;
  const truncatedReason = input.truncated && (input.truncatedReason || 'Only the latest turns are available.');
  const out: string[] = [];
  if (truncatedReason) {
    out.push(`> **Note:** ${truncatedReason} Turn numbers below start from the first exported turn.`, '');
  }

  if (!readable) {
    out.push('_This session store cannot be read yet; metadata only._', '');
    if (session.firstPrompt) out.push('### First prompt', '', session.firstPrompt.trim(), '');
    if (session.lastPrompt && session.lastPrompt !== session.firstPrompt) {
      out.push('### Last prompt', '', session.lastPrompt.trim(), '');
    }
    const lastReply = visibleReply(session.agent, session.lastReply ?? '').trim();
    if (lastReply) out.push('### Last reply', '', lastReply, '');
  } else if (!turns.length) {
    out.push('_No turns found in this session._', '');
  } else {
    const latest = latestArtifactVersions(turns);
    for (const turn of turns) renderTurn(out, turn, { cwd: session.cwd, latestArtifacts: latest });
  }

  return `${out.join('\n').trimEnd()}\n`;
}

interface TurnContext {
  cwd?: string;
  latestArtifacts: Map<string, number>;
  readArtifact?: ReadArtifact;
}

interface ConversationPart {
  role: 'user' | 'agent' | 'activity' | 'note';
  heading?: string;
  text: string;
}

export function storedConversation(input: StoredSessionTranscriptInput) {
  const latestArtifacts = latestArtifactVersions(input.turns);
  if (!input.readable || !input.turns.length) return { notice: storedConversationMarkdown(input), turns: [] };
  return {
    notice: input.truncated ? (input.truncatedReason ?? 'Only the latest turns are available.') : undefined,
    turns: input.turns.map((turn) => ({
      id: turn.id,
      speaker: turn.pack?.lead ?? turn.agent,
      startedAt: turn.startedAt,
      parts: conversationParts(turn, { cwd: input.session.cwd, latestArtifacts }),
    })),
  };
}

function renderTurn(out: string[], turn: SessionTurn, context: TurnContext) {
  const speaker = turn.pack?.lead ?? turn.agent;
  const headerParts = [`Turn ${turn.id}`, speaker];
  if (turn.startedAt > 0) {
    const stamp = new Date(turn.startedAt).toISOString();
    const took =
      turn.endedAt && turn.endedAt >= turn.startedAt ? ` (${formatDuration(turn.endedAt - turn.startedAt)})` : '';
    headerParts.push(`${stamp}${took}`);
  }
  out.push(`## ${headerParts.join(' · ')}`, '');

  for (const part of conversationParts(turn, context)) {
    if (part.heading) out.push('### ' + part.heading, '');
    out.push(part.text, '');
  }
}

function conversationParts(turn: SessionTurn, context: TurnContext): ConversationPart[] {
  const parts: ConversationPart[] = [];
  const speaker = turn.pack?.lead ?? turn.agent;
  const out: string[] = [];
  if (turn.handoff) {
    const from = turn.handoff.agents.length ? ` from ${turn.handoff.agents.join(', ')}` : '';
    const file = turn.handoff.file ? ` (\`${turn.handoff.file}\`)` : '';
    parts.push({ role: 'note', text: `_Handoff: ${turn.handoff.turns} earlier turns${from}${file}_` });
  }

  out.push(turn.prompt.trim() || '_(empty prompt)_', '');

  if (turn.attachments?.length) {
    out.push(
      'Attachments:',
      ...turn.attachments.map(
        (item) => `- \`${item.name}\` (${[item.mediaType, formatBytes(item.size)].filter(Boolean).join(', ')})`,
      ),
      '',
    );
  }

  parts.push({ role: 'user', heading: 'User', text: out.join('\n').trimEnd() });
  out.length = 0;
  for (const entry of turn.entries) {
    if (entry.kind === 'text' || entry.kind === 'input') {
      const agent = entry.kind === 'text';
      const text = (agent ? visibleReply(speaker, entry.text, entry.streaming) : entry.text).trim();
      if (text) parts.push({ role: agent ? 'agent' : 'user', heading: agent ? speaker : 'User (during turn)', text });
    } else {
      renderEntry(out, entry, speaker, context);
      const text = out.join('\n').trimEnd();
      if (text) parts.push({ role: entry.kind === 'tool' || entry.kind === 'files' ? 'activity' : 'note', text });
      out.length = 0;
    }
  }

  const final = visibleReply(speaker, turn.result?.text ?? '').trim();
  if (
    final &&
    !turn.entries.some(
      (entry) => entry.kind === 'text' && visibleReply(speaker, entry.text, entry.streaming).trim() === final,
    )
  ) {
    parts.push({ role: 'agent', heading: speaker, text: final });
  }

  if (turn.pack?.tasks.length) {
    out.push(`### Delegated tasks (lead: ${turn.pack.lead}, maxParallel: ${turn.pack.maxParallel})`, '');
    for (const task of turn.pack.tasks) {
      const title = packTaskTitle(task);
      const tags = [task.agent, task.mode, task.status, task.state].filter(Boolean).join(', ');
      out.push(`#### Task ${task.id}: ${title} (${tags})`, '');
      const details: Array<[string, string | undefined]> = [
        ['Model', task.model],
        ['Effort', task.effort],
        ['MCP servers', task.mcpServers?.length ? task.mcpServers.join(', ') : undefined],
        ['Directory', task.cwd],
      ];
      for (const [label, value] of details) {
        if (value) out.push(`- **${label}:** ${value}`);
      }
      if (details.some(([, value]) => value)) out.push('');
      out.push('**Prompt:**', '', task.prompt.trim(), '');
      if (task.changes?.length) {
        out.push('**Changed files:**', ...task.changes.map((line) => `- \`${line}\``), '');
      }
      if (task.text?.trim()) {
        out.push('**Result:**', '', task.text.trim(), '');
      }
      if (task.error?.trim()) {
        out.push(`**Error:** ${task.error.trim()}`, '');
      }
      if (task.checks?.review) {
        out.push(`**Review check:** ${task.checks.review.status}`);
        if (task.checks.review.detail?.trim()) out.push('', fence(task.checks.review.detail.trim()));
        out.push('');
      }
      if (task.checks?.verify) {
        out.push(`**Verify check:** ${task.checks.verify.status}`);
        if (task.checks.verify.detail?.trim()) out.push('', fence(task.checks.verify.detail.trim()));
        out.push('');
      }
    }
  }

  const turnUsage = turn.usage || turn.costUsd !== undefined ? formatUsage(turn.usage ?? {}, turn.costUsd) : '';
  if (turn.result && !turn.result.ok) {
    const error = turn.result.error?.trim();
    const told = error && turn.entries.some((entry) => entry.kind === 'error' && entry.message.includes(error));
    const parts = [
      `status: ${turn.result.status}`,
      turn.result.exitCode !== null ? `exit ${turn.result.exitCode}` : '',
      turn.result.signal ? `signal ${turn.result.signal}` : '',
      error && !told ? error : '',
      turnUsage,
    ].filter(Boolean);
    out.push(`_Turn ended (${parts.join(' · ')})_`, '');
  } else if (turnUsage) {
    out.push(`_Turn usage: ${turnUsage}_`, '');
  }
  if (out.length) parts.push({ role: 'note', text: out.join('\n').trimEnd() });
  return parts;
}

function renderEntry(
  out: string[],
  entry: Exclude<SessionEntry, { kind: 'input' | 'text' }>,
  speaker: string,
  context: TurnContext,
) {
  switch (entry.kind) {
    case 'progress':
      out.push(`### ${speaker} (progress)`, '', entry.message, '');
      for (const item of entry.plan ?? []) out.push(`- ${item.step} (${item.status.replace('_', ' ')})`);
      if (entry.plan?.length) out.push('');
      return;
    case 'tool': {
      const arg = toolArgument(entry.input, context.cwd);
      const status = !entry.done ? 'running' : entry.isError ? 'failed' : 'ok';
      const inlineArg = arg && !arg.includes('\n') && arg.length <= 160 ? arg : '';
      const argShown = inlineArg ? ` ${inlineCode(inlineArg)}` : '';
      out.push(`- **Tool** \`${entry.name}\`${argShown} (${status})`);
      if (entry.input !== undefined) {
        const serialized = serializeInput(entry.input);
        if (serialized && serialized !== inlineArg) {
          out.push('', fence(serialized, typeof entry.input === 'string' ? '' : 'json'));
        }
      }
      if (entry.output?.trim()) {
        out.push('', fence(entry.output.trim()));
      }
      out.push('');
      return;
    }
    case 'files':
      out.push(`- **Changed files:** ${entry.paths.map((path) => `\`${path}\``).join(', ')}`);
      if (entry.diff?.trim()) out.push('', fence(entry.diff.trim(), 'diff'));
      out.push('');
      return;
    case 'artifact': {
      out.push(`- **Artifact:** ${describeArtifact(entry.artifact)}`);
      if (context.latestArtifacts.get(entry.artifact.id) === entry.artifact.version) {
        context.latestArtifacts.delete(entry.artifact.id);
        const content = inlineArtifactContent(entry.artifact, context.readArtifact);
        if (content) out.push('', content);
      }
      out.push('');
      return;
    }
    case 'approval': {
      if (entry.request.kind === 'question' && entry.request.questions?.length) {
        const state = entry.decision === 'approve' ? 'answered' : entry.decision === 'deny' ? 'skipped' : 'unanswered';
        out.push(`- **Question** (${state}):`);
        for (const question of entry.request.questions) {
          const picked = entry.answers?.[question.id];
          const label = question.header ? `${question.header}: ${question.question}` : question.question;
          out.push(`  - ${label}${picked?.length ? ` → ${picked.join(', ')}` : ''}`);
        }
        out.push('');
        return;
      }
      const what = entry.request.summary ?? entry.request.kind;
      const decision = entry.decision ? `${entry.decision}${entry.automatic ? ' (automatic)' : ''}` : 'unanswered';
      out.push(`- **Approval** (\`${entry.request.kind}\`): ${what} → ${decision}`, '');
      return;
    }
    case 'error':
      out.push(`- **Error:** ${entry.message}`, '');
      return;
    case 'failover':
      out.push(`- **Failover:** ${describeFailover(entry.from, entry.to, entry.failure)}`, '');
      return;
  }
}

function latestArtifactVersions(turns: readonly SessionTurn[]): Map<string, number> {
  const byId = new Map<string, number>();
  for (const turn of turns) {
    for (const entry of turn.entries) {
      if (entry.kind === 'artifact') byId.set(entry.artifact.id, entry.artifact.version);
    }
  }
  return byId;
}

function describeArtifact(artifact: Artifact): string {
  const parts = [`name: \`${artifact.name}\``, artifact.kind, formatBytes(artifact.bytes)];
  if (artifact.version > 1) parts.push(`v${artifact.version}`);
  if (artifact.path) parts.push(`from \`${artifact.path}\``);
  return `"${artifact.title}" (${parts.join(', ')})`;
}

function inlineArtifactContent(artifact: Artifact, read: ReadArtifact | undefined): string | undefined {
  if (
    artifact.path ||
    (artifact.kind !== 'html' && artifact.kind !== 'text' && artifact.mimeType !== 'image/svg+xml')
  ) {
    return undefined;
  }
  const found = read?.(artifact.id);
  if (!found || found.artifact.version !== artifact.version) return undefined;
  const text = found.body.toString('utf8');
  const lang = artifact.kind === 'html' ? 'html' : artifact.mimeType === 'image/svg+xml' ? 'xml' : '';
  return text.length <= ARTIFACT_CONTENT_MAX
    ? fence(text, lang)
    : `${fence(text.slice(0, ARTIFACT_CONTENT_MAX), lang)}\n_(first ${ARTIFACT_CONTENT_MAX} of ${text.length} characters)_`;
}

function serializeInput(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function inlineCode(text: string): string {
  const ticks = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

function fence(text: string, lang = ''): string {
  const ticks = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  return `${ticks}${lang}\n${text}\n${ticks}`;
}
