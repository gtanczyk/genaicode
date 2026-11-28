// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../agents/sessions/types.js';
import type { WebSessionListing } from './server.js';
import { setSessionArchive, Sessions as SessionsView } from './sessions.js';
import { SessionReplies } from './session-reply.js';

function Sessions(props: ComponentProps<typeof SessionsView>) {
  return (
    <SessionReplies>
      <SessionsView {...props} />
    </SessionReplies>
  );
}

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

it('matches a pack delegation by its native lead, store and thread id', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(listing)));
  const live: NonNullable<ComponentProps<typeof SessionsView>['live']> = {
    agent: 'pack',
    cwd: '/work/bakery',
    sessionId: asking.id,
    status: 'running',
    canSteer: false,
    queued: [],
    notes: [],
    approvals: [],
    usage: {},
    turns: [
      {
        id: 1,
        agent: 'pack',
        prompt: 'Review the recipe',
        entries: [],
        startedAt: Date.now(),
        pack: {
          lead: 'helper',
          maxParallel: 1,
          interactive: true,
          tasks: [
            {
              id: 't1',
              agent: 'codex',
              prompt: 'Check the recipe',
              cwd: '/work/bakery',
              mode: 'shared',
              status: 'running',
            },
          ],
        },
      },
    ],
  };
  const props = { token: 't', cwd: '/work/bakery', radar: true, live, onOpen: vi.fn(), onContinue: vi.fn() };
  await act(async () => root.render(<Sessions {...props} liveSource={asking.source} />));
  expect(host.querySelector('.radar-detail')?.textContent).toContain('helper → codex');
  await act(async () => root.render(<Sessions {...props} liveSource="other-store" />));
  expect(host.querySelector('.radar-detail')?.textContent).not.toContain('Delegated tasks');
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
  const data = {
    ...listing,
    sessions: [asking, alias],
    readable: [asking.source],
    topics: [{ id: 'bread', name: 'Bread' }],
    topicOf: { ['index:' + asking.id]: 'bread' },
  };
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(data)));
  await act(async () =>
    root.render(<Sessions token="t" cwd="/work" topic="bread" onOpen={vi.fn()} onContinue={vi.fn()} />),
  );
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

it('refreshes the archive after a later batch fails', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(new Response())
    .mockResolvedValueOnce(new Response(null, { status: 500 }));
  vi.stubGlobal('fetch', send);
  const refresh = vi.fn();
  window.addEventListener('genaicode-history-changed', refresh);
  try {
    const rows = Array.from({ length: 501 }, (_, i) => ({ ...asking, id: String(i) }));
    await expect(setSessionArchive('token', rows, true)).rejects.toThrow('500');
    expect(send).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener('genaicode-history-changed', refresh);
  }
});

it.each([true, false])(
  'keeps the outcome of a pending send visible when the session becomes active (success %s)',
  async (success) => {
    let state: SessionInfo['state'] = 'waiting';
    let finish!: (response: Response) => void;
    const sends: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/send')) {
        sends.push(String(init?.body));
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      if (url.includes('/transcript')) return Response.json({ turns: [] });
      return Response.json({ ...listing, sessions: [{ ...asking, state }] });
    });
    const show = async (selected: SessionInfo) =>
      act(async () =>
        root.render(<Sessions token="t" cwd="/work" selected={selected} onOpen={vi.fn()} onContinue={vi.fn()} />),
      );
    await show(asking);
    const detail = () => host.querySelector('.session-detail')!;
    await act(async () => detail().querySelector<HTMLButtonElement>('.thread-reply')!.click());
    const field = detail().querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Bake today.');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      field.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    state = 'active';
    await act(async () => {
      window.dispatchEvent(new Event('genaicode-history-changed'));
    });
    expect(detail().querySelector('form')).toBeNull();
    expect(detail().textContent).toContain('Waiting for helper to finish');
    await act(async () =>
      finish(
        Response.json(
          success ? { ok: true, text: 'Baking today.' } : { error: 'Lost connection.', delivery: 'unknown' },
          { status: success ? 200 : 422 },
        ),
      ),
    );
    expect(detail().textContent).toContain(
      success ? 'helper completed the turn from Genaicode' : 'Delivery to this session is unconfirmed.',
    );
    expect(detail().querySelector('.thread-reply')).toBeNull();
    expect(sends).toHaveLength(1);
    await show({ ...asking, id: 'a-different-conversation' });
    expect(detail().querySelector('.thread-receipt, [role="alert"]')).toBeNull();
    await show(asking);
    expect(detail().textContent).toContain(success ? 'Baking today.' : 'Lost connection.');
  },
);
