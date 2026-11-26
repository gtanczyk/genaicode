import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionTurn } from '../../agents/session.js';
import type { QuestionAnswers } from '../../agents/types.js';
import type { ChatController, ChatView, Notice } from '../controller.js';
import { formatDuration, limitChips, needsAttention, SLASH_COMMANDS, statusParts } from '../format.js';
import { packTaskList } from '../../react/format.js';
import { NoticeView, TurnView } from './transcript.js';
import { PackInspector, type TaskSelection } from './pack-inspector.js';
import { TowerInboxPanel } from './tower-inbox.js';

type StaticItem =
  | { key: string; kind: 'header' }
  | { key: string; kind: 'turn'; turn: SessionTurn }
  | { key: string; kind: 'notice'; notice: Notice };

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const isLiveRelay = (notice: Notice) => notice.relay?.status === 'queued' || notice.relay?.status === 'working';

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
  const held: Notice[] = [];
  for (let k = 0; k <= finished; k += 1) {
    while (notices.length && notices[0].afterTurn <= k) {
      const notice = notices.shift()!;
      if (isLiveRelay(notice)) held.push(notice);
      else done.push({ key: `n${notice.id}`, kind: 'notice', notice });
    }
    if (k < finished) done.push({ key: `t${turns[k].id}`, kind: 'turn', turn: turns[k] });
  }
  return { done, live: turns.slice(finished), pending: [...held, ...notices] };
}

/** Visible slice of the draft around the cursor, for one terminal row. */
/** A draft that is one of the chat's /commands, as opposed to text that starts with a slash. */
function isCommand(draft: string): boolean {
  const name = /^\/\S+/.exec(draft.trim())?.[0];
  return !!name && SLASH_COMMANDS.some((command) => command.name === name);
}

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
  canQuit,
}: {
  controller: ChatController;
  cwd: string;
  version: string;
  onQuit?: () => void;
  canQuit?: () => boolean;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [view, setView] = useState<ChatView>(controller.get);
  // The draft lives in a ref: keys can arrive faster than React re-renders (pastes, fast typing),
  // and each one must see the previous key's result.
  // `shell`: the draft is a shell command (`!` typed on an empty prompt, as in Claude Code).
  const draftRef = useRef({ text: '', cursor: 0, shell: false });
  const [, redraw] = useState(0);
  const secretFor = useRef<string | undefined>(undefined);
  const draft = draftRef.current.text;
  const shellMode = draftRef.current.shell;
  const [now, setNow] = useState(Date.now());
  const [armedExit, setArmedExit] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [selection, selectTask] = useState<TaskSelection>();
  const [answering, setAnswering] = useState<{ id: string; answers: QuestionAnswers; done: string[] }>({
    id: '',
    answers: {},
    done: [],
  });
  const history = useRef<string[]>([]);
  const historyIndex = useRef(0);
  const stash = useRef('');
  const width = Math.max(40, (stdout.columns || 80) - 1);
  const rows = stdout.rows || 24;

  const restored = useRef<string | undefined>(undefined);
  useEffect(() => {
    const saved = view.recoveredDraft;
    if (!saved || restored.current === saved.id) return;
    restored.current = saved.id;
    const text = [...saved.prompts, draftRef.current.text].filter(Boolean).join('\n\n');
    draftRef.current = { text, cursor: [...text].length, shell: false };
    redraw((n) => n + 1);
  }, [view.recoveredDraft?.id]);
  // Counts `/clear`: a new `<Static>` forgets what the old one printed.
  const [cleared, setCleared] = useState(0);
  useEffect(() => {
    // The tower's initial read can finish between rendering and subscribing.
    const current = controller.get();
    setView(current);
    let seen = current;
    return controller.subscribe((next) => {
      // The terminal's bark: ring the bell when an approval waits, a turn finishes, or a relay settles.
      if (next.bark && needsAttention(seen.session, next.session, seen.notices, next.notices)) stdout.write('\x07');
      // `/clear`: what the terminal already printed goes too, and the header prints again.
      if (seen.session.turns.length && !next.session.turns.length) {
        if (stdout.isTTY) stdout.write('\x1b[2J\x1b[3J\x1b[H');
        setCleared((count) => count + 1);
      }
      seen = next;
      setView(next);
    });
  }, [controller, stdout]);
  const running = view.session.status === 'running';
  const relayWorking = view.notices.some((notice) => notice.relay?.status === 'working');
  useEffect(() => {
    if (!running && !relayWorking) return;
    const timer = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(timer);
  }, [running, relayWorking]);

  const quit = () => {
    if (canQuit && !canQuit()) return;
    if (!canQuit) controller.close();
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
  // A question of the agent is answered one question at a time; this holds what was chosen so far.
  const asked = approval?.kind === 'question' && approval.questions?.length ? approval : undefined;
  const partial = asked && answering.id === asked.id ? answering.answers : {};
  const question = asked?.questions!.find((item) => !answering.done.includes(item.id) || answering.id !== asked.id);
  /** Close the current question with `picked`; the last one sends every answer. */
  const answerQuestion = (picked: string[]) => {
    if (!asked || !question) return;
    const others = Object.fromEntries(Object.entries(partial).filter(([id]) => id !== question.id));
    const answers: QuestionAnswers = { ...others, ...(picked.length ? { [question.id]: picked } : {}) };
    const done = [...(answering.id === asked.id ? answering.done : []), question.id];
    if (done.length < asked.questions!.length) return setAnswering({ id: asked.id, answers, done });
    setAnswering({ id: '', answers: {}, done: [] });
    if (Object.keys(answers).length) controller.answer(asked.id, answers);
    else controller.approve(asked.id, 'deny');
  };
  // Tab and the arrows go through the tasks in the order the transcript shows them, folded ones included.
  const tasks = view.session.turns.flatMap((turn) =>
    turn.pack
      ? packTaskList(turn.pack.tasks, {
          asking: (task) => view.session.approvals.some((request) => request.subtaskId === task.id),
          expanded: true,
        }).shown.map((task) => ({ turn, task }))
      : [],
  );
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
    if (asked && question && plain) {
      // Up to nine options a digit picks at once; with more, the number is typed and Enter picks it.
      const many = question.options.length > 9;
      const number = many ? (key.return && /^\d+$/.test(draft.trim()) ? draft.trim() : '') : !draft ? input : '';
      const option = /^[1-9]\d*$/.test(number) ? question.options[Number(number) - 1] : undefined;
      if (option) {
        if (many) edit('', 0, false);
        if (!question.multiple) return answerQuestion([option.label]);
        const had = partial[question.id] ?? [];
        const next = had.includes(option.label) ? had.filter((item) => item !== option.label) : [...had, option.label];
        return setAnswering({
          id: asked.id,
          answers: { ...partial, [question.id]: next },
          done: answering.id === asked.id ? answering.done : [],
        });
      }
      // Enter: what was typed is the answer (where the agent takes one), else the options picked so far.
      // Only a known /command runs as one: `/work/repo` is an answer; `//x` and `!!x` answer `/x` and `!x`.
      if (key.return && !isCommand(draft)) {
        const literal = draft.startsWith('//') || draft.startsWith('!!');
        const typed = question.freeText ? (literal ? draft.slice(1) : draft).trim() : '';
        const chosen = question.multiple ? (partial[question.id] ?? []) : [];
        if (typed || chosen.length) {
          edit('', 0, false);
          return answerQuestion(typed ? [...chosen, typed] : chosen);
        }
        // Where an answer can be typed, letters belong to it: an empty Enter skips instead of `n`.
        if (!draft && !question.freeText) return;
      }
      // Skip this question. With nothing answered at all, the agent is told so.
      if (!draft && (question.freeText ? key.return : input === 'n')) return answerQuestion([]);
    }
    if (approval && !asked && !draft && plain && (input === 'y' || input === 'n')) {
      controller.approve(approval.id, input === 'y' ? 'approve' : 'deny');
      return;
    }
    if (approval && !asked && !draft && plain && input === 'a') {
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
    // History never takes a secret along: it would come back unmasked once the question is gone.
    if ((key.upArrow || key.downArrow) && question?.secret) return;
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
    // While the agent waits for a typed answer, `!` is part of it (a password may start with one).
    const answers = asked && question?.freeText;
    if (!shell && !draft && !answers && typed[0] === '!' && typed[1] !== '!') {
      typed = typed.slice(1);
      return edit(typed.join(''), typed.length, true);
    }
    chars.splice(cursor, 0, ...typed);
    edit(chars.join(''), cursor + typed.length);
  });

  const { done, live, pending } = splitTranscript(view);
  const current = live.find((turn) => !turn.result);
  // A secret typed for a question that went away (withdrawn, timed out) is dropped, never shown.
  const secretKey = asked && question?.secret ? `${asked.id}:${question.id}` : undefined;
  if (secretFor.current && secretFor.current !== secretKey) {
    draftRef.current = { text: '', cursor: 0, shell: false };
    stash.current = '';
  }
  secretFor.current = secretKey;
  // A secret answer never shows as typed: the composer draws one dot per character.
  const { text: typed, cursor: at } = draftRef.current;
  const shownDraft = secretKey && !isCommand(typed) ? '•'.repeat([...typed].length) : typed;
  const viewport = draftViewport(shownDraft, at, width - 6);
  const spinner = SPINNER[Math.floor(now / 120) % SPINNER.length];
  const queued = view.session.queued;

  return (
    <>
      <Static key={cleared} items={done}>
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
          <NoticeView key={notice.id} notice={notice} now={now} />
        ))}
        {currentTask ? (
          <PackInspector current={currentTask} tasks={tasks} controller={controller} select={selectTask} rows={rows} />
        ) : null}
        {!currentTask && asked && question ? (
          <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
            <Text>
              <Text color="cyan" bold>
                {asked.subtaskId ? `Task ${asked.subtaskId}` : (current?.pack?.lead ?? view.session.agent)} asks
                {asked.questions!.length > 1
                  ? ` (${asked.questions!.indexOf(question) + 1}/${asked.questions!.length})`
                  : ''}
                :{' '}
              </Text>
              {question.question}
            </Text>
            {question.options.map((option, index) => (
              <Text key={option.label}>
                <Text color="green" bold>
                  {index + 1}
                </Text>{' '}
                {question.multiple ? ((partial[question.id] ?? []).includes(option.label) ? '[x] ' : '[ ] ') : ''}
                {option.label}
                {option.description ? <Text color="gray"> {option.description}</Text> : null}
              </Text>
            ))}
            <Text color="gray">
              {question.options.length
                ? `${question.options.length > 9 ? 'a number + Enter' : 'a number'} ${question.multiple ? 'toggles, Enter sends' : 'chooses'}`
                : ''}
              {question.freeText ? `${question.options.length ? ' · ' : ''}type an answer and press Enter` : ''} ·{' '}
              <Text color="red" bold>
                {question.freeText ? 'Enter' : 'n'}
              </Text>{' '}
              {question.freeText ? 'on an empty line skips' : 'skip'}
            </Text>
          </Box>
        ) : null}
        {!currentTask && approval && !asked ? (
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
            {typed ? (
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
              {tasks.length && !currentTask ? ' · Tab for delegated tasks' : ''}
            </Text>
          </Box>
        )}
      </Box>
    </>
  );
}

const LIMIT_COLORS = { ok: 'gray', warning: 'yellow', exceeded: 'red' } as const;
