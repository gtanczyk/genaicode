// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEntry, SessionState } from '../agents/session.js';
import { AgentChat } from '../react.js';
import { arrivedWhole, revealDuration, revealedAt, revealUnits } from './reveal.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPLY =
  'The parser drops the last line when the file has no newline at the end, so the totals are short by one row.';

function state(entries: SessionEntry[], done = false): SessionState {
  return {
    agent: 'codex',
    cwd: '/work',
    status: done ? 'idle' : 'running',
    canSteer: false,
    usage: {},
    costUsd: 0,
    queued: [],
    approvals: [],
    turns: [
      {
        id: 1,
        agent: 'codex',
        prompt: 'Why are the totals off?',
        startedAt: 1,
        entries,
        ...(done ? { endedAt: 2, result: { status: 'completed', ok: true, exitCode: 0, signal: null } } : {}),
      },
    ],
  };
}

let root: Root;
let host: HTMLDivElement;
let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const show = (value: SessionState) =>
  act(() => root.render(<AgentChat state={value} onSend={() => undefined} onStop={() => undefined} />));
const reply = () => host.querySelector('.gc-md')?.textContent ?? '';
const whole: SessionEntry = { kind: 'text', text: REPLY, streaming: false };

describe('revealing a reply that arrived whole', () => {
  it('starts with its first words and shows the rest at once on a click', () => {
    show(state([]));
    show(state([whole]));
    expect(reply().length).toBeGreaterThan(0);
    expect(reply().length).toBeLessThan(REPLY.length);
    act(() => window.dispatchEvent(new Event('pointerdown')));
    expect(reply()).toBe(REPLY);
  });

  it('ends on its own within the reveal time', async () => {
    show(state([]));
    show(state([whole]));
    await act(() => new Promise((resolve) => setTimeout(resolve, revealDuration(REPLY.length) + 100)));
    expect(reply()).toBe(REPLY);
  });

  it('shows history, streamed text and text under reduced motion in full', () => {
    show(state([whole], true));
    expect(reply()).toBe(REPLY);
    act(() => root.unmount());
    root = createRoot(host);
    show(state([]));
    show(state([{ kind: 'text', text: 'The parser', streaming: true }]));
    show(state([whole]));
    expect(reply()).toBe(REPLY);
    act(() => root.unmount());
    root = createRoot(host);
    reduced = true;
    show(state([]));
    show(state([whole]));
    expect(reply()).toBe(REPLY);
  });
});

describe('reveal steps', () => {
  it('takes 300–600 ms, faster per character the longer the text', () => {
    expect(revealDuration(0)).toBe(300);
    expect(revealDuration(100)).toBe(360);
    expect(revealDuration(50_000)).toBe(600);
    expect(revealDuration(2000) / 2000).toBeLessThan(revealDuration(200) / 200);
  });

  it('reveals by words, or by lines when long, always with something shown', () => {
    expect(revealUnits('one two  three')).toEqual(['one ', 'two  ', 'three']);
    const long = `${'a line of text\n'.repeat(100)}end`;
    expect(revealUnits(long)).toHaveLength(101);
    expect(revealedAt(['one ', 'two ', 'three'], 0)).toBe('one ');
    expect(revealedAt(['one ', 'two ', 'three'], 0.5)).toBe('one two ');
    expect(revealedAt(['one ', 'two ', 'three'], 1)).toBe('one two three');
  });

  it('counts as arrived whole only new text of a turn already shown', () => {
    const seen = { turns: new Map([['c:1', ['Looking at the parser']]]) };
    expect(arrivedWhole(seen, 'c:1', 'Done.')).toBe(true);
    expect(arrivedWhole(seen, 'c:1', 'Looking at the parser now')).toBe(false);
    expect(arrivedWhole(seen, 'c:2', 'Done.')).toBe(false);
    expect(arrivedWhole(seen, 'c:1', 'Done.', true)).toBe(false);
    expect(arrivedWhole(undefined, 'c:1', 'Done.')).toBe(false);
  });
});
