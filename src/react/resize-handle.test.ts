// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { installResizeHandle, storedSize, type ResizeHandleOptions } from '../react.js';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

function fixture(options: Partial<ResizeHandleOptions> = {}) {
  const handle = document.createElement('div');
  handle.tabIndex = 0;
  document.body.append(handle);
  let size: number | undefined;
  const writes: Array<[number, boolean]> = [];
  const resizer = installResizeHandle(handle, {
    axis: 'x',
    direction: () => -1,
    bounds: () => [300, 900],
    read: () => size ?? 400,
    write: (value, commit) => {
      size = value;
      writes.push([value, commit]);
    },
    reset: () => (size = undefined),
    ...options,
  });
  const pointer = (type: string, clientX: number, clientY = 0) =>
    handle.dispatchEvent(new PointerEvent(type, { clientX, clientY, button: 0, pointerId: 1, bubbles: true }));
  const key = (name: string, shiftKey = false) =>
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
  return { handle, resizer, pointer, key, writes, size: () => size };
}

describe('installResizeHandle', () => {
  it('publishes the ARIA range and the current size', () => {
    const { handle } = fixture();
    expect(handle.getAttribute('aria-valuemin')).toBe('300');
    expect(handle.getAttribute('aria-valuemax')).toBe('900');
    expect(handle.getAttribute('aria-valuenow')).toBe('400');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.style.touchAction).toBe('none');
  });

  it('keeps a drag going when another pointer lifts', () => {
    const { handle, pointer, size } = fixture();
    pointer('pointerdown', 600);
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, pointerId: 2, bubbles: true }));
    expect(document.body.dataset.resizing).toBe('true');
    pointer('pointermove', 550);
    expect(size()).toBe(450);
    pointer('pointerup', 550);
    expect(document.body.dataset.resizing).toBeUndefined();
  });

  it('drags in the panel direction, clamps, and commits once at the end', () => {
    const { pointer, writes, size, handle } = fixture();
    pointer('pointerdown', 600);
    expect(document.body.dataset.resizing).toBe('true');
    expect(document.body.dataset.resizeAxis).toBe('x');
    pointer('pointermove', 500);
    expect(size()).toBe(500);
    pointer('pointermove', -2000);
    expect(size()).toBe(900);
    pointer('pointerup', -2000);
    expect(document.body.dataset.resizing).toBeUndefined();
    expect(writes.filter(([, commit]) => commit)).toEqual([[900, true]]);
    expect(handle.getAttribute('aria-valuenow')).toBe('900');
  });

  it('follows the y axis and a positive direction', () => {
    const { handle, pointer, size } = fixture({ axis: 'y', direction: () => 1, bounds: () => [64, 500] });
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    pointer('pointerdown', 0, 100);
    pointer('pointermove', 0, 150);
    pointer('pointerup', 0, 150);
    expect(size()).toBe(450);
  });

  it('ignores moves when no drag is active and other buttons', () => {
    const { handle, pointer, size } = fixture();
    pointer('pointermove', 100);
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, button: 2, bubbles: true }));
    pointer('pointermove', 0);
    expect(size()).toBeUndefined();
  });

  it('steps with the arrow keys, doubles with Shift, jumps with Home and End', () => {
    const { key, size } = fixture();
    key('ArrowLeft');
    expect(size()).toBe(424);
    key('ArrowRight', true);
    expect(size()).toBe(376);
    key('End');
    expect(size()).toBe(900);
    key('Home');
    expect(size()).toBe(300);
  });

  it('undoes a drag with Escape', () => {
    const { pointer, key, size } = fixture();
    pointer('pointerdown', 600);
    pointer('pointermove', 400);
    expect(size()).toBe(600);
    key('Escape');
    expect(size()).toBe(400);
    expect(document.body.dataset.resizing).toBeUndefined();
  });

  it('resets on double-click and on Enter', () => {
    const { handle, key, size } = fixture();
    key('ArrowLeft');
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(size()).toBeUndefined();
    expect(handle.getAttribute('aria-valuenow')).toBe('400');
    key('ArrowLeft');
    key('Enter');
    expect(size()).toBeUndefined();
  });

  it('never goes past what fits when the window is smaller than the minimum', () => {
    const { handle, key, size } = fixture({ bounds: () => [300, 200] });
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(handle.getAttribute('aria-valuenow')).toBe('200');
    key('Home');
    expect(size()).toBe(200);
  });

  it('stops listening after dispose', () => {
    const { resizer, key, size } = fixture();
    resizer.dispose();
    key('ArrowLeft');
    expect(size()).toBeUndefined();
  });

  it('marks a custom root during a drag', () => {
    const root = document.createElement('section');
    document.body.append(root);
    const { pointer } = fixture({ root });
    pointer('pointerdown', 10);
    expect(root.dataset.resizing).toBe('true');
    expect(document.body.dataset.resizing).toBeUndefined();
    pointer('pointerup', 10);
    expect(root.dataset.resizing).toBeUndefined();
  });
});

describe('storedSize', () => {
  it('reads back a clamped size and ignores junk', () => {
    const stored = storedSize('panel', [300, 900]);
    expect(stored.get()).toBeUndefined();
    stored.set(5000);
    expect(stored.get()).toBe(900);
    localStorage.setItem('panel', 'wide');
    expect(stored.get()).toBeUndefined();
    localStorage.setItem('panel', '0');
    expect(stored.get()).toBeUndefined();
    stored.set(420);
    expect(stored.get()).toBe(420);
    stored.clear();
    expect(localStorage.getItem('panel')).toBeNull();
  });
});

describe('installResizeHandle with a writer that applies later', () => {
  it('publishes and commits the size it wrote, not the stale read', () => {
    const handle = document.createElement('div');
    document.body.append(handle);
    const applied = 400;
    const commits: number[] = [];
    installResizeHandle(handle, {
      axis: 'x',
      bounds: () => [300, 900],
      // Like a React state setter: read() catches up only after a render.
      read: () => applied,
      write: (size, commit) => {
        if (commit) commits.push(size);
      },
    });
    const pointer = (type: string, clientX: number) =>
      handle.dispatchEvent(new PointerEvent(type, { clientX, button: 0, pointerId: 1, bubbles: true }));
    pointer('pointerdown', 100);
    pointer('pointermove', 200);
    expect(handle.getAttribute('aria-valuenow')).toBe('500');
    pointer('pointerup', 200);
    expect(commits).toEqual([500]);
  });
});
