// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../agents/sessions/types.js';
import type { PendingAsk } from '../../agents/sessions/answer.js';
import { needsItems } from '../needs-you.js';
import { useChats, type Chats } from './chats.js';
import type { WebSessionListing } from './server.js';

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
  vi.unstubAllGlobals();
});

it('keeps an own chat answered from here settled when every agent’s listing is read again before its own', async () => {
  const now = Date.now();
  // An automated Codex chat of this app: only the app's own listing has it, and its hook asks.
  const bot: SessionInfo = {
    source: 'codex',
    agent: 'codex',
    id: 'bot',
    where: 'local',
    cwd: '/work/app',
    title: 'Nightly bump',
    state: 'waiting',
    waitingFor: 'approval',
    updatedAt: now - 60_000,
  };
  const ask = { id: 'bot-1', agent: 'codex', session: 'bot', tool: 'Bash', preview: 'npm version', at: now, pid: 1 };
  // Each listing answers when the test says so.
  const pending: Array<{ url: string; land(listing: WebSessionListing): void }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) =>
          pending.push({ url, land: (listing) => resolve(new Response(JSON.stringify(listing))) }),
        ),
    ),
  );
  const land = async (own: boolean, listing: WebSessionListing) => {
    const at = pending.findIndex((one) => one.url.includes('own=1') === own);
    const [one] = pending.splice(at, 1);
    await act(async () => one!.land(listing));
  };
  let chats!: Chats;
  function Probe() {
    chats = useChats('t', true, 'stamp');
    return null;
  }
  act(() => root.render(<Probe />));
  await land(true, { sessions: [bot], errors: [] });
  await land(false, { sessions: [], asks: [ask as PendingAsk], errors: [] });
  const queue = () => needsItems({ sessions: chats.all, own: chats.own, asks: chats.asks, now });
  expect(queue()).toHaveLength(1);

  // Answered from here: both listings are asked again.
  act(() => chats.answered('bot-1'));
  expect(queue()).toEqual([]);
  // Every agent's listing comes back first, without the question; the own one is still on its way.
  await land(false, { sessions: [], asks: [], errors: [] });
  expect(chats.own[0]).toMatchObject({ state: 'active', waitingFor: undefined });
  expect(queue()).toEqual([]);
});
