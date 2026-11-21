import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionTurn } from '../../agents/session.js';
import type { ChatController, ChatView, Notice } from '../controller.js';
import { formatDuration, limitChips, needsAttention, SLASH_COMMANDS, statusParts } from '../format.js';
import { NoticeView, TurnView } from './transcript.js';
import { PackInspector, type TaskSelection } from './pack-inspector.js';
import { TowerInboxPanel } from './tower-inbox.js';

type StaticItem =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'turn'; turn: SessionTurn }
  | { key: string; kind: 'notice'; notice: Notice };

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Split the transcript into what is final (printed once, scrolls away) and what is still live. */
export function splitTranscript(view: ChatView): { done: StaticItem[]; live: SessionTurn[]; pending: Notice[] } {
  const { turns } = view.session;
  let finished = 0;
  while (finished < turns.length && turns[finished].result) {
    // Older turns scroll away. Tab can still inspect their current task state without
    // redrawing the entire history each time the active worker takes a step.
    const pack = turns[finished].pack;
    if (finished === turns.length - 1 && pack?.interactive && pack.tasks.some((task) => task.state === 'unmerged'))
      break;
    finished += 1;
  }
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
  // `shell`: the draft is a shell command (`!` typed on an empty prompt, as in Claude Code).
  const draftRef = useRef({ text: '', cursor: 0, shell: false });
  const [, redraw] = useState(0);
  const draft = draftRef.current.text;
  const cursor = draftRef.current.cursor;
  const shellMode = draftRef.current.shell;
  const [now, setNow] = useState(Date.now());
  const [armedExit, setArmedExit] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [selection, selectTask] = useState<TaskSelection>();
  const history = useRef<string[]>([]);
  const historyIndex = useRef(0);
  const stash = useRef('');
  const width = Math.max(40, (stdout.columns || 80) - 1);
  const rows = stdout.rows || 24;

  useEffect(() => {
    // The tower's initial read can finish between rendering and subscribing.
    const current = controller.get();
    setView(current);
    let seen = current.session;
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

  const edit = (next: string, at: number, shell = draftRef.current.shell) => {
    draftRef.current = { text: next, cursor: Math.max(0, Math.min([...next].length, at)), shell };
    setArmedExit(false);
    redraw((n) => n + 1);
  };
  const setCursor = (at: number) => edit(draftRef.current.text, at);
  // A history entry `!cmd` comes back in shell mode.
  const recall = (entry: string) =>
    entry.startsWith('!') ? edit(entry.slice(1), [...entry].length - 1, true) : edit(entry, [...entry].length, false);

  const suggestions = useMemo(() => {
    if (shellMode || !draft.startsWith('/') || draft.includes(' ')) return [];
    return SLASH_COMMANDS.filter((command) => command.name.startsWith(draft));
  }, [draft]);

  const approval = view.session.approvals[0];
  const tasks = view.session.turns.flatMap((turn) => (turn.pack?.tasks ?? []).map((task) => ({ turn, task })));
  const currentTask =
    selection && tasks.find(({ turn, task }) => turn.id === selection.turnId && task.id === selection.id);

  useInput((input, key) => {
    const { text: draft, cursor, shell } = draftRef.current;
    if (inboxOpen) return;
    if (view.tower && !currentTask && key.ctrl && input === 'g') return setInboxOpen(true);
    if (currentTask) return;
    if (key.tab && !draft && !shell && tasks.length) {
      const recent = tasks.filter(({ turn }) => turn.id === tasks.at(-1)!.turn.id);
      const chosen = recent.find(({ task }) => approval?.subtaskId === task.id) ?? recent[0];
      selectTask({ turnId: chosen.turn.id, id: chosen.task.id });
      return;
    }
    if (key.ctrl && input === 'c') {
      if (draft || shell) return edit('', 0, false);
      if (armedExit) return quit();
      if (running) controller.stop();
      setArmedExit(true);
      return;
    }
    if (key.ctrl && input === 'd' && !draft) return quit();
    // Not while composing a shell command: its letters must not answer the approval.
    const plain = !key.ctrl && !key.meta && !shell;
    if (approval && !draft && plain && (input === 'y' || input === 'n')) {
      controller.approve(approval.id, input === 'y' ? 'approve' : 'deny');
      return;
    }
    if (approval && !draft && plain && input === 'a') {
      controller.submit('/auto on');
      return;
    }
    if (key.escape) {
      if (shell) edit('', 0, false);
      else if (running || view.shells) controller.stop();
      else edit('', 0);
      return;
    }
    if (key.return) {
      if (!draft.trim()) return;
      const text = shell ? `!${draft}` : draft;
      if (history.current.at(-1) !== text) history.current.push(text);
      historyIndex.current = history.current.length;
      edit('', 0, false);
      if (view.tower && text.trim() === '/inbox') return setInboxOpen(true);
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
      if (historyIndex.current === history.current.length) stash.current = shell ? `!${draft}` : draft;
      historyIndex.current -= 1;
      return recall(history.current[historyIndex.current]);
    }
    if (key.downArrow) {
      if (historyIndex.current >= history.current.length) return;
      historyIndex.current += 1;
      return recall(
        historyIndex.current === history.current.length ? stash.current : history.current[historyIndex.current],
      );
    }
    if (key.backspace || key.delete) {
      // Backspace on an empty shell prompt leaves shell mode.
      if (cursor === 0 && shell && !draft) return edit('', 0, false);
      if (cursor === 0) return;
      chars.splice(cursor - 1, 1);
      return edit(chars.join(''), cursor - 1);
    }
    if (key.ctrl && input === 'a') return setCursor(0);
    if (key.ctrl && input === 'e') return setCursor(chars.length);
    if (key.ctrl && input === 'u') return edit(chars.slice(cursor).join(''), 0);
    if (key.ctrl || key.meta || !input) return;
    let typed = [...input.replace(/\r\n?/g, '\n')];
    if (!shell && !draft && typed[0] === '!' && typed[1] !== '!') {
      typed = typed.slice(1);
      return edit(typed.join(''), typed.length, true);
    }
    chars.splice(cursor, 0, ...typed);
    edit(chars.join(''), cursor + typed.length);
  });

  const { done, live, pending } = splitTranscript(view);
  const current = live.find((turn) => !turn.result);
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
                {view.session.agent} in {cwd} · /help for commands · /web opens the browser · esc stops the agent
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
      {inboxOpen && view.tower && (
        <TowerInboxPanel
          view={view.tower}
          rows={rows}
          width={width}
          decide={controller.decideTower}
          back={() => setInboxOpen(false)}
        />
      )}
      <Box display={inboxOpen ? 'none' : 'flex'} flexDirection="column" width={width}>
        {view.tower && <Text color="cyan">Tower inbox · {view.tower.items.length} · Ctrl+G to open</Text>}
        {live.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            live={!turn.result}
            now={now}
            width={width}
            maxRows={Math.max(3, rows - 12 - (turn.pack?.tasks.length ?? 0))}
            cwd={cwd}
            selectedTask={selection?.turnId === turn.id ? selection.id : undefined}
            approvals={turn.result ? [] : view.session.approvals}
          />
        ))}
        {pending.map((notice) => (
          <NoticeView key={notice.id} notice={notice} />
        ))}
        {currentTask ? (
          <PackInspector current={currentTask} tasks={tasks} controller={controller} select={selectTask} rows={rows} />
        ) : null}
        {!currentTask && approval ? (
          <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
            <Text>
              <Text color="yellow" bold>
                {approval.subtaskId ? `Task ${approval.subtaskId}` : (current?.pack?.lead ?? view.session.agent)} asks
                {current?.pack ? ` (${view.session.approvals.length} pending)` : ''}:{' '}
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
              <Text color="green" bold>
                a
              </Text>{' '}
              approve all from now on ·{' '}
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
              {current.pack?.lead ?? view.session.agent} is working {formatDuration(now - current.startedAt)}
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
        {!currentTask && (
          <Box borderStyle="round" borderColor={shellMode ? 'magenta' : running ? 'gray' : 'cyan'} paddingX={1}>
            <Text color={shellMode ? 'magenta' : 'cyan'} bold>
              {shellMode ? '!' : '›'}{' '}
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
                {shellMode
                  ? `Run a shell command in ${cwd}…`
                  : running
                    ? view.session.canSteer
                      ? 'Add to the running task…'
                      : 'Queue the next prompt…'
                    : 'Ask the agent to change something…'}
              </Text>
            )}
          </Box>
        )}
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
              {shellMode
                ? 'shell mode · enter runs it here · /stop ends it · esc or backspace to leave'
                : statusParts(view.session).join(' · ')}
              {shellMode
                ? null
                : limitChips(view.session).map((chip) => (
                    <Text key={chip.key} color={LIMIT_COLORS[chip.level]}>
                      {` · ${chip.text}`}
                    </Text>
                  ))}
              {armedExit ? ' · press ctrl+c again to exit' : ''}
              {tasks.length && !currentTask ? ' · Tab for pack tasks' : ''}
            </Text>
          </Box>
        )}
      </Box>
    </>
  );
}

const LIMIT_COLORS = { ok: 'gray', warning: 'yellow', exceeded: 'red' } as const;
