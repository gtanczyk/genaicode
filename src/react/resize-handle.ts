/**
 * A resize handle for a panel edge: drag it, or focus it and use the keys. No React here, so a
 * page that builds its own DOM can use it as well as a component (through a ref).
 *
 * The handle owns no size. It asks `read()` for the current one and hands every change to
 * `write()`, which applies it (usually a CSS variable) and stores it when `commit` is true: at
 * the end of a drag and on every key press.
 */
export interface ResizeHandleOptions {
  /** 'x' for a width (a vertical edge), 'y' for a height (a horizontal edge). */
  axis: 'x' | 'y';
  /**
   * 1 when moving the pointer right (or down) makes the panel bigger, -1 when it makes it
   * smaller: a panel docked on the right that grows to the left is -1. Read when a drag or key
   * press starts, so it can follow the panel's current side. Default 1.
   */
  direction?: () => number;
  /** Smallest and largest size right now, e.g. from the window size. */
  bounds: () => readonly [min: number, max: number];
  /**
   * The size shown now. It must return what `write` or `reset` just set, synchronously: keep
   * the size in a variable or a ref, not only in React state that updates on the next render.
   */
  read: () => number;
  /** Apply `size` (already within bounds and rounded). `commit` is true when it should be kept. */
  write: (size: number, commit: boolean) => void;
  /** Back to the default size: double-click or Enter. Without it they do nothing. */
  reset?: () => void;
  /** Pixels per arrow key press; Shift doubles it. Default 24. */
  step?: number;
  /**
   * Element that gets `data-resizing="true"` and `data-resize-axis` during a drag, so the page
   * can set the cursor everywhere and turn off pointer events on iframes. Default: document.body.
   */
  root?: HTMLElement;
}

export interface ResizeHandle {
  /** Update the ARIA range after the bounds or the size changed from outside (window resize, dock). */
  sync(): void;
  /** Remove the listeners. */
  dispose(): void;
}

/**
 * Make `handle` resize a panel. Give it `role="separator"`, `tabindex="0"` and an
 * `aria-label`; this sets `aria-orientation` and `touch-action: none`, and keeps
 * `aria-valuemin`, `aria-valuemax` and `aria-valuenow` current.
 *
 * Pointer: drag (the pointer is captured, so it may leave the handle). Keys: arrows by `step`
 * (Shift: twice that), Home and End to the bounds, Escape during a drag to undo it, Enter (and
 * double-click) to reset.
 */
export function installResizeHandle(handle: HTMLElement, options: ResizeHandleOptions): ResizeHandle {
  const root = () => options.root ?? handle.ownerDocument.body;
  const direction = () => options.direction?.() ?? 1;
  const step = options.step ?? 24;
  // A window smaller than the minimum wins: the size never exceeds what fits, nor goes below 0.
  const range = (): [number, number] => {
    const [min, max] = options.bounds();
    const top = Math.max(0, max);
    return [Math.max(0, Math.min(min, top)), top];
  };
  const clamp = (size: number) => {
    const [min, max] = range();
    return Math.round(Math.max(min, Math.min(max, size)));
  };
  const sync = (now = options.read()) => {
    const [min, max] = range();
    handle.setAttribute('aria-valuemin', String(Math.round(min)));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
    handle.setAttribute('aria-valuenow', String(clamp(now)));
  };
  const write = (size: number, commit: boolean) => {
    const next = clamp(size);
    options.write(next, commit);
    sync(next);
    return next;
  };
  const along = (event: MouseEvent) => (options.axis === 'x' ? event.clientX : event.clientY);

  let drag: { pointer: number; start: number; size: number; direction: number; last: number } | undefined;
  const end = (commit = true) => {
    if (!drag) return;
    const { last } = drag;
    drag = undefined;
    delete root().dataset.resizing;
    delete root().dataset.resizeAxis;
    if (commit) write(last, true);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    const size = clamp(options.read());
    drag = { pointer: event.pointerId, start: along(event), size, direction: direction(), last: size };
    handle.setPointerCapture?.(event.pointerId);
    root().dataset.resizing = 'true';
    root().dataset.resizeAxis = options.axis;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.pointer)
      drag.last = write(drag.size + drag.direction * (along(event) - drag.start), false);
  };
  // Another finger lifting off the handle does not end this drag.
  const onPointerEnd = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.pointer) end();
  };
  const onBlur = () => end();
  const onDoubleClick = () => {
    end(false);
    options.reset?.();
    sync();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const [min, max] = range();
    const keys =
      options.axis === 'x' ? { less: 'ArrowLeft', more: 'ArrowRight' } : { less: 'ArrowUp', more: 'ArrowDown' };
    if (event.key === 'Escape' && drag) {
      const size = drag.size;
      end(false);
      write(size, true);
    } else if (event.key === 'Enter' && options.reset) onDoubleClick();
    else if (event.key === 'Home') write(min, true);
    else if (event.key === 'End') write(max, true);
    else if (event.key === keys.less || event.key === keys.more) {
      const delta = (event.key === keys.more ? 1 : -1) * direction() * (event.shiftKey ? 2 * step : step);
      write(clamp(options.read()) + delta, true);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const view = handle.ownerDocument.defaultView;
  // A width handle is a vertical bar; separators are horizontal unless they say otherwise.
  handle.setAttribute('aria-orientation', options.axis === 'x' ? 'vertical' : 'horizontal');
  // Otherwise a touch drag can turn into a page pan, which cancels the pointer.
  handle.style.touchAction = 'none';
  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerEnd);
  handle.addEventListener('pointercancel', onPointerEnd);
  handle.addEventListener('lostpointercapture', onPointerEnd);
  handle.addEventListener('dblclick', onDoubleClick);
  handle.addEventListener('keydown', onKeyDown);
  // Switching windows mid-drag may never deliver the pointerup.
  view?.addEventListener('blur', onBlur);
  sync();

  return {
    sync: () => sync(),
    dispose() {
      end();
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerEnd);
      handle.removeEventListener('pointercancel', onPointerEnd);
      handle.removeEventListener('lostpointercapture', onPointerEnd);
      handle.removeEventListener('dblclick', onDoubleClick);
      handle.removeEventListener('keydown', onKeyDown);
      view?.removeEventListener('blur', onBlur);
    },
  };
}

/** A size kept in `localStorage`. Every method works, and does nothing, when storage is blocked. */
export interface StoredSize {
  /** The saved size, clamped to the range given, or undefined when none (or nothing usable) is saved. */
  get(): number | undefined;
  set(size: number): void;
  clear(): void;
}

/** `localStorage` under `key`, for `installResizeHandle`'s `write` and `reset`. */
export function storedSize(key: string, [min, max]: readonly [number, number]): StoredSize {
  return {
    get() {
      try {
        const raw = localStorage.getItem(key);
        const value = raw === null ? NaN : Number(raw);
        return Number.isFinite(value) && value > 0 ? Math.min(max, Math.max(min, value)) : undefined;
      } catch {
        return undefined;
      }
    },
    set(size) {
      try {
        localStorage.setItem(key, String(size));
      } catch {
        // The size just isn't remembered.
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing was remembered.
      }
    },
  };
}
