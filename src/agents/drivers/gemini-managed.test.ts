import { describe, expect, it } from 'vitest';
import {
  geminiManaged,
  geminiManagedProvider,
  type GeminiInteraction,
  type GeminiManagedOptions,
} from './gemini-managed.js';
import type { AgentEvent, AgentTask } from '../types.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

/** One SSE event: `event_type` and `event_id` are filled in. */
type Sse = Record<string, unknown> & { event_type: string };

interface FakeOptions {
  /** What `POST /interactions` returns; status defaults to `in_progress`. */
  created?: Partial<GeminiInteraction>;
  /** `GET /interactions/{id}` results by id; a function sees how often it was read. */
  interactions?: Record<string, GeminiInteraction | ((reads: number) => GeminiInteraction)>;
  /** One per stream connection: events, then optionally a dropped connection. */
  streams?: { events: Sse[]; drop?: boolean }[];
  /** A status for `POST /interactions` instead of success. */
  createStatus?: number;
}

function fakeFetch(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const reads = new Map<string, number>();
  const streams = [...(options.streams ?? [])];
  let eventId = 0;
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, url, headers: { ...(init.headers as Record<string, string>) }, ...(body ? { body } : {}) });
    const path = new URL(url).pathname.replace(/^.*?\/interactions/, '/interactions');
    if (method === 'POST' && path === '/interactions') {
      if (options.createStatus)
        return new Response(JSON.stringify({ error: { message: 'Resource exhausted' } }), {
          status: options.createStatus,
        });
      return Response.json({ id: 'int_1', status: 'in_progress', created: '2026-11-18T10:00:00Z', ...options.created });
    }
    if (method === 'POST' && path.endsWith('/cancel')) return Response.json({ id: 'int_1', status: 'cancelled' });
    if (method === 'DELETE') return new Response('', { status: 200 });
    const id = decodeURIComponent(path.split('/')[2]);
    if (new URL(url).searchParams.get('stream') === 'true') {
      const stream = streams.shift();
      if (!stream) return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
      const encoder = new TextEncoder();
      const chunks = stream.events.map((event) => {
        eventId += 1;
        const data = { event_id: `evt_${eventId}`, ...event };
        return encoder.encode(`event: ${event.event_type}\ndata: ${JSON.stringify(data)}\n\n`);
      });
      return new Response(
        new ReadableStream<Uint8Array>({
          // One chunk per read, so a drop comes after the events before it were read.
          pull(controller) {
            const chunk = chunks.shift();
            if (chunk) controller.enqueue(chunk);
            else if (stream.drop) controller.error(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
            else controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }
    const found = options.interactions?.[id];
    if (!found) return new Response('{"error":{"message":"not found"}}', { status: 404 });
    const count = (reads.get(id) ?? 0) + 1;
    reads.set(id, count);
    return Response.json(typeof found === 'function' ? found(count) : found);
  };
  const called = (method: string, pathPart: string) =>
    calls.filter((call) => call.method === method && call.url.includes(pathPart));
  return { fetch: impl as typeof fetch, calls, called };
}

const base = (fetch: typeof globalThis.fetch, extra: Partial<GeminiManagedOptions> = {}): GeminiManagedOptions => ({
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

const done = (id = 'int_1', extra: Partial<GeminiInteraction> = {}): GeminiInteraction => ({
  id,
  status: 'completed',
  model: 'gemini-4-hydrogen',
  environment_id: 'env_1',
  created: '2026-11-18T10:00:00Z',
  updated: '2026-11-18T10:01:00Z',
  usage: { total_input_tokens: 100, total_output_tokens: 20, total_thought_tokens: 5, total_tokens: 125 },
  steps: [
    { type: 'user_input', content: [{ type: 'text', text: 'Fix the bug' }] },
    { type: 'model_output', content: [{ type: 'text', text: 'All fixed.' }] },
  ],
  ...extra,
});

const turn: Sse[] = [
  { event_type: 'interaction.created', interaction: { id: 'int_1', status: 'in_progress' } },
  { event_type: 'step.start', index: 0, step: { type: 'thought' } },
  { event_type: 'step.stop', index: 0 },
  { event_type: 'step.start', index: 1, step: { type: 'model_output' } },
  { event_type: 'step.delta', index: 1, delta: { type: 'text', text: 'Look' } },
  { event_type: 'step.delta', index: 1, delta: { type: 'text', text: 'ing.' } },
  { event_type: 'step.stop', index: 1 },
  {
    event_type: 'step.start',
    index: 2,
    step: { type: 'mcp_server_tool_call', id: 'mcp_1', name: 'lookup', server_name: 'docs', arguments: {} },
  },
  { event_type: 'step.delta', index: 2, delta: { type: 'arguments_delta', arguments: '{"q":' } },
  { event_type: 'step.delta', index: 2, delta: { type: 'arguments_delta', arguments: '"x"}' } },
  { event_type: 'step.stop', index: 2 },
  {
    event_type: 'step.start',
    index: 3,
    step: {
      type: 'mcp_server_tool_result',
      call_id: 'mcp_1',
      server_name: 'docs',
      result: [{ type: 'text', text: 'hit' }],
    },
  },
  { event_type: 'step.stop', index: 3, usage: { total_input_tokens: 60, total_output_tokens: 10, total_tokens: 70 } },
  {
    event_type: 'step.start',
    index: 4,
    step: { type: 'code_execution_call', id: 'code_1', arguments: { code: 'ls' } },
  },
  { event_type: 'step.stop', index: 4 },
  { event_type: 'step.start', index: 5, step: { type: 'code_execution_result', call_id: 'code_1', result: 'a.ts\n' } },
  { event_type: 'step.stop', index: 5 },
  { event_type: 'step.start', index: 6, step: { type: 'model_output' } },
  { event_type: 'step.delta', index: 6, delta: { type: 'text', text: 'All fixed.' } },
  { event_type: 'step.stop', index: 6 },
  { event_type: 'interaction.completed', interaction: { id: 'int_1', status: 'completed' } },
];

describe('geminiManaged', () => {
  it('starts a background interaction, streams its steps and ends on the completed turn', async () => {
    const fake = fakeFetch({ interactions: { int_1: done() }, streams: [{ events: turn }] });
    const run = geminiManaged(base(fake.fetch)).run(task());
    const events = await drain(run);
    const result = await run.result;

    const [create] = fake.called('POST', '/interactions');
    expect(create.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(create.headers).toMatchObject({ 'x-goog-api-key': 'test-key', 'api-revision': '2026-05-20' });
    expect(create.body).toEqual({
      agent: 'antigravity-preview-09-2026',
      input: 'Fix the bug',
      background: true,
      store: true,
      environment: 'remote',
    });
    expect(fake.called('GET', 'stream=true')[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/interactions/int_1?stream=true',
    );
    expect(events.filter((e) => e.type !== 'usage' && e.type !== 'done')).toEqual([
      { type: 'session', sessionId: 'int_1' },
      { type: 'text-delta', text: 'Look' },
      { type: 'text-delta', text: 'ing.' },
      { type: 'message', text: 'Looking.' },
      { type: 'tool-start', id: 'mcp_1', name: 'docs.lookup', input: { q: 'x' } },
      { type: 'tool-end', id: 'mcp_1', name: 'docs.lookup', output: 'hit' },
      { type: 'tool-start', id: 'code_1', name: 'code_execution', input: { code: 'ls' } },
      { type: 'tool-end', id: 'code_1', name: 'code_execution', output: 'a.ts\n' },
      { type: 'text-delta', text: 'All fixed.' },
      { type: 'message', text: 'All fixed.' },
    ]);
    expect(events.filter((e) => e.type === 'usage').map((e) => (e as { usage: unknown }).usage)).toEqual([
      { inputTokens: 60, outputTokens: 10, totalTokens: 70 },
      { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      ok: true,
      sessionId: 'int_1',
      text: 'All fixed.',
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    });
    expect(fake.called('POST', '/cancel')).toEqual([]);
  });

  it('sends MCP servers as tools beside the default ones, with their headers, and the token budget', async () => {
    const fake = fakeFetch({ interactions: { int_1: done() }, streams: [{ events: turn.slice(-1) }] });
    const run = geminiManaged(base(fake.fetch, { network: ['pypi.org'] })).run(
      task({
        model: 'gemini-4-carbon',
        system: 'Be brief.',
        budget: { maxTokens: 5000 },
        mcpServers: [{ name: 'docs', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } }],
      } as Partial<AgentTask>),
    );
    await drain(run);
    expect((await run.result).ok).toBe(true);
    const [create] = fake.called('POST', '/interactions');
    expect(create.body).toMatchObject({
      tools: [
        { type: 'code_execution' },
        { type: 'google_search' },
        { type: 'url_context' },
        {
          type: 'mcp_server',
          name: 'docs',
          url: 'https://mcp.example.com/mcp',
          headers: { Authorization: 'Bearer t' },
        },
      ],
      agent_config: { type: 'antigravity', model: 'gemini-4-carbon', max_total_tokens: '5000' },
      environment: { type: 'remote', network: { allowlist: [{ domain: 'pypi.org' }, { domain: 'mcp.example.com' }] } },
    });
  });

  it('refuses an MCP server name the platform rejects', async () => {
    const fake = fakeFetch();
    const run = geminiManaged(base(fake.fetch)).run(
      task({ mcpServers: [{ name: 'Docs', url: 'https://mcp.example.com/mcp' }] }),
    );
    const result = await run.result;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/MCP server name 'Docs'/);
    expect(fake.called('POST', '/interactions')).toEqual([]);
  });

  it('mounts start files and a repository workspace as environment sources', async () => {
    const provider = geminiManagedProvider(base(fakeFetch().fetch));
    const fake = fakeFetch({ interactions: { int_1: done() } });
    const withFetch = geminiManagedProvider(base(fake.fetch));
    await withFetch.start({
      prompt: 'Go',
      workspace: 'https://github.com/acme/app',
      files: [
        { path: 'notes/plan.md', content: '# Plan' },
        { path: 'data.csv', content: new TextEncoder().encode('a,b\n') },
      ],
    });
    expect(fake.called('POST', '/interactions')[0].body?.environment).toEqual({
      type: 'remote',
      sources: [
        { type: 'repository', source: 'https://github.com/acme/app', target: '/workspace/app' },
        { type: 'inline', target: '/workspace/notes/plan.md', content: '# Plan' },
        { type: 'inline', target: '/workspace/data.csv', content: 'a,b\n' },
      ],
    });
    await expect(
      provider.start({ prompt: 'Go', files: [{ path: 'x.bin', content: new Uint8Array([0xff, 0xfe, 0x00]) }] }),
    ).rejects.toThrow(/binary/);
    await expect(provider.start({ prompt: 'Go', files: [{ path: '../x', content: '' }] })).rejects.toThrow(
      /leaves the workspace/,
    );
    await expect(provider.start({ prompt: 'Go', workspace: 'https://github.com/acme/app#dev' })).rejects.toThrow(
      /default branch/,
    );
    await expect(
      provider.start({ prompt: 'Go', workspace: 'env_9', files: [{ path: 'a', content: 'b' }] }),
    ).rejects.toThrow(/existing environment/);
  });

  it('reuses an environment given as the workspace and ignores a local path', async () => {
    const fake = fakeFetch({ interactions: { int_1: done() } });
    const provider = geminiManagedProvider(base(fake.fetch));
    await provider.start({ prompt: 'Go', workspace: 'env_9' });
    await provider.start({ prompt: 'Go', workspace: '/home/me/app' });
    expect(fake.called('POST', '/interactions').map((call) => call.body?.environment)).toEqual(['env_9', 'remote']);
  });

  it('resumes by chaining a new interaction in the same environment, counting only its own usage', async () => {
    const fake = fakeFetch({
      interactions: {
        int_0: done('int_0', { usage: { total_input_tokens: 50, total_output_tokens: 10, total_tokens: 60 } }),
        int_1: done('int_1', {
          previous_interaction_id: 'int_0',
          environment_id: 'env_7',
          usage: { total_input_tokens: 100, total_output_tokens: 20, total_tokens: 120 },
        }),
        int_2: done('int_2', {
          previous_interaction_id: 'int_1',
          environment_id: 'env_7',
          usage: { total_input_tokens: 30, total_output_tokens: 5, total_tokens: 35 },
          steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Again.' }] }],
        }),
      },
      created: { id: 'int_2' },
      streams: [{ events: turn.slice(-1) }],
    });
    const run = geminiManaged(base(fake.fetch)).run(task({ resume: 'int_1', budget: { maxTokens: 1000 } }));
    const events = await drain(run);
    const result = await run.result;
    const [create] = fake.called('POST', '/interactions');
    expect(create.body).toMatchObject({
      previous_interaction_id: 'int_1',
      environment: 'env_7',
      // The run's 1000 tokens; the session's earlier 180 are not this interaction's.
      agent_config: { type: 'antigravity', max_total_tokens: '1000' },
    });
    expect(events[0]).toEqual({ type: 'session', sessionId: 'int_2' });
    expect(result).toMatchObject({ ok: true, sessionId: 'int_2', text: 'Again.', usage: { totalTokens: 35 } });
    // Settled interactions are read once.
    expect(fake.called('GET', '/interactions/int_0').length).toBe(1);
  });

  it('refuses to resume an interaction that is still running', async () => {
    const fake = fakeFetch({ interactions: { int_1: done('int_1', { status: 'in_progress' }) } });
    const result = await geminiManaged(base(fake.fetch)).run(task({ resume: 'int_1' })).result;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/still running/);
  });

  it('reports the platform budget stop', async () => {
    const fake = fakeFetch({
      interactions: { int_1: done('int_1', { status: 'incomplete' }) },
      streams: [{ events: turn.slice(-1) }],
    });
    const run = geminiManaged(base(fake.fetch)).run(task({ budget: { maxTokens: 100 } }));
    await drain(run);
    const result = await run.result;
    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({ kind: 'budget' });
  });

  it('classifies a failed interaction by its error code', async () => {
    const fake = fakeFetch({
      interactions: {
        int_1: done('int_1', {
          status: 'failed',
          errors: [{ code: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' }],
        }),
      },
      streams: [{ events: [{ event_type: 'error', error: { message: 'Quota exceeded.' } }] }],
    });
    const run = geminiManaged(base(fake.fetch)).run(task());
    const events = await drain(run);
    const result = await run.result;
    expect(result).toMatchObject({ ok: false, error: 'Quota exceeded.', failure: { kind: 'quota' } });
    expect(events.some((e) => e.type === 'rate-limit')).toBe(true);
  });

  it('classifies an HTTP 429 on create as quota', async () => {
    const fake = fakeFetch({ createStatus: 429 });
    const result = await geminiManaged(base(fake.fetch)).run(task()).result;
    expect(result).toMatchObject({ ok: false, failure: { kind: 'quota' } });
    expect(result.error).toMatch(/HTTP 429: Resource exhausted/);
  });

  it('reconnects after a dropped stream from the last event, without repeating events', async () => {
    const fake = fakeFetch({
      interactions: { int_1: (reads) => (reads === 1 ? done('int_1', { status: 'in_progress' }) : done()) },
      streams: [{ events: turn.slice(0, 5), drop: true }, { events: turn.slice(5) }],
    });
    const run = geminiManaged(base(fake.fetch)).run(task());
    const events = await drain(run);
    const result = await run.result;
    const streams = fake.called('GET', 'stream=true');
    expect(streams.map((call) => new URL(call.url).searchParams.get('last_event_id'))).toEqual([null, 'evt_5']);
    // The step that began before the drop ends after it, with its whole text.
    expect(events.filter((e) => e.type === 'message')).toEqual([
      { type: 'message', text: 'Looking.' },
      { type: 'message', text: 'All fixed.' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('cancels the interaction when the run is aborted', async () => {
    const fake = fakeFetch({ interactions: { int_1: done('int_1', { status: 'in_progress' }) } });
    const run = geminiManaged(base(fake.fetch)).run(task());
    for await (const event of run) if (event.type === 'session') run.abort();
    const result = await run.result;
    expect(result.status).toBe('aborted');
    expect(fake.called('POST', '/interactions/int_1/cancel').length).toBe(1);
  });

  it('ends a turn that waits for the client as an answered turn', async () => {
    const fake = fakeFetch({
      interactions: { int_1: done('int_1', { status: 'requires_action' }) },
      streams: [{ events: turn.slice(-1) }],
    });
    const run = geminiManaged(base(fake.fetch)).run(task());
    await drain(run);
    expect(await run.result).toMatchObject({ ok: true, text: 'All fixed.' });
  });

  it('runs on Agent Platform with a bearer token', async () => {
    const fake = fakeFetch({ interactions: { int_1: done() } });
    const provider = geminiManagedProvider({
      fetch: fake.fetch,
      agentPlatform: { project: 'my-proj', accessToken: async () => 'ya29.token' },
    });
    await provider.start({ prompt: 'Go' });
    const [create] = fake.calls;
    expect(create.url).toBe('https://aiplatform.googleapis.com/v1beta1/projects/my-proj/locations/global/interactions');
    expect(create.headers.authorization).toBe('Bearer ya29.token');
    expect(create.headers['x-goog-api-key']).toBeUndefined();

    const custom = fakeFetch({ interactions: { int_1: done() } });
    await geminiManagedProvider(base(custom.fetch, { baseUrl: 'https://proxy.test/v1beta///' })).start({
      prompt: 'Go',
    });
    expect(custom.calls[0].url).toBe('https://proxy.test/v1beta/interactions');
  });

  it('refuses a model override for a saved agent, and effort or turn caps', async () => {
    const provider = geminiManagedProvider(base(fakeFetch().fetch, { agent: 'agents/my-agent' }));
    await expect(provider.start({ prompt: 'Go', model: 'gemini-4-carbon' })).rejects.toThrow(/fixed model/);
    await expect(provider.start({ prompt: 'Go', effort: 'high' })).rejects.toThrow(/effort/);
    await expect(provider.start({ prompt: 'Go', maxTurns: 3 })).rejects.toThrow(/maxTurns/);
  });

  it('reads a settled interaction with its chain usage, and null for one that is gone', async () => {
    const fake = fakeFetch({
      interactions: {
        int_0: done('int_0', { usage: { total_input_tokens: 10, total_output_tokens: 2, total_tokens: 12 } }),
        int_1: done('int_1', { previous_interaction_id: 'int_0' }),
      },
    });
    const provider = geminiManagedProvider(base(fake.fetch));
    expect(await provider.get('int_1')).toMatchObject({
      id: 'int_1',
      state: 'idle',
      stopReason: 'end-turn',
      text: 'All fixed.',
      model: 'gemini-4-hydrogen',
      usage: { inputTokens: 110, outputTokens: 27, totalTokens: 137 },
    });
    expect(await provider.get('int_missing')).toBeNull();
  });
});
