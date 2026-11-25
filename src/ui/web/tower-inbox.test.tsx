// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TowerInboxPanel } from './tower-inbox.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('shows the last delivery and the unavailable stores with no item left, and the way to the sessions that ask', () => {
  const onOpen = vi.fn();
  const view = { items: [], unavailable: ['codex'], status: 'Sent the message to worker-store / catalog-release.' };
  act(() =>
    root.render(<TowerInboxPanel view={view} connected decide={async () => true} asking={{ count: 2, onOpen }} />),
  );
  expect(host.querySelector('h1')?.textContent).toBe('Tower inbox');
  expect(host.querySelector('[role="status"]')?.textContent).toBe(view.status);
  expect(host.querySelector('.errors')?.textContent).toBe('Unavailable stores · codex');
  expect(host.textContent).toContain('No pending items.');
  const link = host.querySelector('button')!;
  expect(link.textContent).toBe('2 more sessions ask for you');
  act(() => link.click());
  expect(onOpen).toHaveBeenCalledTimes(1);

  act(() =>
    root.render(<TowerInboxPanel view={view} connected decide={async () => true} asking={{ count: 0, onOpen }} />),
  );
  expect(host.querySelector('button')?.textContent).toBe('Sessions that ask for you');
  // No session index: nothing to go to.
  act(() => root.render(<TowerInboxPanel view={view} connected decide={async () => true} />));
  expect(host.querySelector('button')).toBeNull();
});
