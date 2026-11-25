// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../agents/sessions/types.js';
import { needsItems, type NeedsDecision, type NeedsItem } from '../needs-you.js';
import { needsYou } from '../sidebar.js';
import { NeedsYouPage, type NeedsYouPageProps } from './needs-you.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.parse('2026-11-25T10:00:00Z');
const gate: SessionInfo = {
  source: 'claude',
  agent: 'claude',
  id: 'gate',
  where: 'local',
  cwd: '/work/site',
  title: 'Gate verdict retries',
  state: 'waiting',
  ending: 'question',
  lastReply: 'Retry on 502 too?',
  updatedAt: now - 40 * 60_000,
};
const sources = {
  tower: [
    {
      id: 'draft-1',
      kind: 'proposal' as const,
      agent: 'codex',
      cwd: '/work/lib',
      origin: 'codex / flaky',
      text: 'Go on.',
    },
    {
      id: 'hook:abc',
      kind: 'approval' as const,
      agent: 'codex',
      cwd: '/work/lib',
      origin: 'Session s1',
      text: 'Bash\nnpm test',
    },
  ],
  sessions: [gate],
  open: { id: 'open', source: 'claude' },
  now,
};
const items = needsItems({
  chat: {
    approvals: [{ id: 'req-1', kind: 'command', summary: 'rm -rf dist' }],
    agent: 'claude',
    cwd: '/work/app',
    title: 'Ship the layout',
    ...sources.open,
  },
  tower: sources.tower,
  sessions: sources.sessions,
  own: [gate],
  senders: [{ agent: 'claude', source: 'claude', sandboxes: ['read-only'] }],
  seen: new Map([['chat:req-1', now - 2 * 60_000]]),
  now,
});

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

function props(patch: Partial<NeedsYouPageProps> = {}): NeedsYouPageProps {
  return {
    items,
    chatTitle: 'Ship the layout',
    connected: true,
    token: 't',
    decide: vi.fn(async () => true),
    onOpen: vi.fn(),
    onReplied: vi.fn(),
    now,
    ...patch,
  };
}
const render = (value: NeedsYouPageProps) => act(() => root.render(<NeedsYouPage {...value} />));
const cards = () => Array.from(host.querySelectorAll('article'));
const card = (text: string) => cards().find((one) => one.textContent?.includes(text))!;
const button = (within: Element, name: string) =>
  Array.from(within.querySelectorAll('button')).find((one) => one.textContent?.trim() === name)!;
const click = (element: Element) => act(async () => (element as HTMLElement).click());

it('lists as many items as the sidebar counts, each with its project, agent, origin and age', () => {
  render(props());
  const total = needsYou({ approvals: 1, ...sources }).total;
  expect(cards()).toHaveLength(total);
  expect(host.querySelector('.pill')?.textContent).toBe(`${total} open`);
  expect(host.querySelector('h2')?.textContent).toBe('Needs you');
  const here = card('rm -rf dist');
  expect(here.querySelector('.needs-meta b')?.textContent).toBe('Run a command');
  expect(Array.from(here.querySelectorAll('.tag'), (tag) => tag.textContent)).toEqual(['app', 'claude']);
  expect(here.querySelector('.tag')?.getAttribute('title')).toBe('/work/app');
  expect(here.querySelector('.needs-origin')?.textContent).toBe('this chat “Ship the layout” · 2m ago');
  expect(here.querySelector('pre')?.textContent).toBe('rm -rf dist');
  const asked = card('Gate verdict retries');
  expect(asked.querySelector('.needs-text')?.textContent).toBe('“Retry on 502 too?”');
  expect(asked.querySelector('time')?.textContent).toBe('40m ago');
  // The tower's proposal has no time of its own, and none was seen.
  expect(card('Go on.').querySelector('time')).toBeNull();
});

it('has the actions of each source, and sends each answer where it belongs', async () => {
  const decide = vi.fn(async (decision: NeedsDecision) => !!decision);
  const onOpen = vi.fn();
  render(props({ decide, onOpen }));
  const names = (within: Element) => Array.from(within.querySelectorAll('button'), (one) => one.textContent?.trim());
  expect(names(card('rm -rf dist'))).toEqual(['Approve', 'Deny', 'Open chat']);
  expect(names(card('Go on.'))).toEqual(['Send to session', 'Dismiss', 'Browse waiting sessions']);
  expect(names(card('npm test'))).toEqual(['Approve once', 'Deny', 'Browse waiting sessions']);
  expect(names(card('Gate verdict retries'))).toEqual(['Reply', 'Open chat']);
  expect(button(card('rm -rf dist'), 'Approve').className).toContain('primary');
  expect(button(card('rm -rf dist'), 'Deny').className).not.toContain('primary');

  await click(button(card('rm -rf dist'), 'Deny'));
  await click(button(card('npm test'), 'Approve once'));
  await click(button(card('Go on.'), 'Dismiss'));
  expect(decide.mock.calls.map(([decision]) => decision)).toEqual([
    { via: 'chat', id: 'req-1', decision: 'deny' },
    { via: 'tower', id: 'hook:abc', decision: 'approve' },
    { via: 'tower', id: 'draft-1', decision: 'dismiss' },
  ]);
  await click(button(card('Gate verdict retries'), 'Open chat'));
  expect((onOpen.mock.calls[0]![0] as NeedsItem).open).toEqual({ to: 'own', session: gate });
  // No list of sessions in this window: nowhere to open the session.
  render(props({ sessionsPage: false }));
  expect(names(card('Go on.'))).toEqual(['Send to session', 'Dismiss']);
});

it('says when an answer came too late or could not be given, and holds answers while disconnected', async () => {
  const decide = vi.fn(async () => false);
  render(props({ decide }));
  await click(button(card('rm -rf dist'), 'Approve'));
  expect(host.querySelector('[role="status"]')?.textContent).toBe('This item is no longer open.');
  decide.mockRejectedValueOnce(new Error('offline'));
  await click(button(card('rm -rf dist'), 'Approve'));
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Could not apply this decision.');
  render(props({ connected: false }));
  expect(button(card('rm -rf dist'), 'Approve').disabled).toBe(true);
  expect(button(card('rm -rf dist'), 'Open chat').disabled).toBe(false);
});

it('replies to a session in place', async () => {
  const fetched = vi.fn(async () => new Response(JSON.stringify({ ok: true, text: 'On it.' })));
  vi.stubGlobal('fetch', fetched);
  const onReplied = vi.fn();
  render(props({ onReplied }));
  await click(button(card('Gate verdict retries'), 'Reply'));
  const field = card('Gate verdict retries').querySelector('textarea')!;
  expect(field.getAttribute('aria-label')).toBe('Message to claude');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'On 502 too.');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    card('Gate verdict retries')
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(fetched).toHaveBeenCalledTimes(1);
  const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/sessions/claude/gate/send');
  expect(JSON.parse(String(init.body))).toEqual({ prompt: 'On 502 too.' });
  expect(onReplied).toHaveBeenCalledWith(gate, 'On it.');
  expect(card('Gate verdict retries').querySelector('textarea')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Sent to claude, chat “Gate verdict retries”.');
});

it('filters the queue, with a count on every filter', async () => {
  render(props());
  const chips = () => Array.from(host.querySelectorAll('.chipf'));
  expect(chips().map((chip) => chip.textContent)).toEqual([
    'All 4',
    'Ship the layout 1',
    'This app’s chats 1',
    'Tower: other agents’ sessions 2',
    'Approvals 3',
    'Questions 1',
  ]);
  expect(chips()[0]!.getAttribute('aria-pressed')).toBe('true');
  await click(chips()[3]!);
  expect(chips()[3]!.getAttribute('aria-pressed')).toBe('true');
  expect(cards().map((one) => one.dataset.source)).toEqual(['tower', 'tower']);
  await click(chips()[5]!);
  expect(cards()).toHaveLength(1);
  // The last item under a filter was answered: the filter stays, and says it is empty.
  render(props({ items: items.filter((item) => item.kind !== 'question') }));
  expect(cards()).toHaveLength(0);
  expect(host.textContent).toContain('Nothing waits here.');
});

it('says so when nothing needs the person, and keeps what the tower last did', () => {
  render(props({ items: [], tower: { status: 'Message sent to codex / flaky.', unavailable: ['gemini'] } }));
  expect(cards()).toHaveLength(0);
  expect(host.querySelector('.needs-empty b')?.textContent).toBe('Nothing needs you now');
  expect(host.querySelector('.pill')).toBeNull();
  expect(host.querySelector('.chipf')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Message sent to codex / flaky.');
  expect(host.querySelector('.errors')?.textContent).toBe('Unavailable stores · gemini');
});

it('says the queue could not be read, and which stores, in place of saying nothing waits', () => {
  render(props({ items: [], unread: { failed: ['every agent’s sessions: The server answered 500.'], errors: [] } }));
  expect(host.querySelector('.needs-empty')).toBeNull();
  expect(host.textContent).toContain('Could not read the queue: every agent’s sessions: The server answered 500.');
  render(props({ items: [], unread: { failed: [], errors: [{ source: 'codex', message: 'locked' }] } }));
  expect(host.querySelector('.needs-empty')).toBeNull();
  expect(host.textContent).toContain('Could not read codex: locked');
  render(props({ items: [], unread: { failed: [], errors: [] } }));
  expect(host.querySelector('.needs-empty b')?.textContent).toBe('Nothing needs you now');
});

it('says the queue could not be read, not that a filter is empty, while a listing failed', async () => {
  render(props());
  const chips = () => Array.from(host.querySelectorAll('.chipf'));
  await click(chips()[5]!);
  render(
    props({
      items: items.filter((item) => item.kind !== 'question'),
      unread: { failed: [], errors: [{ source: 'codex', message: 'locked' }] },
    }),
  );
  expect(cards()).toHaveLength(0);
  expect(host.textContent).not.toContain('Nothing waits here.');
  expect(host.textContent).toContain('Could not read codex: locked');
});

it('gives the next question of a session a card of its own: a button of the last one does not answer it', async () => {
  const hooked: SessionInfo = { ...gate, id: 'hooked', title: 'Ship it', ending: undefined, waitingFor: 'approval' };
  const ask = { id: 'abc', agent: 'claude', session: 'hooked', tool: 'Bash', preview: 'npm publish', at: now, pid: 1 };
  const queue = (pending: (typeof ask)[]) =>
    needsItems({ sessions: [hooked], asks: pending, now }).filter((one) => one.key.startsWith('session:'));
  const decide = vi.fn(async () => true);
  render(props({ items: queue([ask]), decide }));
  const first = button(card('Ship it'), 'Approve');
  first.focus();
  // The question expired, and the session asks the next one.
  render(props({ items: queue([{ ...ask, id: 'def', preview: 'npm version patch' }]), decide }));
  const next = button(card('Ship it'), 'Approve');
  expect(next).not.toBe(first);
  expect(first.isConnected).toBe(false);
  expect(document.activeElement).not.toBe(next);
  await click(next);
  expect(decide).toHaveBeenCalledWith({ via: 'ask', id: 'def', behavior: 'allow' });
});

it('keeps the reply being written to one session when a reply to another lands', async () => {
  const other: SessionInfo = { ...gate, id: 'bakery', title: 'Sourdough schedule', lastReply: 'Bake today?' };
  const two = needsItems({
    sessions: [gate, other],
    own: [gate, other],
    senders: [{ agent: 'claude', source: 'claude', sandboxes: [] }],
    now,
  });
  let land!: (res: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => (land = resolve))),
  );
  const onReplied = vi.fn();
  render(props({ items: two, onReplied }));
  const type = async (within: Element, text: string) => {
    const field = within.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  // A reply to the first session goes out, and does not land yet.
  await click(button(card('Gate verdict retries'), 'Reply'));
  await type(card('Gate verdict retries'), 'On 502 too.');
  await act(async () => {
    card('Gate verdict retries')
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  // Meanwhile a reply to the other is being written.
  await click(button(card('Sourdough schedule'), 'Reply'));
  await type(card('Sourdough schedule'), 'Wait until Friday.');
  await act(async () => land(new Response(JSON.stringify({ ok: true, text: 'On it.' }))));
  expect(onReplied).toHaveBeenCalledWith(gate, 'On it.');
  expect(card('Sourdough schedule').querySelector('textarea')?.value).toBe('Wait until Friday.');
});

it('says what the tower last did also after a reply was sent from here', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true, text: 'On it.' }))),
  );
  const tower = { status: 'Message sent to codex / flaky.', unavailable: [] };
  render(props({ tower }));
  await click(button(card('Gate verdict retries'), 'Reply'));
  const field = card('Gate verdict retries').querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'On 502 too.');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    card('Gate verdict retries')
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const status = () => host.querySelector('[role="status"]')?.textContent;
  expect(status()).toBe('Sent to claude, chat “Gate verdict retries”. · Message sent to codex / flaky.');
  // A delivery of the tower fails later: that is read too, beside the reply's word.
  render(props({ tower: { status: 'Could not send the message to codex / flaky.', unavailable: [] } }));
  expect(status()).toContain('Sent to claude');
  expect(host.querySelector('[data-from="tower"]')?.textContent).toBe('Could not send the message to codex / flaky.');
});

it('keeps an unsent reply when a filter hides its card for a while', async () => {
  render(props());
  const chips = () => Array.from(host.querySelectorAll('.chipf'));
  await click(button(card('Gate verdict retries'), 'Reply'));
  const field = () => card('Gate verdict retries').querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), 'On 502 too.');
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Approvals only: the question's card goes, and comes back under All with what was typed.
  await click(chips()[4]!);
  expect(cards().some((one) => one.textContent?.includes('Gate verdict retries'))).toBe(false);
  await click(chips()[0]!);
  expect(field().value).toBe('On 502 too.');
  // Cancel drops it: the next reply starts empty.
  await click(button(card('Gate verdict retries'), 'Cancel'));
  await click(button(card('Gate verdict retries'), 'Reply'));
  expect(field().value).toBe('');
});

it('keeps the editor of a reply on its way closed to edits when a filter hides its card for a while', async () => {
  let land!: (res: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => (land = resolve))),
  );
  const onReplied = vi.fn();
  render(props({ onReplied }));
  const chips = () => Array.from(host.querySelectorAll('.chipf'));
  const field = () => card('Gate verdict retries').querySelector('textarea')!;
  const type = (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), text);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
  await click(button(card('Gate verdict retries'), 'Reply'));
  await type('On 502 too.');
  await act(async () => {
    card('Gate verdict retries')
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(field().disabled).toBe(true);
  // Away and back while the reply is on its way: the editor still takes no edits.
  await click(chips()[4]!);
  await click(chips()[0]!);
  expect(field().value).toBe('On 502 too.');
  expect(field().disabled).toBe(true);
  expect(button(card('Gate verdict retries'), 'Sending…').disabled).toBe(true);
  // It lands: the reply is done, and nothing typed meanwhile was lost.
  await act(async () => land(new Response(JSON.stringify({ ok: true, text: 'On it.' }))));
  expect(onReplied).toHaveBeenCalledWith(gate, 'On it.');
  expect(card('Gate verdict retries').querySelector('textarea')).toBeNull();
});

it('gives the draft back, open to edits and with the error, when a reply hidden by a filter could not be sent', async () => {
  let land!: (res: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => (land = resolve))),
  );
  render(props());
  const chips = () => Array.from(host.querySelectorAll('.chipf'));
  const field = () => card('Gate verdict retries').querySelector('textarea')!;
  await click(button(card('Gate verdict retries'), 'Reply'));
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), 'On 502 too.');
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    card('Gate verdict retries')
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await click(chips()[4]!);
  await act(async () => land(new Response(JSON.stringify({ ok: false, error: 'Busy.' }), { status: 500 })));
  await click(chips()[0]!);
  expect(field().value).toBe('On 502 too.');
  expect(field().disabled).toBe(false);
  expect(card('Gate verdict retries').querySelector('[role="alert"]')?.textContent).toBe(
    'Busy. Delivery to this session is unconfirmed.',
  );
});
