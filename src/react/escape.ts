import { useEffect, useRef } from 'react';

/** Takes an Escape press. `false`: not now (a resize drag undoes itself first), so the surface below is asked. */
export type EscapeHandler = (event: KeyboardEvent) => boolean | void;

const stack: Array<{ handle: EscapeHandler }> = [];

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  for (let index = stack.length - 1; index >= 0; index--) {
    if (stack[index]!.handle(event) === false) continue;
    // One press closes one thing: nothing under it, and no message field, sees the key.
    event.stopImmediatePropagation();
    event.preventDefault();
    return;
  }
}

/**
 * Claims Escape for a surface that is open (a menu, a popover, a viewer) until the returned function
 * is called. The surface opened last owns the key: one press closes it and nothing below it. Every
 * surface shares one listener, because listeners of their own on `window` cannot stop one another.
 */
export function claimEscape(handle: EscapeHandler): () => void {
  const entry = { handle };
  if (!stack.length) window.addEventListener('keydown', onKeyDown, true);
  stack.push(entry);
  return () => {
    const index = stack.indexOf(entry);
    if (index < 0) return;
    stack.splice(index, 1);
    if (!stack.length) window.removeEventListener('keydown', onKeyDown, true);
  };
}

/**
 * `claimEscape` for a component: the claim lasts while `open`, and keeps its place among the open
 * surfaces when the component renders again with another `handle`.
 */
export function useEscape(open: boolean, handle: EscapeHandler): void {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    if (!open) return;
    return claimEscape((event) => latest.current(event));
  }, [open]);
}
