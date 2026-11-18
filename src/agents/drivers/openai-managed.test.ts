import { describe, expect, it } from 'vitest';
import {
  openaiManaged,
  openaiManagedProvider,
  type OpenAiManagedOptions,
  type OpenAiResponse,
  type OpenAiResponseItem,
} from './openai-managed.js';
import type { AgentEvent, AgentTask } from '../types.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

interface FakeOptions {
  /** What `POST /responses` returns. */
  created?: Partial<OpenAiResponse>;
  /** `GET /responses/{id}` by id; a function sees how often it was read. */
  responses?: Record<string, OpenAiResponse | ((reads: number) => OpenAiResponse)>;
  createStatus?: number;
}

function fakeFetch(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const reads = new Map<string, number>();
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, url, headers: { ...(init.headers as Record<string, string>) }, ...(body ? { body } : {}) });
    const path = new URL(url).pathname.replace(/^\/v1/, '');
    if (method === 'POST' && path === '/responses') {
      if (options.createStatus)
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
          status: options.createStatus,
        });
      return Response.json({ id: 'resp_1', status: 'queued', created_at: 1_763_400_000, ...options.created });
    }
    if (method === 'POST' && path.endsWith('/cancel')) return Response.json({ id: 'resp_1', status: 'cancelled' });
    if (method === 'DELETE') return Response.json({ id: 'resp_1', deleted: true });
    const id = decodeURIComponent(path.split('/')[2]);
    const found = options.responses?.[id];
    if (!found) return new Response('{"error":{"message":"not found"}}', { status: 404 });
    const count = (reads.get(id) ?? 0) + 1;
    reads.set(id, count);
    return Response.json(typeof found === 'function' ? found(count) : found);
  };
  const called = (method: string, pathPart: string) =>
    calls.filter((call) => call.method === method && call.url.includes(pathPart));
  return { fetch: impl as typeof fetch, calls, called };
}

const base = (fetch: typeof globalThis.fetch, extra: Partial<OpenAiManagedOptions> = {}): OpenAiManagedOptions => ({
  fetch,
  apiKey: 'sk-test',
  model: 'gpt-6.2-astra',
  pollIntervalMs: 1,
  ...extra,
});

async function drain(run: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

const task = (extra: Partial<AgentTask> = {}): AgentTask => ({ prompt: 'Fix the bug', cwd: '.', ...extra });

const items: OpenAiResponseItem[] = [
  { type: 'reasoning', id: 'rs_1', content: [] },
  {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Looking.' }],
  },
  {
    type: 'mcp_call',
    id: 'mcp_1',
    status: 'completed',
    server_label: 'docs',
    name: 'lookup',
    arguments: '{"q":"x"}',
    output: 'hit',
    error: null,
  },
  { type: 'shell_call', id: 'sh_1', call_id: 'call_1', status: 'completed', action: { commands: ['ls'] } },
  {
    type: 'shell_call_output',
    id: 'sho_1',
    call_id: 'call_1',
    output: [{ stdout: 'a.ts', stderr: '', outcome: { type: 'exit', exit_code: 0 } }],
  },
  { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { query: 'docs' } },
  {
    type: 'message',
    id: 'msg_2',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'All fixed.' }],
  },
];

const done = (id = 'resp_1', extra: Partial<OpenAiResponse> = {}): OpenAiResponse => ({
  id,
  status: 'completed',
  model: 'gpt-6.2-astra',
  created_at: 1_763_400_000,
  completed_at: 1_763_400_060,
  output: items,
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens_details: { reasoning_tokens: 5 },
  },
  ...extra,
});

describe('openaiManaged', () => {
  it('starts a background response with hosted tools and reports its items in order as they finish', async () => {
    const fake = fakeFetch({
      responses: {
        // First poll: the shell call is still running, so nothing past it is reported yet.
        resp_1: (reads) =>
          reads === 1
            ? done('resp_1', {
                status: 'in_progress',
                usage: null,
                output: [items[0], items[1], items[2], { ...items[3], status: 'in_progress' }, items[6]],
              })
            : done(),
      },
    });
    const run = openaiManaged(base(fake.fetch)).run(task({ effort: 'high', maxTurns: 20 }));
    const events = await drain(run);
    const result = await run.result;

    const [create] = fake.called('POST', '/responses');
    expect(create.url).toBe('https://api.openai.com/v1/responses');
    expect(create.headers.authorization).toBe('Bearer sk-test');
    expect(create.body).toEqual({
      model: 'gpt-6.2-astra',
      input: 'Fix the bug',
      background: true,
      store: true,
      tools: [{ type: 'shell', environment: { type: 'container_auto' } }, { type: 'web_search' }],
      reasoning: { effort: 'high' },
      max_tool_calls: 20,
    });
    expect(events.filter((e) => e.type !== 'usage' && e.type !== 'done')).toEqual([
      { type: 'session', sessionId: 'resp_1' },
      { type: 'message', text: 'Looking.' },
      { type: 'tool-start', id: 'mcp_1', name: 'docs.lookup', input: { q: 'x' } },
      { type: 'tool-end', id: 'mcp_1', name: 'docs.lookup', output: 'hit' },
      { type: 'tool-start', id: 'call_1', name: 'shell', input: { commands: ['ls'] } },
      { type: 'tool-end', id: 'call_1', name: 'shell', output: 'a.ts' },
      { type: 'tool-start', id: 'ws_1', name: 'web_search', input: { query: 'docs' } },
      { type: 'tool-end', id: 'ws_1', name: 'web_search' },
      { type: 'message', text: 'All fixed.' },
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      ok: true,
      sessionId: 'resp_1',
      text: 'All fixed.',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40 },
    });
  });

  it('sends MCP servers with their bearer token and no approvals, and refuses other headers', async () => {
    const fake = fakeFetch({ responses: { resp_1: done() } });
    const run = openaiManaged(base(fake.fetch, { network: ['pypi.org'] })).run(
      task({
        mcpServers: [{ name: 'docs', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t0k' } }],
      }),
    );
    await drain(run);
    expect((await run.result).ok).toBe(true);
    expect(fake.called('POST', '/responses')[0].body?.tools).toEqual([
      {
        type: 'shell',
        environment: { type: 'container_auto', network_policy: { type: 'allowlist', allowed_domains: ['pypi.org'] } },
      },
      { type: 'web_search' },
      {
        type: 'mcp',
        server_label: 'docs',
        server_url: 'https://mcp.example.com/mcp',
        require_approval: 'never',
        authorization: 't0k',
      },
    ]);

    const refused = await openaiManaged(base(fakeFetch().fetch)).run(
      task({ mcpServers: [{ name: 'docs', url: 'https://mcp.example.com/mcp', headers: { 'X-Key': 'k' } }] }),
    ).result;
    expect(refused.error).toMatch(/takes no headers besides Authorization/);
  });

  it('reuses a container given as the workspace, and passes custom tools as they are', async () => {
    const fake = fakeFetch({ responses: { resp_1: done() } });
    const provider = openaiManagedProvider(base(fake.fetch));
    await provider.start({ prompt: 'Go', workspace: 'cntr_9' });
    await openaiManagedProvider(
      base(fake.fetch, { tools: [{ type: 'code_interpreter', container: { type: 'auto' } }] }),
    ).start({
      prompt: 'Go',
    });
    expect(fake.called('POST', '/responses').map((call) => call.body?.tools)).toEqual([
      [{ type: 'shell', environment: { type: 'container_reference', container_id: 'cntr_9' } }, { type: 'web_search' }],
      [{ type: 'code_interpreter', container: { type: 'auto' } }],
    ]);
  });

  it('resumes by chaining a new response, counting only its own usage', async () => {
    const fake = fakeFetch({
      responses: {
        resp_0: done('resp_0', { usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 } }),
        resp_1: done('resp_1', {
          previous_response_id: 'resp_0',
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        }),
        resp_2: done('resp_2', {
          previous_response_id: 'resp_1',
          usage: { input_tokens: 30, output_tokens: 5, total_tokens: 35 },
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Again.' }] }],
        }),
      },
      created: { id: 'resp_2' },
    });
    const run = openaiManaged(base(fake.fetch)).run(task({ resume: 'resp_1' }));
    const events = await drain(run);
    const result = await run.result;
    expect(fake.called('POST', '/responses')[0].body).toMatchObject({ previous_response_id: 'resp_1' });
    expect(events[0]).toEqual({ type: 'session', sessionId: 'resp_2' });
    expect(result).toMatchObject({ ok: true, sessionId: 'resp_2', text: 'Again.', usage: { totalTokens: 35 } });
    expect(fake.called('GET', '/responses/resp_0').length).toBe(1);
  });

  it('refuses to resume a response that is still running', async () => {
    const fake = fakeFetch({ responses: { resp_1: done('resp_1', { status: 'in_progress' }) } });
    const result = await openaiManaged(base(fake.fetch)).run(task({ resume: 'resp_1' })).result;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/still running/);
  });

  it('reports items of a response that settled before create returned', async () => {
    const fake = fakeFetch({ created: done(), responses: { resp_1: done() } });
    const run = openaiManaged(base(fake.fetch)).run(task());
    const events = await drain(run);
    expect(events.filter((e) => e.type === 'tool-start').length).toBe(3);
    expect((await run.result).ok).toBe(true);
  });

  it('reports a token cap as a budget stop and a failed response by its error code', async () => {
    const capped = fakeFetch({
      responses: {
        resp_1: done('resp_1', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
      },
    });
    const run = openaiManaged(base(capped.fetch)).run(task());
    await drain(run);
    expect(await run.result).toMatchObject({ ok: false, failure: { kind: 'budget' } });

    const failed = fakeFetch({
      responses: {
        resp_1: done('resp_1', { status: 'failed', error: { code: 'rate_limit_exceeded', message: 'Slow down.' } }),
      },
    });
    const second = openaiManaged(base(failed.fetch)).run(task());
    const events = await drain(second);
    expect(await second.result).toMatchObject({ ok: false, error: 'Slow down.', failure: { kind: 'quota' } });
    expect(events.some((e) => e.type === 'rate-limit')).toBe(true);
  });

  it('fails a response cut short by a content filter', async () => {
    const fake = fakeFetch({
      responses: { resp_1: done('resp_1', { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }) },
    });
    const result = await openaiManaged(base(fake.fetch)).run(task()).result;
    expect(result).toMatchObject({ ok: false, error: 'Response incomplete: content_filter.' });
  });

  it('classifies an HTTP 429 on create as quota', async () => {
    const result = await openaiManaged(base(fakeFetch({ createStatus: 429 }).fetch)).run(task()).result;
    expect(result).toMatchObject({ ok: false, failure: { kind: 'quota' } });
    expect(result.error).toMatch(/HTTP 429: Rate limit reached/);
  });

  it('cancels the response when the run is aborted', async () => {
    const fake = fakeFetch({ responses: { resp_1: done('resp_1', { status: 'in_progress', output: [] }) } });
    const run = openaiManaged(base(fake.fetch)).run(task());
    for await (const event of run) if (event.type === 'session') run.abort();
    expect((await run.result).status).toBe('aborted');
    expect(fake.called('POST', '/responses/resp_1/cancel').length).toBe(1);
  });

  it('needs a model, and refuses files and extra arguments', async () => {
    const provider = openaiManagedProvider(base(fakeFetch().fetch, { model: undefined }));
    await expect(provider.start({ prompt: 'Go' })).rejects.toThrow(/needs a model/);
    await expect(provider.start({ prompt: 'Go', model: 'm', files: [{ path: 'a', content: 'b' }] })).rejects.toThrow(
      /files/,
    );
    await expect(provider.start({ prompt: 'Go', model: 'm', extraArgs: ['--x'] })).rejects.toThrow(/extra arguments/);
  });

  it('reads a settled response with its chain usage, and null for one that is gone', async () => {
    const fake = fakeFetch({
      responses: {
        resp_0: done('resp_0', { usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }),
        resp_1: done('resp_1', { previous_response_id: 'resp_0' }),
      },
    });
    const provider = openaiManagedProvider(base(fake.fetch));
    expect(await provider.get('resp_1')).toMatchObject({
      id: 'resp_1',
      state: 'idle',
      stopReason: 'end-turn',
      text: 'All fixed.',
      usage: { inputTokens: 110, outputTokens: 22, totalTokens: 132, details: { reasoningTokens: 5 } },
      startedAt: 1_763_400_000_000,
      endedAt: 1_763_400_060_000,
    });
    expect(await provider.get('resp_missing')).toBeNull();
  });
});
