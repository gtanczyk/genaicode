import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionTurn } from '../../agents/session.js';
import type { ChatController, ChatView, Notice } from '../controller.js';
import { formatDuration, needsAttention, SLASH_COMMANDS, statusParts } from '../format.js';
import { NoticeView, TurnView } from './transcript.js';

type StaticItem =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'turn'; turn: SessionTurn }
  | { key: string; kind: 'notice'; notice: Notice };

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Split the transcript into what is final (printed once, scrolls away) and what is still live. */
export function splitTranscript(view: ChatView): { done: StaticItem[]; live: SessionTurn[]; pending: Notice[] } {
  const { turns } = view.session;
  let finished = 0;
  while (finished < turns.length && turns[finished].result) finished += 1;
  const done: StaticItem[] = [{ key: 'header', kind: 'header' }];
  const notices = [...view.notices];
  for (let k = 0; k <= finished; k += 1) {
    while (notices.length && notices[0].afterTurn <= k) {
      const notice = notices.shift()!;
      done.push({ key: `n${notice.id}`, kind: 'notice', notice });
    }
    if (k < finished) done.push({ key: `t${turns[k].id}`, kind: 'turn', turn: turns[k] });
  }
  return { done, live: turns.slice(finished), pending: notices };
}

/** Visible slice of the draft around the cursor, for one terminal row. */
export function draftViewport(draft: string, cursor: number, width: number) {
  const chars = [...draft.replace(/\n/g, '⏎')];
  const room = Math.max(1, width);
  let start = Math.max(0, cursor - Math.floor(room / 2));
  const end = Math.min(chars.length, start + room);
  if (end - start < room) start = Math.max(0, end - room);
  return {
    before: chars.slice(start, cursor).join(''),
    at: chars[cursor] ?? ' ',
    after: chars.slice(cursor + 1, end).join(''),
  };
}

export function ChatApp({
  controller,
  cwd,
  version,
  onQuit,
}: {
  controller: ChatController;
  cwd: string;
  version: string;
  onQuit?: () => void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [view, setView] = useState<ChatView>(controller.get);
  // The draft lives in a ref: keys can arrive faster than React re-renders (pastes, fast typing),
  // and each one must see the previous key's result.
  const draftRef = useRef({ text: '', cursor: 0 });
  const [, redraw] = useState(0);
  const draft = draftRef.current.text;
  const cursor = draftRef.current.cursor;
  const [now, setNow] = useState(Date.now());
  const [armedExit, setArmedExit] = useState(false);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(0);
  const stash = useRef('');
  const width = Math.max(40, (stdout.columns || 80) - 1);
  const rows = stdout.rows || 24;

  useEffect(() => {
    let seen = controller.get().session;
    return controller.subscribe((next) => {
      // The terminal's bark: ring the bell when an approval waits or a turn finishes.
      if (next.bark && needsAttention(seen, next.session)) stdout.write('\x07');
      seen = next.session;
      setView(next);
    });
  }, [controller, stdout]);
  const running = view.session.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(timer);
  }, [running]);

  const quit = () => {
    controller.close();
    onQuit?.();
    exit();
  };

  const edit = (next: string, at: number) => {
    draftRef.current = { text: next, cursor: Math.max(0, Math.min([...next].length, at)) };
    setArmedExit(false);
    redraw((n) => n + 1);
  };
  const setCursor = (at: number) => edit(draftRef.current.text, at);

  const suggestions = useMemo(() => {
    if (!draft.startsWith('/') || draft.includes(' ')) return [];
    return SLASH_COMMANDS.filter((command) => command.name.startsWith(draft));
  }, [draft]);

  const approval = view.session.approvals[0];

  useInput((input, key) => {
    const { text: draft, cursor } = draftRef.current;
    if (key.ctrl && input === 'c') {
      if (draft) return edit('', 0);
      if (armedExit) return quit();
      if (running) controller.stop();
      setArmedExit(true);
      return;
    }
    if (key.ctrl && input === 'd' && !draft) return quit();
    if (approval && !draft && (input === 'y' || input === 'n')) {
      controller.approve(approval.id, input === 'y' ? 'approve' : 'deny');
      return;
    }
    if (key.escape) {
      if (running) controller.stop();
      else edit('', 0);
      return;
    }
    if (key.return) {
      const text = draft;
      if (!text.trim()) return;
      if (history.current.at(-1) !== text) history.current.push(text);
      historyIndex.current = history.current.length;
      edit('', 0);
      if (controller.submit(text) === 'quit') quit();
      return;
    }
    const chars = [...draft];
    if (key.tab) {
      if (suggestions.length) edit(`${suggestions[0].name} `, suggestions[0].name.length + 1);
      return;
    }
    if (key.leftArrow) return setCursor(Math.max(0, cursor - 1));
    if (key.rightArrow) return setCursor(Math.min(chars.length, cursor + 1));
    if (key.upArrow) {
      if (!history.current.length || historyIndex.current === 0) return;
      if (historyIndex.current === history.current.length) stash.current = draft;
      historyIndex.current -= 1;
      const entry = history.current[historyIndex.current];
      return edit(entry, [...entry].length);
    }
    if (key.downArrow) {
      if (historyIndex.current >= history.current.length) return;
      historyIndex.current += 1;
      const entry =
        historyIndex.current === history.current.length ? stash.current : history.current[historyIndex.current];
      return edit(entry, [...entry].length);
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      chars.splice(cursor - 1, 1);
      return edit(chars.join(''), cursor - 1);
    }
    if (key.ctrl && input === 'a') return setCursor(0);
    if (key.ctrl && input === 'e') return setCursor(chars.length);
    if (key.ctrl && input === 'u') return edit(chars.slice(cursor).join(''), 0);
    if (key.ctrl || key.meta || !input) return;
    const typed = [...input.replace(/\r\n?/g, '\n')];
    chars.splice(cursor, 0, ...typed);
    edit(chars.join(''), cursor + typed.length);
  });

  const { done, live, pending } = splitTranscript(view);
  const current = live[0];
  const viewport = draftViewport(draft, cursor, width - 6);
  const spinner = SPINNER[Math.floor(now / 120) % SPINNER.length];
  const queued = view.session.queued;

  return (
    <>
      <Static items={done}>
        {(item) =>
          item.kind === 'header' ? (
            <Box key={item.key} flexDirection="column" marginBottom={1}>
              <Text>
                <Text color="cyan" bold>
                  🐺 genaicode
                </Text>
                <Text color="gray"> {version} · coding agents in your terminal</Text>
              </Text>
              <Text color="gray">
                {view.session.agent} in {cwd} · /help for commands · esc stops the agent
              </Text>
            </Box>
          ) : item.kind === 'turn' ? (
            <Box key={item.key} width={width}>
              <TurnView turn={item.turn} width={width} cwd={cwd} />
            </Box>
          ) : (
            <NoticeView key={item.key} notice={item.notice} />
          )
        }
      </Static>
      <Box flexDirection="column" width={width}>
        {live.map((turn) => (
          <TurnView key={turn.id} turn={turn} live now={now} width={width} maxRows={Math.max(4, rows - 12)} cwd={cwd} />
        ))}
        {pending.map((notice) => (
          <NoticeView key={notice.id} notice={notice} />
        ))}
        {approval ? (
          <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
            <Text>
              <Text color="yellow" bold>
                {view.session.agent} asks:{' '}
              </Text>
              {approval.kind === 'command'
                ? 'run a command'
                : approval.kind === 'file-change'
                  ? 'apply edits'
                  : 'permission'}
            </Text>
            {approval.summary ? <Text color="cyan">{approval.summary}</Text> : null}
            <Text color="gray">
              <Text color="green" bold>
                y
              </Text>{' '}
              {approval.scope === 'turn' ? 'approve for this turn' : 'approve'} ·{' '}
              <Text color="red" bold>
                n
              </Text>{' '}
              deny
            </Text>
          </Box>
        ) : null}
        {current && !current.result ? (
          <Text>
            <Text color="cyan">{spinner} </Text>
            <Text>
              {view.session.agent} is working {formatDuration(now - current.startedAt)}
            </Text>
            <Text color="gray">
              {' '}
              · esc to stop{queued.length ? ` · ${queued.length} queued` : ''}
              {view.session.canSteer ? ' · type to steer' : ''}
            </Text>
          </Text>
        ) : null}
        {queued.map((prompt, i) => (
          <Text key={i} color="gray">
            {'  '}⏸ {prompt}
          </Text>
        ))}
        <Box borderStyle="round" borderColor={running ? 'gray' : 'cyan'} paddingX={1}>
          <Text color="cyan" bold>
            ›{' '}
          </Text>
          {draft ? (
            <Text>
              {viewport.before}
              <Text inverse>{viewport.at}</Text>
              {viewport.after}
            </Text>
          ) : (
            <Text color="gray">
              <Text inverse> </Text>
              {running
                ? view.session.canSteer
                  ? 'Add to the running task…'
                  : 'Queue the next prompt…'
                : 'Ask the agent to change something…'}
            </Text>
          )}
        </Box>
        {suggestions.length ? (
          <Box flexDirection="column" paddingLeft={2}>
            {suggestions.map((command) => (
              <Text key={command.name}>
                <Text color="cyan">{command.name}</Text>
                <Text color="gray">
                  {command.args ? ` ${command.args}` : ''} {command.help}
                </Text>
              </Text>
            ))}
          </Box>
        ) : (
          <Box paddingLeft={2}>
            <Text color="gray" wrap="truncate-end">
              {statusParts(view.session).join(' · ')}
              {armedExit ? ' · press ctrl+c again to exit' : ''}
            </Text>
          </Box>
        )}
      </Box>
    </>
  );
}
