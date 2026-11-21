import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import wrapAnsi from 'wrap-ansi';
import type { TowerDecision, TowerView } from '../../agents/sessions/tower.js';
import { towerAction, towerChoices, towerText } from '../tower-format.js';

export function TowerInboxPanel({
  view,
  rows,
  width,
  decide,
  back,
}: {
  view: TowerView;
  rows: number;
  width: number;
  decide(id: string, decision: TowerDecision): Promise<boolean>;
  back(): void;
}) {
  const [selected, select] = useState<string>();
  const [opened, open] = useState<string>();
  const [page, setPage] = useState(0);
  const [feedback, setFeedback] = useState('');
  const index = Math.max(
    0,
    view.items.findIndex((item) => item.id === selected),
  );
  const current = view.items.find((item) => item.id === opened);
  const choices = current ? towerChoices(current) : [];
  const pageSize = Math.max(1, rows - 10);
  const detail = current
    ? [
        towerText(current.agent),
        towerText(current.cwd ?? '(unknown project)'),
        towerText(current.origin),
        '',
        towerText(current.text, true),
      ].join('\n')
    : '';
  const lines = wrapAnsi(detail, Math.max(8, width - 6), { hard: true, trim: false }).split('\n');
  const lastPage = Math.max(0, Math.ceil(lines.length / pageSize) - 1);
  const start = Math.min(page, lastPage) * pageSize;
  const listStart = Math.max(0, index - pageSize + 1);
  useInput((input, key) => {
    if (key.escape || (key.ctrl && ['g', 'c', 'd'].includes(input))) {
      if (opened && key.escape) open(undefined);
      else back();
      return;
    }
    if (opened) {
      if (!current) return;
      if (key.pageDown || key.downArrow) return setPage(Math.min(lastPage, page + 1));
      if (key.pageUp || key.upArrow) return setPage(Math.max(0, page - 1));
      if (key.ctrl || key.meta) return;
      const answer = choices.find((choice) => choice.key === input)?.decision;
      if (answer) {
        open(undefined);
        void decide(current.id, answer).then(
          (ok) => setFeedback(ok ? '' : 'This item is no longer open.'),
          () => setFeedback('Could not apply this decision.'),
        );
      }
      return;
    }
    if (key.upArrow && index > 0) select(view.items[index - 1].id);
    if (key.downArrow && index + 1 < view.items.length) select(view.items[index + 1].id);
    if (key.return && view.items[index]) {
      open(view.items[index].id);
      setPage(0);
      setFeedback('');
    }
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width}>
      <Text bold color="cyan">
        Tower inbox · {view.items.length}
      </Text>
      {opened ? (
        current ? (
          <>
            <Text bold>{towerAction(current)}</Text>
            <Text>{lines.slice(start, start + pageSize).join('\n')}</Text>
            {lastPage > 0 && (
              <Text color="gray">
                Page {page + 1}/{lastPage + 1} · ↑↓ scroll
              </Text>
            )}
            <Text color="cyan">
              {choices.map((choice) => `${choice.key} ${choice.label.toLowerCase()} · `).join('')}
              Esc back
            </Text>
          </>
        ) : (
          <Text>This item is no longer open. Esc back</Text>
        )
      ) : (
        <>
          {!view.items.length && <Text>No pending items.</Text>}
          {view.items.slice(listStart, listStart + pageSize).map((item, n) => (
            <Text key={item.id} inverse={listStart + n === index} wrap="truncate-end">
              {listStart + n === index ? '› ' : '  '}
              {towerAction(item)} · {towerText(item.agent)} · {towerText(item.cwd ?? '(unknown project)')} ·{' '}
              {towerText(item.origin)}
            </Text>
          ))}
          <Text color="gray">↑↓ select · Enter review · Esc chat</Text>
        </>
      )}
      {view.unavailable.length > 0 && (
        <Text color="yellow">Unavailable stores · {view.unavailable.map((s) => towerText(s)).join(', ')}</Text>
      )}
      {(feedback || view.status) && <Text color="gray">{feedback || towerText(view.status!)}</Text>}
    </Box>
  );
}
