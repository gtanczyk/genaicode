// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { claimEscape } from './escape.js';

const press = (key = 'Escape') => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
};

const release: Array<() => void> = [];
const claim = (handle: Parameters<typeof claimEscape>[0]) => {
  const off = claimEscape(handle);
  release.push(off);
  return off;
};
afterEach(() => {
  for (const off of release.splice(0)) off();
});

it('gives one press to the surface opened last, and to nothing else', () => {
  const viewer = vi.fn();
  const menu = vi.fn();
  // What a surface with a listener of its own would see: nothing, while a claim takes the key.
  const other = vi.fn();
  const page = vi.fn();
  window.addEventListener('keydown', page);
  try {
    claim(viewer);
    window.addEventListener('keydown', other, true);
    const closeMenu = claim(menu);
    const first = press();
    expect([menu.mock.calls.length, viewer.mock.calls.length]).toEqual([1, 0]);
    expect(first.defaultPrevented).toBe(true);
    expect(other).not.toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();

    closeMenu();
    press();
    expect([menu.mock.calls.length, viewer.mock.calls.length]).toEqual([1, 1]);

    // Other keys are nobody's business here.
    expect(press('a').defaultPrevented).toBe(false);
    expect(other).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener('keydown', other, true);
    window.removeEventListener('keydown', page);
  }
});

it('asks the surface below when the top one declines, and lets the key through when all do', () => {
  const below = vi.fn();
  claim(below);
  const top = claim(() => false);
  expect(press().defaultPrevented).toBe(true);
  expect(below).toHaveBeenCalledTimes(1);
  top();
  release.splice(0).forEach((off) => off());
  claim(() => false);
  expect(press().defaultPrevented).toBe(false);
});

it('listens only while something is open', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const a = claimEscape(() => undefined);
  const b = claimEscape(() => undefined);
  expect(add).toHaveBeenCalledTimes(1);
  a();
  expect(remove).not.toHaveBeenCalled();
  b();
  b();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(press().defaultPrevented).toBe(false);
  add.mockRestore();
  remove.mockRestore();
});
