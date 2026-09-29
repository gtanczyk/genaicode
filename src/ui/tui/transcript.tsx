import { Box, Text } from 'ink';
import type { SessionEntry, SessionTurn } from '../../agents/session.js';
import { outputTail, relativePath, toolLabel, toolSummary, turnFooter } from '../format.js';
import type { Notice } from '../controller.js';

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
    case 'text':
      return rows(entry.text);
    case 'tool':
      return 1 + (showsOutput(entry) ? Math.min(outputLines + 1, rows(entry.output ?? '')) : 0);
    case 'approval':
    case 'files':
    case 'input':
      return 1;
    case 'error':
      return rows(entry.message);
  }
}

export function EntryView({ entry, outputLines, cwd }: { entry: SessionEntry; outputLines: number; cwd?: string }) {
  switch (entry.kind) {
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
          </Text>
        </Text>
      );
    case 'input':
      return (
        <Text>
          <Text color="cyan">› </Text>
          {entry.text}
          <Text color="gray"> (sent while working)</Text>
        </Text>
      );
    case 'error':
      return <Text color="red">✗ {entry.message}</Text>;
  }
}

export function TurnView({
  turn,
  live = false,
  now,
  maxRows,
  width = 80,
  cwd,
}: {
  turn: SessionTurn;
  live?: boolean;
  now?: number;
  /** Live turns: show only the newest entries that fit in this many rows. */
  maxRows?: number;
  width?: number;
  cwd?: string;
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
            <EntryView entry={entry} outputLines={live ? 2 : 4} cwd={cwd} />
          </Box>
        ))}
      </Box>
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

export function NoticeView({ notice }: { notice: Notice }) {
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
