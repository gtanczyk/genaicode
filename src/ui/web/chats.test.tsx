// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../agents/sessions/types.js';
import type { PendingAsk } from '../../agents/sessions/answer.js';
import type { TowerItem } from '../../agents/sessions/tower.js';
import { needsItems, needsSessions } from '../needs-you.js';
import { needsYou } from '../sidebar.js';
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

it('settles an own chat whose tower card was approved before every agent’s listing brought its questions', async () => {
  const now = Date.now();
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
  const card: TowerItem = {
    id: 'hook:bot-1',
    kind: 'approval',
    agent: 'codex',
    cwd: '/work/app',
    origin: 'Session bot',
    sessionId: 'bot',
    text: 'Bash\nnpm version',
  };
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
  // The latest request of a listing: earlier ones are no longer read.
  const land = async (own: boolean, listing: WebSessionListing) => {
    const at = pending.findLastIndex((one) => one.url.includes('own=1') === own);
    const [one] = pending.splice(at, 1);
    await act(async () => one!.land(listing));
  };
  let chats!: Chats;
  function Probe() {
    chats = useChats('t', true, 'stamp');
    return null;
  }
  act(() => root.render(<Probe />));
  // Only the app's own listing has arrived: the tower's card is what asks.
  await land(true, { sessions: [bot], errors: [] });
  const queue = (tower: TowerItem[]) =>
    needsItems({ tower, sessions: chats.all, own: chats.own, asks: chats.asks, now });
  expect(queue([card])).toHaveLength(1);

  // Approved from the card; the tower no longer holds it.
  act(() => chats.answered('bot-1', { agent: card.agent, session: card.sessionId! }));
  expect(queue([])).toEqual([]);
  expect(needsYou({ approvals: 0, tower: [], sessions: needsSessions(chats.all, chats.own), now }).total).toBe(0);
  // Every agent's listing arrives, the question already closed; the own one is still on its way.
  await land(false, { sessions: [], asks: [], errors: [] });
  expect(queue([])).toEqual([]);
  expect(needsYou({ approvals: 0, tower: [], sessions: needsSessions(chats.all, chats.own), now }).total).toBe(0);
});

it('says which listing could not be read, and which stores, until it is read again', async () => {
  const answers: Array<(res: Response) => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => void answers.push(resolve))),
  );
  let chats!: Chats;
  function Probe() {
    chats = useChats('t', true, 'stamp');
    return null;
  }
  act(() => root.render(<Probe />));
  const [own, all] = answers.splice(0);
  await act(async () => own!(new Response(JSON.stringify({ sessions: [], errors: [] }))));
  await act(async () => all!(new Response('{}', { status: 500 })));
  expect(chats.failed).toEqual(['every agent’s sessions: The server answered 500.']);
  expect(chats.errors).toEqual([]);

  act(() => chats.refresh());
  const [, again] = answers.splice(0);
  await act(async () =>
    again!(new Response(JSON.stringify({ sessions: [], errors: [{ source: 'codex', message: 'locked' }] }))),
  );
  expect(chats.failed).toEqual([]);
  expect(chats.errors).toEqual([{ source: 'codex', message: 'locked' }]);
});
