import { Box, Text, useInput } from 'ink';
import { useRef, useState } from 'react';
import type { PackAction, PackTask } from '../../agents/pack.js';
import type { SessionTurn } from '../../agents/session.js';
import { packQuotaText, packCheckLabel, packSteerText, packTaskStatus } from '../../react/format.js';
import { plainSessionText, type ChatController } from '../controller.js';

export interface TaskSelection {
  turnId: number;
  id: string;
}
interface TaskRow {
  turn: SessionTurn;
  task: PackTask;
}

export function PackInspector({
  current,
  tasks,
  controller,
  select,
  rows,
}: {
  current: TaskRow;
  tasks: TaskRow[];
  controller: ChatController;
  select(value?: TaskSelection): void;
  rows: number;
}) {
  const { turn, task } = current;
  const [mode, setMode] = useState<'task' | 'steer' | 'stop' | 'discard' | 'diff' | 'queue'>('task');
  const [draft, setDraft] = useState('');
  const [output, setOutput] = useState('');
  const [offset, setOffset] = useState(0);
  const busy = useRef(false);
  const inspected = useRef<{ turnId: number; id: string; revision?: string }>(undefined);
  const pending = controller.get().session.approvals;
  const request =
    mode === 'queue' ? pending[0] : !turn.result && pending.find((request) => request.subtaskId === task.id);
  const running = task.status === 'running';
  const review = !running && task.state === 'unmerged';
  const checks = task.checks;
  const checking = checks?.review?.status === 'running' || checks?.verify?.status === 'running';
  const act = turn.pack?.interactive && controller.session.actOnPackTask;
  const lines = output.split('\n');
  const page = Math.max(3, rows - 16);
  const perform = async (action: PackAction) => {
    if (!act || busy.current) return;
    busy.current = true;
    setOutput('Working…');
    try {
      const reply = await act(turn.id, task.id, action);
      if (action.type === 'diff') inspected.current = { turnId: turn.id, id: task.id, revision: action.revision };
      if (action.type === 'review' || action.type === 'verify') inspected.current = undefined;
      setOutput(action.type === 'review' || action.type === 'verify' ? '' : plainSessionText(reply));
      setOffset(0);
      setMode(action.type === 'diff' ? 'diff' : 'task');
    } catch (error) {
      setOutput(plainSessionText(error instanceof Error ? error.message : String(error)));
      setMode('task');
    } finally {
      busy.current = false;
    }
  };
  useInput((input, key) => {
    if (key.tab || (key.ctrl && (input === 'c' || input === 'd'))) return select();
    if (key.escape) {
      if (mode === 'task') return select();
      setOutput('');
      setMode('task');
      return;
    }
    if (busy.current) return;
    if (mode === 'steer') {
      if (!running || !task.canSteer) {
        setMode('task');
        return;
      }
      if (key.return && draft.trim()) void perform({ type: 'steer', text: draft.trim() });
      else if (key.delete || key.backspace) setDraft((value) => [...value].slice(0, -1).join(''));
      else if (input && !key.ctrl && !key.meta) setDraft((value) => (value + input).slice(0, 32_000));
      return;
    }
    if (mode === 'stop' || mode === 'discard') {
      if (input === 'x') void perform({ type: mode });
      return;
    }
    if (mode === 'diff') {
      if (key.upArrow || key.pageUp) setOffset((at) => Math.max(0, at - (key.pageUp ? page : 1)));
      if (key.downArrow || key.pageDown)
        setOffset((at) => Math.min(Math.max(0, lines.length - page), at + (key.pageDown ? page : 1)));
      return;
    }
    if (request && (input === 'y' || input === 'n')) {
      controller.approve(request.id, input === 'y' ? 'approve' : 'deny');
      return;
    }
    if (input === 'q') {
      setMode(mode === 'queue' ? 'task' : 'queue');
      return;
    }
    if (mode === 'queue') return;
    if (key.upArrow || key.downArrow) {
      const at = tasks.findIndex((row) => row.turn.id === turn.id && row.task.id === task.id);
      const next = tasks[(at + (key.upArrow ? -1 : 1) + tasks.length) % tasks.length];
      setOutput('');
      select({ turnId: next.turn.id, id: next.task.id });
    } else if (act && input === 'i' && running && task.canSteer) {
      setDraft('');
      setMode('steer');
    } else if (input === 'c' && (checks?.review || checks?.verify)) {
      setOutput(
        (['review', 'verify'] as const)
          .flatMap((kind) =>
            checks[kind]
              ? [
                  `${kind === 'review' ? 'Code review' : 'Tests'} · ${packCheckLabel(checks, kind)}`,
                  plainSessionText(checks[kind].detail ?? ''),
                ]
              : [],
          )
          .join('\n'),
      );
      setOffset(0);
      setMode('diff');
    } else if (act && input === 'u' && task.state === 'discarded' && task.recoveryDir) {
      void perform({ type: 'restore' });
    } else if (act && input === 'x' && !checking && (running || review)) {
      setMode(running ? 'stop' : 'discard');
    } else if (act && review && input === 'd') void perform({ type: 'diff', revision: checks?.revision });
    else if (act && review && !checking) {
      if (input === 'm') {
        const seen = inspected.current;
        const revision = seen?.turnId === turn.id && seen.id === task.id ? seen.revision : checks?.revision;
        void perform({ type: 'merge', revision });
      }
      if (input === 'r' && checks?.reviewer) void perform({ type: 'review' });
      if (input === 'v' && checks?.command) void perform({ type: 'verify' });
    }
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>
        {mode === 'queue' ? 'Approval queue' : `${task.id} · ${task.agent} · ${packTaskStatus(task, !!request)}`}
      </Text>
      {mode === 'queue' && !request ? <Text>No pending approvals.</Text> : null}
      {mode === 'task' && (
        <>
          <Text>{plainSessionText(task.prompt)}</Text>
          <Text color="gray" wrap="truncate-middle">
            {task.mode} · {plainSessionText(task.cwd)}
          </Text>
          {task.text && <Text>{plainSessionText(task.text)}</Text>}
          {task.steers?.map((steer, i) => (
            <Text
              key={i}
              color={steer.delivery === 'dropped' ? 'red' : steer.delivery === 'delivered' ? 'green' : 'gray'}
            >
              › {plainSessionText(steer.text)} ({packSteerText(steer, task.agent)})
            </Text>
          ))}
          {task.quotaHint && <Text color="yellow">{plainSessionText(packQuotaText(task.agent, task.quotaHint))}</Text>}
          {task.error && <Text color="red">{plainSessionText(task.error)}</Text>}
          {task.recoveryDir && <Text>Worktree kept at {plainSessionText(task.recoveryDir)}</Text>}
          {task.changes?.length ? <Text>{plainSessionText(task.changes.join(' · '))}</Text> : null}
          {checks && !running && (review || checks.review || checks.verify) && (
            <>
              <Text>
                Code review ·{' '}
                {checks.reviewer
                  ? `${plainSessionText(checks.reviewer)} · ${packCheckLabel(checks, 'review')}`
                  : 'No reviewer with tools disabled'}
              </Text>
              <Text>
                Tests ·{' '}
                {checks.command
                  ? `${plainSessionText(checks.command)} · ${packCheckLabel(checks, 'verify')}`
                  : 'Choose a command with --verify'}
              </Text>
            </>
          )}
        </>
      )}
      {(mode === 'queue' || mode === 'task') && request ? (
        <Text color="yellow">
          {plainSessionText(request.summary ?? request.id)} · y{' '}
          {request.scope === 'turn' ? 'approve for this turn' : 'approve once'} · n deny
        </Text>
      ) : null}
      {mode === 'steer' && (
        <Text>
          Message to {task.agent} › {plainSessionText(draft)}▏ · Enter sends · Esc cancels
        </Text>
      )}
      {(mode === 'stop' || mode === 'discard') && (
        <Text color="yellow">
          {mode === 'stop' ? 'Stop this task?' : 'Discard this worktree and its changes?'} · x confirms · Esc cancels
        </Text>
      )}
      {mode === 'diff' ? (
        <>
          <Text>{lines.slice(offset, offset + page).join('\n')}</Text>
          <Text color="gray">
            Lines {offset + 1}–{Math.min(lines.length, offset + page)} of {lines.length} · ↑↓ scroll · Esc back
          </Text>
        </>
      ) : output && mode === 'task' ? (
        <Text>{output}</Text>
      ) : null}
      {mode === 'task' && (
        <Text color="gray">
          {[
            '↑↓ select',
            `q approvals (${pending.length})`,
            act && running && task.canSteer && 'i steer',
            act && running && 'x stop',
            act && task.state === 'discarded' && task.recoveryDir && 'u undo discard',
            act && review && 'd diff · m merge locally · x discard',
            act && review && checks?.reviewer && 'r review',
            act && review && checks?.command && 'v run tests',
            (checks?.review || checks?.verify) && 'c read results',
            'Tab chat',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}
      {mode === 'queue' && <Text color="gray">{pending.length} pending · q back · Tab chat</Text>}
    </Box>
  );
}
