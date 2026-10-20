// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useFollowScroll } from '../react.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

let follow: () => void = () => {};
function Log({ lines }: { lines: string[] }) {
  const scroll = useFollowScroll(lines);
  follow = scroll.follow;
  return (
    <div ref={scroll.ref} onScroll={scroll.onScroll} className="log">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}

/** happy-dom has no layout: give the box fixed metrics that grow with its lines. */
function box() {
  const el = host.querySelector<HTMLDivElement>('.log')!;
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => el.children.length * 50 });
  return el;
}

it('follows new lines while at the bottom and stays put once scrolled up', () => {
  act(() => root.render(<Log lines={['a']} />));
  const el = box();
  act(() => root.render(<Log lines={['a', 'b', 'c', 'd']} />));
  expect(el.scrollTop).toBe(200);

  el.scrollTop = 0;
  act(() => el.dispatchEvent(new Event('scroll')));
  act(() => root.render(<Log lines={['a', 'b', 'c', 'd', 'e']} />));
  expect(el.scrollTop).toBe(0);

  act(() => follow());
  expect(el.scrollTop).toBe(250);
  act(() => root.render(<Log lines={['a', 'b', 'c', 'd', 'e', 'f']} />));
  expect(el.scrollTop).toBe(300);
});

it('keeps following while hidden (no height)', () => {
  act(() => root.render(<Log lines={['a', 'b', 'c']} />));
  const el = box();
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 0 });
  el.scrollTop = 0;
  act(() => el.dispatchEvent(new Event('scroll')));
  act(() => root.render(<Log lines={['a', 'b', 'c', 'd']} />));
  expect(el.scrollTop).toBe(200);
});

function Late({ show, lines }: { show: boolean; lines: string[] }) {
  const scroll = useFollowScroll(lines);
  return show ? (
    <div ref={scroll.ref} onScroll={scroll.onScroll} className="log">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  ) : null;
}

it('observes a box that mounts after the first render', () => {
  const observed: Element[] = [];
  const Original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    act(() => root.render(<Late show={false} lines={['a']} />));
    expect(observed).toHaveLength(0);
    act(() => root.render(<Late show lines={['a']} />));
    expect(observed).toEqual([host.querySelector('.log')]);
  } finally {
    globalThis.ResizeObserver = Original;
  }
});
