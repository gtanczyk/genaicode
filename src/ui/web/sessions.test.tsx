// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../agents/sessions/types.js';
import type { WebSessionListing } from './server.js';
import { Sessions } from './sessions.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asking: SessionInfo = {
  source: 'helper',
  agent: 'helper',
  id: 'bakery-1',
  where: 'local',
  cwd: '/work/bakery',
  title: 'Sourdough schedule',
  state: 'waiting',
  ending: 'question',
  lastReply: 'Bake today or wait until Friday?',
  updatedAt: Date.now() - 40 * 60_000,
};
const listing: WebSessionListing = {
  sessions: [asking],
  errors: [],
  senders: [{ agent: 'helper', source: 'helper', sandboxes: [] }],
};

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
  vi.unstubAllGlobals();
});

const button = (name: string) =>
  Array.from(host.querySelectorAll('button')).find((one) => one.textContent?.trim() === name)!;

it('tells the window when a reply went to a session, so its other lists stop offering one', async () => {
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/send')) {
        sent.push(JSON.parse(String(init?.body)).prompt);
        return new Response(JSON.stringify({ ok: true, text: 'Baking today.' }));
      }
      return new Response(JSON.stringify(listing));
    }),
  );
  const onReplied = vi.fn();
  await act(async () => root.render(<Sessions token="t" cwd="/work" onContinue={vi.fn()} onReplied={onReplied} />));
  await vi.waitFor(() => expect(button('Reply')).toBeTruthy());
  await act(async () => button('Reply').click());
  const field = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Bake today.');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(sent).toEqual(['Bake today.']);
  expect(onReplied).toHaveBeenCalledWith(asking);
});
