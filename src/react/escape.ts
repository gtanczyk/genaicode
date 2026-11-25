import { createContext, useContext, useEffect, useRef } from 'react';

/** Takes an Escape press. `false`: not now (a resize drag undoes itself first), so the surface below is asked. */
export type EscapeHandler = (event: KeyboardEvent) => boolean | void;

const stack: Array<{ handle: EscapeHandler }> = [];
/** How many windows own the key outright (`ownEscape`). */
let owners = 0;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  for (let index = stack.length - 1; index >= 0; index--) {
    if (stack[index]!.handle(event) === false) continue;
    // One press closes one thing: nothing under it, and no message field, sees the key. In a host's
    // page that is as far as it goes: the host's own listeners on `window` still hear the key.
    if (owners) event.stopImmediatePropagation();
    else event.stopPropagation();
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
 * For a page that is all this app's (the `genaicode ui` window): until the returned function is
 * called, a claimed Escape reaches no other listener at all, also none on `window`. A component
 * in somebody else's page (`<AgentChat>` alone) never asks for this: there the key stops going
 * down the document, as it did before the surfaces shared a listener, and the host's own listeners
 * on `window` run.
 */
export function ownEscape(): () => void {
  owners += 1;
  let held = true;
  return () => {
    if (held) owners -= 1;
    held = false;
  };
}

/**
 * Whether the surfaces below may take Escape. `false` around a part of the page that is hidden (the
 * chat's workspace under another page): what is open there keeps its place, and is passed over until
 * it shows again.
 */
export const EscapeActive = createContext(true);

/**
 * `claimEscape` for a component: the claim lasts while `open`, and keeps its place among the open
 * surfaces when the component renders again with another `handle`. Under `EscapeActive` of `false`
 * it declines the key.
 */
export function useEscape(open: boolean, handle: EscapeHandler): void {
  const latest = useRef(handle);
  latest.current = handle;
  const active = useRef(true);
  active.current = useContext(EscapeActive);
  useEffect(() => {
    if (!open) return;
    return claimEscape((event) => (active.current ? latest.current(event) : false));
  }, [open]);
}
