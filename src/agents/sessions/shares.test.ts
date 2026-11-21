import { expect, it } from 'vitest';
import { AUTOMATIC_SHARE, UNSORTED_SHARE, topicShares } from './shares.js';
import type { SessionInfo } from './types.js';

const session = (agent: string, id: string, over: Partial<SessionInfo>): SessionInfo => ({
  source: agent,
  agent,
  id,
  where: 'local',
  updatedAt: 1,
  ...over,
});

it('divides each agent work between topics, automatic runs and the rest', () => {
  const store = {
    topics: [
      { id: 't1', name: 'Pack' },
      { id: 't2', name: 'Desktop' },
    ],
    sessions: {
      'claude:a': 't1',
      'claude:b': 't1',
      'claude:c': 't2',
      'claude:auto': 't2',
      'codex:x': 't2',
      'claude:gone': 't9',
    },
  };
  const shares = topicShares(
    [
      session('claude', 'a', { costUsd: 30 }),
      session('claude', 'b', { costUsd: 20 }),
      session('claude', 'c', { costUsd: 10 }),
      // An automatic run counts as one, whatever topic it was once given.
      session('claude', 'auto', { costUsd: 30, automated: true }),
      // A topic that no longer exists, and a session nobody sorted.
      session('claude', 'gone', { costUsd: 5 }),
      session('claude', 'new', { costUsd: 5 }),
      // Nothing known about its use: it weighs nothing.
      session('claude', 'quiet', {}),
      session('codex', 'x', { usage: { totalTokens: 300 } }),
      session('codex', 'y', { usage: { inputTokens: 60, outputTokens: 40 } }),
      session('muse', 'm', {}),
    ],
    store,
  );
  expect(shares).toEqual([
    {
      agent: 'claude',
      by: 'cost',
      shares: [
        { topic: 't1', name: 'Pack', share: 0.5, sessions: 2 },
        { name: AUTOMATIC_SHARE, share: 0.3, sessions: 1 },
        { topic: 't2', name: 'Desktop', share: 0.1, sessions: 1 },
        { name: UNSORTED_SHARE, share: 0.1, sessions: 2 },
      ],
    },
    {
      agent: 'codex',
      by: 'tokens',
      shares: [
        { topic: 't2', name: 'Desktop', share: 0.75, sessions: 1 },
        { name: UNSORTED_SHARE, share: 0.25, sessions: 1 },
      ],
    },
  ]);
  // No amounts leave: only proportions.
  expect(JSON.stringify(shares)).not.toMatch(/costUsd|weight/);
});
