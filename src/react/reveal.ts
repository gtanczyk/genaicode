import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { SessionTurn } from '../agents/session.js';

/**
 * A reply that arrives whole (agents whose CLI sends complete messages only: `codex exec`, vibe,
 * opencode) is revealed quickly, by words or, when long, by lines, so it reads as arriving rather
 * than popping in. Only the content already there is shown faster or slower: nothing waits. Skipped
 * with `prefers-reduced-motion`, for text that was streamed, and for what was there before (history,
 * a chat opened, a reload); shown in full at once on a scroll, a click, a key, or the next message.
 */

/** The texts of each turn at the last commit, by the turn's key in the transcript. */
export interface RevealSeen {
  turns: Map<string, readonly string[]>;
}

/** The transcript's record of what it showed: absent, nothing is revealed. */
export const RevealRegistry = createContext<RevealSeen | undefined>(undefined);
/** The key of the turn an entry belongs to. */
export const RevealTurn = createContext<string | undefined>(undefined);

/** Notes, after a commit, the texts each turn showed. */
export function useRevealRegistry(turns: readonly SessionTurn[], keyOf: (turn: SessionTurn) => string): RevealSeen {
  const seen = useRef<RevealSeen>({ turns: new Map() });
  useEffect(() => {
    seen.current.turns = new Map(
      turns.map((turn) => [
        keyOf(turn),
        turn.entries.flatMap((entry) => (entry.kind === 'text' && entry.text ? [entry.text] : [])),
      ]),
    );
  });
  return seen.current;
}

/**
 * Whether a text arrived whole since the last commit, in a turn that was already shown: not
 * streamed (no earlier text of its turn starts it), not history.
 */
export function arrivedWhole(
  seen: RevealSeen | undefined,
  turn: string | undefined,
  text: string,
  streaming?: boolean,
) {
  if (!seen || turn === undefined || streaming || !text.trim()) return false;
  const before = seen.turns.get(turn);
  if (!before) return false;
  return !before.some((earlier) => text.startsWith(earlier));
}

const LONG = 1_200;

/** How long revealing takes: 300 ms for a line, up to 600 ms, per character faster the longer it is. */
export function revealDuration(length: number): number {
  return Math.round(Math.min(600, 300 + Math.sqrt(length) * 6));
}

/** The parts revealed one after another: words, or lines for a long text. */
export function revealUnits(text: string): string[] {
  const units = text.length > LONG ? text.match(/[^\n]*\n|[^\n]+$/g) : text.match(/\s*\S+\s*/g);
  return units && units.join('') === text ? units : [text];
}

/** The text shown `fraction` (0–1) of the way through: at least its first part. */
export function revealedAt(units: readonly string[], fraction: number): string {
  const count = Math.max(1, Math.ceil(Math.min(1, Math.max(0, fraction)) * units.length));
  return units.slice(0, count).join('');
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

// The reveal under way: the next one shows it in full at once.
let finishCurrent: (() => void) | undefined;

const SKIP_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;

/** The part of `text` to show now: all of it unless it arrived whole just now. */
export function useReveal(text: string, streaming?: boolean): string {
  const seen = useContext(RevealRegistry);
  const turn = useContext(RevealTurn);
  // Decided once, when the entry first shows.
  const [reveal] = useState(
    () => typeof window !== 'undefined' && arrivedWhole(seen, turn, text, streaming) && !reducedMotion(),
  );
  const [fraction, setFraction] = useState(reveal ? 0 : 1);
  const first = useRef(text);
  useEffect(() => {
    if (!reveal) return;
    let frame = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      for (const name of SKIP_EVENTS) window.removeEventListener(name, finish, true);
      if (finishCurrent === finish) finishCurrent = undefined;
      setFraction(1);
    };
    finishCurrent?.();
    finishCurrent = finish;
    for (const name of SKIP_EVENTS) window.addEventListener(name, finish, { capture: true, passive: true });
    const started = performance.now();
    const duration = revealDuration(text.length);
    const step = (now: number) => {
      const at = (now - started) / duration;
      if (at >= 1) return finish();
      setFraction(at);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return finish;
    // Once per entry: the text changing ends it (below).
  }, [reveal]);
  // The entry changed (the message was replaced): what it says now shows in full.
  if (fraction < 1 && text !== first.current) return text;
  return fraction >= 1 ? text : revealedAt(revealUnits(text), fraction);
}
