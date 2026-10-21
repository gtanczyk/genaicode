// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState, SessionTurn } from '../agents/session.js';
import { AppAgentChat, PROMPT_MARKER, type AppAgentChatProps, type AppAgentState } from '../react.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t0 = Date.parse('2026-10-20T10:00:00Z');

function turn(id: number, prompt: string, answer: string, agent = 'claude'): SessionTurn {
  return {
    id,
    agent,
    prompt,
    startedAt: t0,
    endedAt: t0 + 3_000,
    result: { status: 'completed', ok: true, exitCode: 0, signal: null },
    entries: [
      { kind: 'tool', id: `t${id}`, name: 'mcp__app__orders', input: {}, output: '3 orders', done: true },
      { kind: 'text', text: answer, streaming: false },
    ],
  };
}

function session(turns: SessionTurn[], patch: Partial<SessionState> = {}): SessionState {
  return {
    agent: 'claude',
    cwd: '/tmp/x',
    status: 'idle',
    canSteer: false,
    usage: {},
    queued: [],
    approvals: [],
    turns,
    ...patch,
  };
}

function appState(patch: Partial<AppAgentState> = {}): AppAgentState {
  return {
    name: 'the shop admin',
    mode: 'use',
    modes: ['use', 'dev'],
    agent: 'claude',
    agents: [
      { name: 'claude', installed: true },
      { name: 'codex', installed: false },
    ],
    session: session([turn(1, `Briefing...${PROMPT_MARKER}how many orders?`, 'There are **3** open orders.')]),
    history: [],
    actions: [],
    links: [{ turnId: 1, label: 'Orders', path: '/orders' }],
    view: '/orders',
    navigation: null,
    ...patch,
  };
}

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  emit(state: AppAgentState) {
    act(() => this.onmessage?.({ data: JSON.stringify(state) }));
  }
  close() {
    this.closed = true;
  }
}

let root: Root;
let container: HTMLElement;
let calls: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith('/changes')) {
        return new Response(JSON.stringify({ files: [{ status: 'M', path: 'src/a.ts' }], diff: '+two' }));
      }
      if (url.endsWith('/view')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(appState()));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount(props: Partial<AppAgentChatProps> = {}) {
  act(() => root.render(<AppAgentChat {...props} />));
  return FakeEventSource.last!;
}

const text = () => container.textContent ?? '';
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe('AppAgentChat', () => {
  it('connects to the handler and shows the conversation without the briefing', () => {
    const events = mount({ basePath: '/api/agent/' });
    expect(events.url).toBe('/api/agent/events');
    events.emit(appState());
    expect(text()).toContain('how many orders?');
    expect(text()).not.toContain('Briefing');
    expect(container.querySelector('strong')?.textContent).toBe('3');
    // The MCP server prefix is dropped from tool names.
    expect(text()).toContain('orders');
    expect(text()).not.toContain('mcp__app__');
  });

  it('reports the open page, follows chips and app_open, but not a stale request on mount', async () => {
    const onNavigate = vi.fn();
    const events = mount({ currentPath: '/orders', onNavigate });
    events.emit(appState({ navigation: { id: 4, path: '/customers' } }));
    await flush();
    expect(calls).toContainEqual({ url: '/api/agent/view', body: { path: '/orders' } });
    expect(onNavigate).not.toHaveBeenCalled();

    act(() => button('Orders').click());
    expect(onNavigate).toHaveBeenLastCalledWith('/orders');
    events.emit(appState({ navigation: { id: 5, path: '/customers' } }));
    expect(onNavigate).toHaveBeenLastCalledWith('/customers');
  });

  it('shows pending actions with the diff of a proposed commit, and sends decisions', async () => {
    const events = mount();
    events.emit(
      appState({
        actions: [
          {
            id: '1',
            kind: 'tool',
            summary: 'Refund order 7',
            tool: { name: 'refund', args: { id: '7' } },
            status: 'pending',
            createdAt: t0,
          },
          {
            id: '2',
            kind: 'commit',
            summary: 'Fix the total',
            commit: { message: 'Fix the total', tree: 'abc', base: null },
            status: 'pending',
            createdAt: t0,
          },
        ],
      }),
    );
    await flush();
    expect(text()).toContain('Refund order 7');
    expect(text()).toContain('"id": "7"');
    expect(text()).toContain('1 changed file');
    expect(text()).toContain('+two');

    act(() => button('Approve').click());
    await flush();
    expect(calls).toContainEqual({ url: '/api/agent/actions/1', body: { decision: 'approve' } });
  });

  it('keeps a commit with a truncated diff unapprovable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ files: [], diff: '+a', truncated: true }))),
    );
    const events = mount();
    events.emit(
      appState({
        actions: [
          {
            id: '2',
            kind: 'commit',
            summary: 'Fix',
            commit: { message: 'Fix', tree: 'abc', base: null },
            status: 'pending',
            createdAt: t0,
          },
        ],
      }),
    );
    await flush();
    expect(button('Approve').disabled).toBe(true);
    expect(text()).toContain('too large to review');
  });

  it('keeps a commit unapprovable until its diff loads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const events = mount();
    events.emit(
      appState({
        actions: [
          {
            id: '2',
            kind: 'commit',
            summary: 'Fix',
            commit: { message: 'Fix', tree: 'abc', base: null },
            status: 'pending',
            createdAt: t0,
          },
        ],
      }),
    );
    expect(button('Approve').disabled).toBe(true);
    expect(text()).toContain('Loading the changes');
    await flush();
    expect(button('Approve').disabled).toBe(true);
    expect(text()).toContain('Could not load the changes');
  });

  it('uses a client the host passes instead of opening its own stream', () => {
    FakeEventSource.last = null;
    const client = {
      state: appState(),
      error: null,
      send: vi.fn(),
      stop: vi.fn(),
      reset: vi.fn(),
      configure: vi.fn(),
      view: vi.fn(),
      decide: vi.fn(),
      approve: vi.fn(),
      changes: vi.fn(),
    };
    act(() => root.render(<AppAgentChat client={client} />));
    expect(FakeEventSource.last).toBeNull();
    expect(text()).toContain('how many orders?');
  });

  it('loads a commit diff once, not on every update', async () => {
    const events = mount();
    const commit = {
      id: '2',
      kind: 'commit' as const,
      summary: 'Fix',
      commit: { message: 'Fix', tree: 'abc', base: null },
      status: 'pending' as const,
      createdAt: t0,
    };
    events.emit(appState({ actions: [commit] }));
    await flush();
    events.emit(appState({ actions: [commit], view: '/customers' }));
    await flush();
    expect(calls.filter((c) => c.url.endsWith('/changes'))).toHaveLength(1);
  });

  it('reloads the diff when an action id comes back with another tree', async () => {
    const events = mount();
    const commit = {
      id: '2',
      kind: 'commit' as const,
      summary: 'Fix',
      commit: { message: 'Fix', tree: 'abc', base: null },
      status: 'pending' as const,
      createdAt: t0,
    };
    events.emit(appState({ actions: [commit] }));
    await flush();
    expect(button('Approve').disabled).toBe(false);
    // The server restarted: action 2 is now another commit.
    events.emit(appState({ actions: [{ ...commit, commit: { message: 'Other', tree: 'def', base: null } }] }));
    expect(button('Approve').disabled).toBe(true);
    await flush();
    expect(calls.filter((c) => c.url.endsWith('/changes'))).toHaveLength(2);
    expect(button('Approve').disabled).toBe(false);
  });

  it('drops a diff reply for a tree the card no longer shows', async () => {
    const replies: Array<(diff: string) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) =>
            replies.push((diff) => resolve(new Response(JSON.stringify({ files: [], diff })))),
          ),
      ),
    );
    const events = mount();
    const commit = {
      id: '2',
      kind: 'commit' as const,
      summary: 'Fix',
      commit: { message: 'Fix', tree: 'abc', base: null },
      status: 'pending' as const,
      createdAt: t0,
    };
    events.emit(appState({ actions: [commit] }));
    events.emit(appState({ actions: [{ ...commit, commit: { message: 'Other', tree: 'def', base: null } }] }));
    const [first, second] = replies.slice(-2);
    second!('new diff');
    await flush();
    first!('old diff');
    await flush();
    expect(text()).toContain('new diff');
    expect(text()).not.toContain('old diff');
    expect(button('Approve').disabled).toBe(false);
  });

  it('keeps the streamed state over an older POST reply', async () => {
    const events = mount();
    events.emit(appState({ session: session([turn(1, 'how many orders?', 'Streamed answer.')]) }));
    // The POST reply (the default fixture) is older than what the stream already showed.
    act(() => button('New').click());
    await flush();
    expect(text()).toContain('Streamed answer.');
  });

  it('switches agent and mode, keeps history with a divider, and starts over with New', async () => {
    const events = mount({ modeLabels: { use: 'ops' } });
    const earlier = turn(-1, `Briefing${PROMPT_MARKER}first`, 'first answer', 'codex');
    events.emit(appState({ history: [earlier] }));
    expect(text()).toContain('first answer');
    expect(text()).toContain('Continued with claude');

    act(() => button('dev').click());
    act(() => button('New').click());
    const select = container.querySelector('select')!;
    expect(Array.from(select.options).map((o) => [o.value, o.disabled])).toEqual([
      ['claude', false],
      ['codex', true],
    ]);
    expect(button('ops')).toBeTruthy();
    await flush();
    expect(calls.map((c) => c.url)).toEqual(['/api/agent/config', '/api/agent/reset']);
    expect(calls[0]!.body).toEqual({ mode: 'dev' });
  });

  it('answers the agent CLI permission prompts and shows app notes as one muted line', async () => {
    const events = mount();
    events.emit(
      appState({
        session: session(
          [
            turn(1, `B${PROMPT_MARKER}run tests`, 'ok'),
            turn(2, '[app] The user approved action #1 (Refund). Result:\nlong output', 'Refunded.'),
            {
              ...turn(3, `${PROMPT_MARKER}test it`, ''),
              result: undefined,
              endedAt: undefined,
              entries: [{ kind: 'approval', request: { id: 'ap1', kind: 'command', summary: 'npm test' } }],
            },
          ],
          {
            status: 'running',
            approvals: [{ id: 'ap1', kind: 'command', summary: 'npm test' }],
          },
        ),
        links: [],
      }),
    );
    expect(text()).toContain('The user approved action #1 (Refund). Result:');
    expect(text()).not.toContain('long output');
    const approve = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Approve')!;
    act(() => approve.click());
    await flush();
    expect(calls).toContainEqual({ url: '/api/agent/approvals/ap1', body: { decision: 'approve' } });
  });
});
