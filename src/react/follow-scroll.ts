import { useCallback, useEffect, useLayoutEffect, useRef, type Ref, type UIEventHandler } from 'react';

// No layout effects on the server (React 18 warns about them there).
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Keep a scrolling log at its newest line: it follows while the user is at the bottom (within
 * `slack` pixels) and stays put once they scroll up to read. It also re-pins when the box itself
 * changes size, e.g. when a hidden panel is shown again or resized.
 *
 * ```tsx
 * const { ref, onScroll } = useFollowScroll(lines);
 * <div ref={ref} onScroll={onScroll} style={{ overflow: 'auto' }}>{...}</div>
 * ```
 *
 * `content` is compared by identity: the log scrolls after a render where it changed.
 */
export function useFollowScroll<T extends HTMLElement = HTMLDivElement>(
  content: unknown,
  slack = 30,
): { ref: Ref<T>; onScroll: UIEventHandler<T>; follow: () => void } {
  const ref = useRef<T>(null);
  const following = useRef(true);
  const pin = useCallback(() => {
    const el = ref.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, []);
  useIsomorphicLayoutEffect(pin, [content, pin]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(pin);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pin]);
  const onScroll: UIEventHandler<T> = useCallback(() => {
    const el = ref.current;
    // A hidden box (no height) says nothing about where the user is.
    if (el && el.clientHeight) following.current = el.scrollTop + el.clientHeight >= el.scrollHeight - slack;
  }, [slack]);
  /** Follow again from now on, e.g. after the user sent a message. */
  const follow = useCallback(() => {
    following.current = true;
    pin();
  }, [pin]);
  // `Ref<T>` rather than the object type, which differs between React 18 and 19 typings.
  return { ref, onScroll, follow };
}
