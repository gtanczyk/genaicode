import { describe, expect, it } from 'vitest';
import { cursorCloud, cursorCloudProvider, type CursorCloudOptions, type CursorRun } from './cursor-cloud.js';
import type { AgentEvent, AgentTask } from '../types.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

/** One SSE event: `event` is its type, `data` its payload, `id` left out for an unnumbered one. */
interface Sse {
  event: string;
  data: Record<string, unknown>;
  noId?: boolean;
}

interface Stream {
  events: Sse[];
  /** Drop the connection after the events. */
  drop?: boolean;
  /** Keep the connection open after the events until this resolves. */
  hold?: Promise<void>;
  /** Answer with this status instead of a stream. */
  status?: number;
  /** Events sent once `hold` resolves. */
  after?: Sse[];
}

interface FakeOptions {
  /** Run status by read count, per run id; default FINISHED with `result` 'All fixed.'. */
  runs?: Record<string, Partial<CursorRun> | ((reads: number) => Partial<CursorRun>)>;
  /** An existing agent, for resume. */
  agent?: { id: string; status?: string; latestRunId?: string };
  /** Streams per run, one per connection. */
  streams?: Record<string, Stream[]>;
  /** Agent `totalUsage` by read count. */
  usage?: (reads: number) => Record<string, number>;
  /** A status for `POST /v1/agents` instead of success. */
  createStatus?: number;
  /** A status for `POST .../cancel` instead of success. */
  cancelStatus?: number;
  /** Steers come back `queued`, and the agent starts the next run a few reads later. */
  steerQueued?: boolean;
}

function fakeFetch(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const reads = new Map<string, number>();
  const read = (key: string) => {
    const count = (reads.get(key) ?? 0) + 1;
    reads.set(key, count);
    return count;
  };
  const streams = new Map(Object.entries(options.streams ?? {}).map(([run, list]) => [run, [...list]]));
  let agent = options.agent ? { status: 'IDLE', ...options.agent } : undefined;
  let runCount = options.agent?.latestRunId ? Number(options.agent.latestRunId.split('-')[1]) : 0;
  const cancelled = new Set<string>();
  // Agent reads left before a queued steer's run starts.
  let nextRunAfter = 0;
  const runOf = (id: string): CursorRun => {
    const spec = options.runs?.[id];
    const found = typeof spec === 'function' ? spec(read(`run:${id}`)) : spec;
    return {
      id,
      agentId: agent?.id,
      status: cancelled.has(id) ? 'CANCELLED' : 'FINISHED',
      createdAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:01:00.000Z',
      ...(cancelled.has(id) ? {} : { result: 'All fixed.', ...found }),
    };
  };
  let eventId = 0;
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({
      method,
      url: String(input),
      headers: { ...(init.headers as Record<string, string>) },
      ...(body ? { body } : {}),
    });
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    // v1 agents {id} runs {run} stream|cancel
    if (method === 'POST' && parts.length === 2) {
      if (options.createStatus)
        return Response.json(
          { error: { code: 'rate_limit_exceeded', message: 'Too many requests.' } },
          { status: options.createStatus },
        );
      runCount += 1;
      agent = { id: 'bc-1', status: 'ACTIVE', latestRunId: `run-${runCount}` };
      return Response.json({ agent, run: { id: `run-${runCount}`, agentId: 'bc-1', status: 'CREATING' } });
    }
    if (!agent || parts[2] !== agent.id) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    if (method === 'DELETE') return Response.json({ id: agent.id });
    if (parts[3] === 'usage') {
      const totalUsage = options.usage?.(read('usage')) ?? {
        inputTokens: 100,
        outputTokens: 20,
        cacheWriteTokens: 0,
        cacheReadTokens: 30,
        totalTokens: 150,
      };
      return Response.json({ totalUsage, runs: [] });
    }
    if (method === 'POST' && parts[3] === 'runs' && parts.length === 4) {
      if (body?.delivery === 'steer' && options.steerQueued) {
        nextRunAfter = 2;
        return Response.json({ delivery: 'queued' }, { status: 202 });
      }
      if (body?.delivery === 'steer')
        return Response.json({ delivery: 'steered', runId: agent.latestRunId }, { status: 202 });
      runCount += 1;
      agent = { ...agent, latestRunId: `run-${runCount}` };
      return Response.json({ run: { id: `run-${runCount}`, agentId: agent.id, status: 'CREATING' } });
    }
    if (method === 'POST' && parts[5] === 'cancel') {
      if (options.cancelStatus)
        return Response.json({ error: { code: 'run_not_cancellable' } }, { status: options.cancelStatus });
      cancelled.add(parts[4]);
      return Response.json({ id: parts[4] });
    }
    if (parts[5] === 'stream') {
      const stream = streams.get(parts[4])?.shift();
      if (!stream) return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
      if (stream.status)
        return Response.json({ error: { code: 'stream_expired', message: 'Expired.' } }, { status: stream.status });
      const encoder = new TextEncoder();
      const chunks = stream.events.map((event) => {
        const id = event.noId ? '' : `id: ${++eventId}-0\n`;
        return encoder.encode(`${id}event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      });
      let held = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            const chunk = chunks.shift();
            if (chunk) return controller.enqueue(chunk);
            if (stream.hold && !held) {
              held = true;
              // Like a real fetch, an aborted request ends the body with an error.
              const signal = init.signal;
              const aborted = new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
              await Promise.race([stream.hold, aborted]);
              if (signal?.aborted) return controller.error(new DOMException('aborted', 'AbortError'));
              for (const event of stream.after ?? [])
                chunks.push(
                  encoder.encode(`id: ${++eventId}-0\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`),
                );
              const chunk = chunks.shift();
              if (chunk) return controller.enqueue(chunk);
            }
            if (stream.drop) controller.error(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
            else controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }
    if (parts[3] === 'runs' && parts[4]) return Response.json(runOf(parts[4]));
    if (parts.length === 3) {
      if (nextRunAfter > 0 && --nextRunAfter === 0) {
        runCount += 1;
        agent = { ...agent, latestRunId: `run-${runCount}` };
      }
      return Response.json({ ...agent, createdAt: '2026-11-18T10:00:00.000Z' });
    }
    return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  };
  const called = (method: string, pathPart: string) =>
    calls.filter((call) => call.method === method && call.url.includes(pathPart));
  return { fetch: impl as typeof fetch, calls, called };
}

const base = (fetch: typeof globalThis.fetch, extra: Partial<CursorCloudOptions> = {}): CursorCloudOptions => ({
  fetch,
  apiKey: 'test-key',
  pollIntervalMs: 1,
  ...extra,
});

async function drain(run: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

const task = (extra: Partial<AgentTask> = {}): AgentTask => ({ prompt: 'Fix the bug', cwd: '.', ...extra });

const turn = (run = 'run-1'): Sse[] => [
  { event: 'status', data: { runId: run, status: 'RUNNING' }, noId: true },
  { event: 'assistant', data: { text: 'Look' } },
  { event: 'assistant', data: { text: 'ing.' } },
  { event: 'tool_call', data: { callId: 'call-1', name: 'read_file', status: 'running', args: { path: 'a.ts' } } },
  {
    event: 'tool_call',
    data: { callId: 'call-1', name: 'read_file', status: 'completed', args: { path: 'a.ts' }, result: 'x' },
  },
  { event: 'tool_call', data: { callId: 'call-2', name: 'run_terminal_cmd', status: 'running' } },
  {
    event: 'tool_call',
    data: { callId: 'call-2', name: 'run_terminal_cmd', status: 'completed', result: { error: { message: 'boom' } } },
  },
  { event: 'heartbeat', data: {} },
  { event: 'assistant', data: { text: 'All fixed.' } },
  { event: 'result', data: { runId: run, status: 'FINISHED', text: 'All fixed.', durationMs: 1000 } },
  { event: 'done', data: {} },
];

const shown = (events: AgentEvent[]) => events.filter((e) => e.type !== 'usage' && e.type !== 'done');

describe('cursorCloud', () => {
  it('creates an agent, streams its run and ends on the run result', async () => {
    const fake = fakeFetch({ streams: { 'run-1': [{ events: turn() }] } });
    const run = cursorCloud(base(fake.fetch)).run(task());
    const events = await drain(run);
    const result = await run.result;

    const [create] = fake.called('POST', '/v1/agents');
    expect(create.url).toBe('https://api.cursor.com/v1/agents');
    expect(create.headers).toMatchObject({ authorization: 'Bearer test-key' });
    expect(create.body).toEqual({ prompt: { text: 'Fix the bug' } });
    const [stream] = fake.called('GET', '/stream');
    expect(stream.url).toBe('https://api.cursor.com/v1/agents/bc-1/runs/run-1/stream');
    expect(shown(events)).toEqual([
      { type: 'session', sessionId: 'bc-1' },
      { type: 'text-delta', text: 'Look' },
      { type: 'text-delta', text: 'ing.' },
      { type: 'message', text: 'Looking.' },
      { type: 'tool-start', id: 'call-1', name: 'read_file', input: { path: 'a.ts' } },
      { type: 'tool-end', id: 'call-1', name: 'read_file', output: 'x' },
      { type: 'tool-start', id: 'call-2', name: 'run_terminal_cmd' },
      {
        type: 'tool-end',
        id: 'call-2',
        name: 'run_terminal_cmd',
        isError: true,
        output: '{"error":{"message":"boom"}}',
      },
      { type: 'text-delta', text: 'All fixed.' },
      { type: 'message', text: 'All fixed.' },
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      ok: true,
      sessionId: 'bc-1',
      text: 'All fixed.',
      usage: { inputTokens: 130, outputTokens: 20, totalTokens: 150, cachedInputTokens: 30 },
    });
    expect(fake.called('POST', '/cancel')).toEqual([]);
  });

  it('maps the workspace, model, MCP servers and options onto the new agent', async () => {
    const fake = fakeFetch({ streams: { 'run-1': [{ events: turn().slice(-2) }] } });
    const run = cursorCloud(
      base(fake.fetch, { autoCreatePR: true, env: { type: 'pool', name: 'sandbox' }, mode: 'plan' }),
    ).run(
      task({
        model: 'composer-2',
        cwd: 'https://github.com/acme/app#dev',
        mcpServers: [{ name: 'docs', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } }],
      } as Partial<AgentTask>),
    );
    await drain(run);
    expect((await run.result).ok).toBe(true);
    expect(fake.called('POST', '/v1/agents')[0].body).toEqual({
      prompt: { text: 'Fix the bug' },
      model: { id: 'composer-2' },
      env: { type: 'pool', name: 'sandbox' },
      repos: [{ url: 'https://github.com/acme/app', startingRef: 'dev' }],
      autoCreatePR: true,
      mcpServers: [
        { name: 'docs', type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } },
      ],
      mode: 'plan',
    });
  });

  it('puts the system prompt before the task and names the agent after the correlation id', async () => {
    const fake = fakeFetch();
    const snapshot = await cursorCloudProvider(base(fake.fetch)).start({
      prompt: 'Go',
      system: 'Be brief.',
      correlationId: 'job-7',
    });
    expect(snapshot).toMatchObject({ id: 'bc-1', state: 'queued', cursor: 'run-1' });
    expect(fake.called('POST', '/v1/agents')[0].body).toEqual({ prompt: { text: 'Be brief.\n\nGo' }, name: 'job-7' });
  });

  it('starts on a pull request given as the workspace', async () => {
    const fake = fakeFetch({ streams: { 'run-1': [{ events: turn().slice(-2) }] } });
    const run = cursorCloud(base(fake.fetch)).run(task({ cwd: 'https://github.com/acme/app/pull/12' }));
    await drain(run);
    expect(fake.called('POST', '/v1/agents')[0].body).toMatchObject({
      repos: [{ url: 'https://github.com/acme/app', prUrl: 'https://github.com/acme/app/pull/12' }],
    });
  });

  it('refuses what the platform cannot take, before creating anything', async () => {
    for (const extra of [{ effort: 'high' }, { maxTurns: 3 }, { cwd: 'https://example.com' }] as Partial<AgentTask>[]) {
      const fake = fakeFetch();
      const result = await cursorCloud(base(fake.fetch)).run(task(extra)).result;
      expect(result.ok).toBe(false);
      expect(fake.called('POST', '/v1/agents')).toEqual([]);
    }
  });

  it('resumes as a follow-up run on the same agent and reports only its own usage', async () => {
    const fake = fakeFetch({
      agent: { id: 'bc-1', latestRunId: 'run-1' },
      usage: (reads) =>
        reads <= 2
          ? { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 120 }
          : { inputTokens: 150, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 180 },
      runs: { 'run-2': { result: 'Done again.' } },
      streams: {
        'run-2': [
          {
            events: [
              { event: 'assistant', data: { text: 'Done again.' } },
              { event: 'result', data: { runId: 'run-2', status: 'FINISHED', text: 'Done again.' } },
            ],
          },
        ],
      },
    });
    const run = cursorCloud(base(fake.fetch)).run(task({ resume: 'bc-1', prompt: 'And the tests' }));
    const events = await drain(run);
    const result = await run.result;
    expect(fake.called('POST', '/v1/agents/bc-1/runs')[0].body).toEqual({ prompt: { text: 'And the tests' } });
    expect(fake.called('GET', '/runs/run-2/stream')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'message')).toEqual([{ type: 'message', text: 'Done again.' }]);
    expect(result).toMatchObject({ ok: true, sessionId: 'bc-1', text: 'Done again.' });
    expect(result.usage).toMatchObject({ inputTokens: 50, outputTokens: 10, totalTokens: 60 });
  });

  it('refuses to resume a running agent or to change its model', async () => {
    const busy = fakeFetch({ agent: { id: 'bc-1', latestRunId: 'run-1' }, runs: { 'run-1': { status: 'RUNNING' } } });
    const running = await cursorCloud(base(busy.fetch)).run(task({ resume: 'bc-1' })).result;
    expect(running.error).toMatch(/still running/);
    const idle = fakeFetch({ agent: { id: 'bc-1', latestRunId: 'run-1' } });
    const model = await cursorCloud(base(idle.fetch)).run(task({ resume: 'bc-1', model: 'gpt-6' })).result;
    expect(model.error).toMatch(/keeps the agent's model/);
    expect([...busy.called('POST', '/runs'), ...idle.called('POST', '/runs')]).toEqual([]);
  });

  it('reconnects a dropped stream from the last event id', async () => {
    const events = turn();
    const fake = fakeFetch({
      streams: { 'run-1': [{ events: events.slice(0, 4), drop: true }, { events: events.slice(4) }] },
    });
    const run = cursorCloud(base(fake.fetch)).run(task());
    const seen = await drain(run);
    expect((await run.result).ok).toBe(true);
    const streams = fake.called('GET', '/stream');
    expect(streams).toHaveLength(2);
    expect(streams[0].headers['last-event-id']).toBeUndefined();
    expect(streams[1].headers['last-event-id']).toBe('3-0');
    expect(shown(seen).filter((e) => e.type === 'tool-start')).toHaveLength(2);
  });

  it('reads the end state when the stream has expired', async () => {
    const fake = fakeFetch({ streams: { 'run-1': [{ events: [], status: 410 }] } });
    const run = cursorCloud(base(fake.fetch)).run(task());
    const events = await drain(run);
    expect(await run.result).toMatchObject({ ok: true, text: 'All fixed.' });
    expect(events).toContainEqual({ type: 'message', text: 'All fixed.' });
  });

  it('fails the run when the platform run errors', async () => {
    const fake = fakeFetch({
      runs: { 'run-1': { status: 'ERROR', result: 'The VM could not start.' } },
      streams: {
        'run-1': [
          {
            events: [
              { event: 'result', data: { runId: 'run-1', status: 'ERROR' } },
              { event: 'done', data: {} },
            ],
          },
        ],
      },
    });
    const result = await cursorCloud(base(fake.fetch)).run(task()).result;
    expect(result).toMatchObject({ ok: false, error: 'The VM could not start.' });
  });

  it('classifies a rate-limited create as quota', async () => {
    const fake = fakeFetch({ createStatus: 429 });
    const result = await cursorCloud(base(fake.fetch)).run(task()).result;
    expect(result).toMatchObject({ ok: false, failure: { kind: 'quota' } });
    expect(result.error).toMatch(/Too many requests/);
  });

  it('steers the running turn and cancels its run when aborted', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeFetch({
      runs: { 'run-1': { status: 'RUNNING', result: undefined } },
      streams: { 'run-1': [{ events: turn().slice(0, 2), hold }] },
    });
    const run = cursorCloud(base(fake.fetch)).run(task());
    for await (const event of run) if (event.type === 'text-delta') break;
    await run.steer!('Also the docs');
    expect(fake.called('POST', '/v1/agents/bc-1/runs')[0].body).toEqual({
      prompt: { text: 'Also the docs' },
      delivery: 'steer',
    });
    run.abort();
    const result = await run.result;
    release();
    expect(result.status).toBe('aborted');
    expect(fake.called('POST', '/runs/run-1/cancel')).toHaveLength(1);
  });

  it('goes on in the next run when a steer was queued behind the ending one', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeFetch({
      steerQueued: true,
      // Still running when the turn moves to it, and again when the stream to it opens.
      runs: { 'run-2': (reads) => (reads <= 2 ? { status: 'RUNNING', result: undefined } : { result: 'Docs too.' }) },
      streams: {
        'run-1': [{ events: turn().slice(0, 2), hold, after: turn().slice(3) }],
        'run-2': [
          {
            events: [
              { event: 'assistant', data: { text: 'Docs too.' } },
              { event: 'result', data: { runId: 'run-2', status: 'FINISHED', text: 'Docs too.' } },
            ],
          },
        ],
      },
    });
    const run = cursorCloud(base(fake.fetch)).run(task());
    const events: AgentEvent[] = [];
    for await (const event of run) {
      events.push(event);
      if (event.type === 'text-delta' && event.text === 'Look') {
        await run.steer!('Also the docs');
        release();
      }
    }
    const result = await run.result;
    expect(fake.called('GET', '/runs/run-2/stream')).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, text: 'Docs too.' });
    expect(events.filter((e) => e.type === 'message').map((e) => (e as { text: string }).text)).toEqual([
      'Look',
      'All fixed.',
      'Docs too.',
    ]);
  });

  it('sends an empty MCP list on resume, so earlier servers are dropped', async () => {
    const fake = fakeFetch({
      agent: { id: 'bc-1', latestRunId: 'run-1' },
      streams: { 'run-2': [{ events: [{ event: 'result', data: { runId: 'run-2', status: 'FINISHED' } }] }] },
    });
    await cursorCloud(base(fake.fetch)).run(task({ resume: 'bc-1', mcpServers: [] })).result;
    expect(fake.called('POST', '/v1/agents/bc-1/runs')[0].body).toEqual({
      prompt: { text: 'Fix the bug' },
      mcpServers: [],
    });
  });

  it('reads usage while the stream runs, so a local budget stops the run', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeFetch({
      usage: (reads) =>
        reads <= 1
          ? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }
          : { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1000 },
      runs: { 'run-1': { status: 'RUNNING', result: undefined } },
      streams: { 'run-1': [{ events: [{ event: 'heartbeat', data: {} }, ...turn().slice(1, 3)], hold }] },
    });
    const run = cursorCloud(base(fake.fetch)).run(task({ budget: { maxTokens: 10 } }));
    const events = await drain(run);
    const result = await run.result;
    release();
    expect(events).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 900, outputTokens: 100, totalTokens: 1000, cachedInputTokens: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({ kind: 'budget' });
    expect(fake.called('POST', '/runs/run-1/cancel')).toHaveLength(1);
  });

  it('reports an interrupt of a run that already ended as enforced', async () => {
    const fake = fakeFetch({ agent: { id: 'bc-1', latestRunId: 'run-1' }, cancelStatus: 409 });
    expect(await cursorCloudProvider(base(fake.fetch)).interrupt('bc-1')).toEqual({ enforced: true });
  });

  it('reports a deleted agent as gone, and deletes one', async () => {
    const provider = cursorCloudProvider(base(fakeFetch().fetch));
    expect(await provider.get('bc-404')).toBeNull();
    const fake = fakeFetch({ agent: { id: 'bc-1', latestRunId: 'run-1' } });
    await cursorCloudProvider(base(fake.fetch)).delete!('bc-1');
    expect(fake.called('DELETE', '/v1/agents/bc-1')).toHaveLength(1);
  });
});
