import { Box, Text } from 'ink';
import type { SessionEntry, SessionTurn } from '../../agents/session.js';
import { describeFailover } from '../../agents/failover.js';
import {
  firstLine,
  formatDuration,
  outputTail,
  relativePath,
  shortId,
  toolLabel,
  toolSummary,
  turnFooter,
} from '../format.js';
import type { Notice } from '../controller.js';
import { plainSessionText } from '../controller.js';
import {
  inputDeliveryText,
  packMetrics,
  packTaskElapsed,
  packTaskList,
  packTaskOutcome,
  packTaskStatus,
  packTaskTitle,
} from '../../react/format.js';
import { relayProjectName } from '../../react/session-relay.js';
import type { ApprovalRequest } from '../../agents/types.js';

/** Inline `code` and **bold**, the two marks agents use most in terminal answers. */
export function RichLine({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text>
      {parts.map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <Text key={i} color="cyan">
            {part.slice(1, -1)}
          </Text>
        ) : part.startsWith('**') && part.endsWith('**') && part.length > 3 ? (
          <Text key={i} bold>
            {part.slice(2, -2)}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

/** Assistant text with fenced code blocks set apart. */
export function Markdown({ text }: { text: string }) {
  const blocks: Array<{ code: boolean; lines: string[] }> = [];
  let code = false;
  for (const line of text.replace(/\s+$/, '').split('\n')) {
    if (/^\s*```/.test(line)) {
      code = !code;
      blocks.push({ code, lines: [] });
      continue;
    }
    const last = blocks.at(-1);
    if (last && last.code === code) last.lines.push(line);
    else blocks.push({ code, lines: [line] });
  }
  return (
    <Box flexDirection="column">
      {blocks
        .filter((block) => block.lines.length)
        .map((block, i) =>
          block.code ? (
            <Box key={i} flexDirection="column" paddingLeft={2}>
              {block.lines.map((line, j) => (
                <Text key={j} color="yellow">
                  {line || ' '}
                </Text>
              ))}
            </Box>
          ) : (
            <Box key={i} flexDirection="column">
              {block.lines.map((line, j) =>
                /^#{1,4}\s/.test(line) ? (
                  <Text key={j} bold>
                    {line.replace(/^#+\s*/, '')}
                  </Text>
                ) : (
                  <RichLine key={j} text={line || ' '} />
                ),
              )}
            </Box>
          ),
        )}
    </Box>
  );
}

export function showsOutput(entry: Extract<SessionEntry, { kind: 'tool' }>): boolean {
  return !!entry.output?.trim() && (entry.isError === true || toolLabel(entry.name) === 'Shell');
}

/** Rough row count of an entry, to keep the live area inside the terminal. */
export function entryHeight(entry: SessionEntry, width: number, outputLines: number): number {
  const rows = (text: string) =>
    text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(20, width))), 0);
  switch (entry.kind) {
    case 'progress':
      return (
        rows(entry.message) + (entry.plan ?? []).reduce((sum, item) => sum + rows(`${item.step} · ${item.status}`), 0)
      );
    case 'text':
      return rows(entry.text);
    case 'tool':
      return 1 + (showsOutput(entry) ? Math.min(outputLines + 1, rows(entry.output ?? '')) : 0);
    case 'approval':
    case 'files':
    case 'artifact':
    case 'input':
    case 'failover':
      return 1;
    case 'error':
      return rows(entry.message);
  }
}

export function EntryView({
  entry,
  outputLines,
  cwd,
  agent,
}: {
  entry: SessionEntry;
  outputLines: number;
  cwd?: string;
  /** The agent the turn talks to, named in an input's delivery. */
  agent?: string;
}) {
  switch (entry.kind) {
    case 'progress':
      return (
        <Box flexDirection="column">
          <Text>{plainSessionText(entry.message)}</Text>
          {entry.plan?.map(({ step, status }, i) => (
            <Text key={i} bold={status === 'in_progress'}>
              {i + 1}. {plainSessionText(step)} · {status.replace('_', ' ')}
            </Text>
          ))}
        </Box>
      );
    case 'text':
      return (
        <Box>
          <Text color="white">● </Text>
          <Box flexDirection="column" flexGrow={1}>
            <Markdown text={entry.text} />
          </Box>
        </Box>
      );
    case 'tool': {
      const summary = toolSummary(entry.input, 70, cwd);
      // Shell output and failures are worth reading; other tools' results (file bodies, JSON) are noise here.
      const tail = showsOutput(entry) ? outputTail(entry.output, outputLines) : { lines: [], hidden: 0 };
      const mark = !entry.done ? '◌' : entry.isError ? '✗' : '▸';
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={entry.isError ? 'red' : entry.done ? 'green' : 'yellow'}>{mark} </Text>
            <Text bold>{toolLabel(entry.name)}</Text>
            {summary ? <Text color="gray"> {summary}</Text> : null}
          </Text>
          {tail.lines.length ? (
            <Box flexDirection="column" paddingLeft={2}>
              {tail.hidden ? <Text color="gray">… {tail.hidden} more lines</Text> : null}
              {tail.lines.map((line, i) => (
                <Text key={i} color="gray" wrap="truncate-end">
                  {line || ' '}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      );
    }
    case 'artifact':
      return (
        <Text>
          <Text color="cyan">◆ </Text>
          <Text color="gray">published </Text>
          {entry.artifact.title}
          <Text color="gray">
            {' '}
            ({entry.artifact.kind}
            {entry.artifact.path ? `, ${entry.artifact.path}` : ''}) · /web shows it
          </Text>
        </Text>
      );
    case 'files':
      return (
        <Text>
          <Text color="magenta">✎ </Text>
          <Text color="gray">edited </Text>
          {entry.paths.map((path) => relativePath(path, cwd)).join(', ')}
        </Text>
      );
    case 'approval':
      return (
        <Text>
          <Text color="yellow">? </Text>
          <Text>
            {entry.request.kind === 'command' ? 'Run' : entry.request.kind === 'file-change' ? 'Edit' : 'Allow'}{' '}
          </Text>
          <Text color="cyan">{entry.request.summary ?? entry.request.id}</Text>
          <Text color="gray">
            {' → '}
            {entry.decision === 'approve' ? 'approved' : entry.decision === 'deny' ? 'denied' : 'waiting'}
            {entry.decision && entry.automatic ? ' (automatic)' : ''}
          </Text>
        </Text>
      );
    case 'input':
      return (
        <Text>
          <Text color="cyan">› </Text>
          {entry.text}
          <Text color={entry.delivery === 'dropped' ? 'red' : entry.delivery === 'delivered' ? 'green' : 'gray'}>
            {' '}
            ({inputDeliveryText(entry.delivery, agent ?? '').replace(/^\w/, (first) => first.toLowerCase())})
          </Text>
        </Text>
      );
    case 'error':
      return <Text color="red">✗ {entry.message}</Text>;
    case 'failover':
      return <Text color="yellow">⇄ {describeFailover(entry.from, entry.to, entry.failure)}</Text>;
  }
}

export function TurnView({
  turn,
  live = false,
  now,
  maxRows,
  width = 80,
  cwd,
  approvals = [],
  selectedTask,
}: {
  turn: SessionTurn;
  live?: boolean;
  now?: number;
  /** Live turns: show only the newest entries that fit in this many rows. */
  maxRows?: number;
  width?: number;
  cwd?: string;
  approvals?: ApprovalRequest[];
  selectedTask?: string;
}) {
  let entries = turn.entries;
  if (maxRows !== undefined) {
    let used = 0;
    let from = turn.entries.length;
    while (from > 0) {
      const height = entryHeight(turn.entries[from - 1], width - 4, live ? 2 : 4);
      if (used + height > maxRows && from < turn.entries.length) break;
      used += height;
      from -= 1;
    }
    entries = turn.entries.slice(from);
  }
  const hidden = turn.entries.length - entries.length;
  const failed = turn.result && !turn.result.ok;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>
          ›{' '}
        </Text>
        <Box flexGrow={1}>
          <Text bold>{turn.prompt}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" paddingLeft={2} marginTop={turn.entries.length ? 1 : 0}>
        {hidden ? <Text color="gray">… {hidden} earlier steps (shown when the turn ends)</Text> : null}
        {entries.map((entry, i) => (
          // Tool steps stack tightly; prose gets a blank line around it.
          <Box key={i + hidden} marginTop={i > 0 && (entry.kind === 'text' || entries[i - 1].kind === 'text') ? 1 : 0}>
            <EntryView entry={entry} outputLines={live ? 2 : 4} cwd={cwd} agent={turn.pack?.lead ?? turn.agent} />
          </Box>
        ))}
      </Box>
      {turn.pack && (turn.pack.tasks.length || approvals.some((request) => request.subtaskId)) ? (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          <Text bold>
            Delegated tasks <Text color="gray">{packMetrics(turn)}</Text>
          </Text>
          {(() => {
            // Older finished tasks fold into one line; Tab still browses every task.
            const { shown, hidden: earlier } = packTaskList(turn.pack.tasks, {
              asking: (task) => approvals.some((request) => request.subtaskId === task.id),
              keep: selectedTask,
            });
            return (
              <>
                {shown.map((task) => {
                  const waiting = approvals.some((request) => request.subtaskId === task.id);
                  const elapsed = packTaskElapsed(task, now);
                  const outcome = packTaskOutcome(task);
                  // The title gets a line of its own, so a long one cannot push the status and
                  // outcome off a narrow terminal.
                  return (
                    <Box key={task.id} flexDirection="column">
                      <Text wrap="truncate-end">
                        <Text color={waiting ? 'yellow' : 'cyan'}>{selectedTask === task.id ? '›' : '·'}</Text>{' '}
                        {plainSessionText(packTaskTitle(task))}
                      </Text>
                      <Box paddingLeft={2}>
                        <Text wrap="truncate-end">
                          <Text color={waiting ? 'yellow' : 'cyan'}>{task.agent}</Text>
                          {' · '}
                          {packTaskStatus(task, waiting)}
                          {elapsed ? ` · ${elapsed}` : ''}
                          {outcome ? <Text color="gray"> · {plainSessionText(outcome)}</Text> : null}
                        </Text>
                      </Box>
                    </Box>
                  );
                })}
                {earlier ? (
                  <Text color="gray">
                    · {earlier} earlier finished {earlier === 1 ? 'task' : 'tasks'} (Tab to browse)
                  </Text>
                ) : null}
              </>
            );
          })()}
        </Box>
      ) : null}
      {turn.result ? (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={failed ? 'red' : 'gray'}>
            {failed ? '✗ ' : '✓ '}
            {turnFooter(turn, now)} · {turn.agent}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function NoticeView({ notice, now = Date.now() }: { notice: Notice; now?: number }) {
  if (notice.relay) {
    const { relay } = notice;
    const project = relayProjectName(relay.cwd);
    const title = relay.title ? firstLine(relay.title) : shortId(relay.sessionId);
    const duration =
      relay.status === 'working'
        ? formatDuration(now - relay.startedAt)
        : relay.endedAt !== undefined && relay.endedAt - relay.startedAt >= 1000
          ? formatDuration(relay.endedAt - relay.startedAt)
          : '';
    const badge =
      relay.status === 'queued'
        ? { mark: '○', text: 'Queued', color: 'yellow' as const }
        : relay.status === 'working'
          ? { mark: '●', text: `Working · ${duration}`, color: 'cyan' as const }
          : relay.status === 'answered'
            ? { mark: '✓', text: duration ? `Answered · ${duration}` : 'Answered', color: 'green' as const }
            : { mark: '✗', text: 'Failed', color: 'red' as const };
    const step = relay.status === 'working' ? (relay.tool ? toolLabel(relay.tool) : relay.activity) : undefined;
    return (
      <Box marginBottom={1} flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={badge.color} bold>
            {badge.mark} {relay.agent}
          </Text>
          {project ? <Text color="gray"> · {project}</Text> : null}
          <Text color={badge.color}> · {badge.text}</Text>
          {title ? <Text color="gray"> · {title}</Text> : null}
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          {relay.status === 'queued' ? <Text color="gray">Waiting for its current turn to finish…</Text> : null}
          {step ? (
            <Text color="gray" wrap="truncate-end">
              {step}
            </Text>
          ) : null}
          {relay.status === 'answered' ? (
            relay.reply ? (
              <Markdown text={relay.reply} />
            ) : (
              <Text color="gray">Took the message.</Text>
            )
          ) : null}
          {relay.status === 'failed' ? (
            <Text color="red">{relay.error || 'Could not deliver the message.'}</Text>
          ) : null}
        </Box>
      </Box>
    );
  }
  return (
    <Box marginBottom={1} flexDirection="column">
      {notice.text.split('\n').map((line, i) => (
        <Text key={i} color={notice.tone === 'error' ? 'red' : 'gray'}>
          {i === 0 ? '· ' : '  '}
          {line}
        </Text>
      ))}
    </Box>
  );
}
