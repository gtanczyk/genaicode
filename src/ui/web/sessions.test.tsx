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
  const reader = { ...asking, source: 'transcript-store' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/send')) {
        sent.push(url, JSON.parse(String(init?.body)).prompt);
        return new Response(JSON.stringify({ ok: true, text: 'Baking today.' }));
      }
      return new Response(JSON.stringify({ ...listing, sessions: [reader, asking], readable: [reader.source] }));
    }),
  );
  const onReplied = vi.fn();
  await act(async () =>
    root.render(<Sessions token="t" cwd="/work" onOpen={vi.fn()} onContinue={vi.fn()} onReplied={onReplied} />),
  );
  await vi.waitFor(() => expect(button('Open')).toBeTruthy());
  expect(button('Reply')).toBeUndefined();
  await act(async () => button('⋯').click());
  await act(async () => button('Reply').click());
  const field = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Bake today.');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(sent).toEqual(['/api/sessions/helper/bakery-1/send', 'Bake today.']);
  expect(onReplied).toHaveBeenCalledWith(reader);
});

it('opens the readable store once per session and shows the sources of distinct rows', async () => {
  const alias = { ...asking, source: 'index', cwd: undefined };
  const other = { ...asking, source: 'second', id: 'another-id' };
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify({ ...listing, sessions: [alias, other, asking], readable: ['helper'] })),
  );
  const onOpen = vi.fn();
  await act(async () => root.render(<Sessions token="t" cwd="/work" onOpen={onOpen} onContinue={vi.fn()} />));
  const rows = Array.from(host.querySelectorAll('.session-row'));
  expect(rows.map((row) => (row.querySelector('.label small') ?? row.querySelector('.agent'))?.textContent)).toEqual([
    'helper',
    'second',
  ]);
  await act(async () => rows[0]!.querySelector('button')!.click());
  expect(onOpen).toHaveBeenCalledWith(asking);
});

it('keeps an index-only topic on the readable row when grouping, filtering and showing directory tags', async () => {
  const alias = { ...asking, source: 'index' };
  const data = { ...listing, sessions: [asking, alias], readable: [asking.source],
    topics: [{id: 'bread', name: 'Bread'}], topicOf: { ['index:' + asking.id]: 'bread' } };
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(data)));
  await act(async () => root.render(<Sessions token="t" cwd="/work" topic="bread" onOpen={vi.fn()} onContinue={vi.fn()} />));
  expect(host.querySelectorAll('.session-row')).toHaveLength(1);
  expect(host.querySelector('.project summary b')?.textContent).toBe('Bread');
  const by = host.querySelector<HTMLSelectElement>('[aria-label="Group by"]')!;
  await act(async () => {
    by.value = 'project';
    by.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.querySelector('.session-row .topic-tag')?.textContent).toBe('Bread');
});

it('uses the readable transcript and keeps approvals and their commands from another store', async () => {
  const reader: SessionInfo = { ...asking, state: 'unfinished', ending: undefined };
  const approval: SessionInfo = {
    ...asking,
    source: 'index',
    waitingFor: 'approval',
    waitingTool: 'Bash',
    waitingCommands: [{ tool: 'Bash', command: 'npm test' }],
    updatedAt: reader.updatedAt + 1000,
  };
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          ...listing,
          sessions: [reader, approval],
          readable: [reader.source],
        }),
      ),
  );
  const onOpen = vi.fn();
  await act(async () =>
    root.render(<Sessions token="t" cwd="/work" initialState="approval" onOpen={onOpen} onContinue={vi.fn()} />),
  );
  expect(host.querySelectorAll('.session-row')).toHaveLength(1);
  expect(host.querySelector('.command-preview code')?.textContent).toBe('npm test');
  expect(button('1 needs you now · 1 ◆')).toBeTruthy();
  await act(async () => button('⋯').click());
  expect(button('Reply')).toBeUndefined();
  await act(async () => button('Open').click());
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ source: reader.source, waitingFor: 'approval', updatedAt: approval.updatedAt }),
  );
});

it('archives all store entries for the selected session and leaves a different project alone', async () => {
  const alias = { ...asking, source: 'index' };
  const separate = { ...asking, source: 'other', cwd: '/other/project' };
  const archives: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/archive') archives.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ...listing, sessions: [asking, alias, separate] }));
  });
  await act(async () => root.render(<Sessions token="t" cwd="/work" onOpen={vi.fn()} onContinue={vi.fn()} />));
  const bakery = Array.from(host.querySelectorAll('.project')).find((group) =>
    group.querySelector('summary')?.textContent?.includes('/work/bakery'),
  )!;
  await act(async () => bakery.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
  await act(async () => button('Archive').click());
  expect(archives).toEqual([{ sessions: [asking, alias].map(({ source, id }) => ({ source, id })), archived: true }]);
});
