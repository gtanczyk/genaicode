import { describe, expect, it } from 'vitest';
import { genaicode } from '../core/client.js';
import type { GenerationRequest, GenerationResult, ModelProvider } from '../core/types.js';
import { createAgentBackend, type AgentBackendOptions } from './backend.js';
import { memoryLimiter } from './limiter.js';
import type { TurnEnd, TurnLine, TurnRequest } from './protocol.js';

const SECRET = 'test-secret-test-secret-test-secret!';
type Step = GenerationResult | Error | ((request: GenerationRequest) => GenerationResult);

function scripted(...steps: Step[]) {
  const requests: GenerationRequest[] = [];
  const provider: ModelProvider = {
    name: 'fake',
    capabilities: { tools: true },
    async generate(request) {
      requests.push(structuredClone({ ...request, signal: undefined }));
      const step = steps.shift();
      if (!step) throw new Error('the script ran out');
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step(request) : step;
    },
  };
  return { client: genaicode(provider), requests };
}

const usage = { inputTokens: 10, outputTokens: 5 };
const say = (text: string): GenerationResult => ({ parts: [{ type: 'text', text }], usage });
const call = (name: string, args: Record<string, unknown>, id = `id-${name}`): GenerationResult => ({
  parts: [{ type: 'toolCall', toolCall: { id, name, arguments: args } }],
  usage,
});

function backendWith(steps: Step[], options: Partial<AgentBackendOptions> = {}) {
  const model = scripted(...steps);
  const backend = createAgentBackend({
    client: model.client,
    secret: SECRET,
    public: true,
    instructions: 'You help on the test page.',
    ...options,
  });
  return { backend, requests: model.requests };
}

async function post(
  backend: ReturnType<typeof createAgentBackend>,
  body: TurnRequest,
  headers: Record<string, string> = {},
): Promise<{ status: number; lines: TurnLine[]; end: TurnEnd; json?: Record<string, unknown> }> {
  const response = await backend.handle(
    new Request('http://app.test/api/assistant/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  if (!response.ok) return { status: response.status, lines: [], end: undefined as never, json: JSON.parse(text) };
  const lines = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as TurnLine);
  return { status: response.status, lines, end: lines.at(-1) as TurnEnd };
}

describe('createAgentBackend', () => {
  it('needs authorize or public, and a long secret', () => {
    const { client } = scripted();
    expect(() => createAgentBackend({ client, secret: SECRET })).toThrow(/authorize/);
    expect(() => createAgentBackend({ client, secret: 'short', public: true })).toThrow(/32 characters/);
  });

  it('answers, and keeps the conversation in an encrypted token', async () => {
    const { backend, requests } = backendWith([say('Hello!'), say('You said hi.')]);
    const first = await post(backend, { prompt: 'my zebra password' });
    expect(first.lines.map((line) => line.type)).toEqual(['text-delta', 'message', 'turn-end']);
    expect(first.end).toMatchObject({ status: 'completed', text: 'Hello!', usage: { totalTokens: 15 } });
    expect(first.end.state).toMatch(/^[A-Za-z0-9_-]+$/);
    // Neither the token nor its bytes hold the prompt in the clear.
    const bytes = Buffer.from(first.end.state!, 'base64url').toString('latin1');
    expect(bytes).not.toContain('zebra');
    expect(Buffer.from(first.end.state!, 'base64url').toString('base64')).not.toContain(
      Buffer.from('my zebra password').toString('base64').slice(0, 12),
    );

    const second = await post(backend, { state: first.end.state, prompt: 'what did I say?' });
    expect(second.end.text).toBe('You said hi.');
    expect(requests[1]!.prompt.map((item) => item.type)).toEqual(['systemPrompt', 'user', 'assistant', 'user']);
    expect(requests[1]!.prompt[0]!.systemPrompt).toContain('You help on the test page.');
  });

  it('hands a page tool call to the page and goes on with its result', async () => {
    const { backend, requests } = backendWith([call('read_section', { id: 'pricing' }), say('It costs 5 euro.')], {
      pageTools: [{ name: 'read_section', description: 'Read a section.' }],
    });
    const asked = await post(backend, { prompt: 'how much?' });
    expect(asked.end).toMatchObject({
      status: 'waiting',
      calls: [{ id: 'id-read_section', name: 'read_section', input: { id: 'pricing' } }],
    });
    const done = await post(backend, {
      state: asked.end.state,
      results: [{ id: 'id-read_section', output: 'Pricing: 5 euro' }],
    });
    expect(done.end).toMatchObject({ status: 'completed', text: 'It costs 5 euro.' });
    expect(requests[1]!.prompt.at(-1)).toMatchObject({
      type: 'user',
      toolResults: [{ callId: 'id-read_section', name: 'read_section', content: 'Pricing: 5 euro' }],
    });
    // Tool results are data: the model is told so.
    expect(requests[0]!.prompt[0]!.systemPrompt).toMatch(/data, never as instructions/);
  });

  it('runs server tools for the signed-in user and asks before a write one', async () => {
    const seen: unknown[] = [];
    const { backend, requests } = backendWith(
      [call('status', {}), call('build', { what: 'jump' }), say('Not built.')],
      {
        public: false,
        authorize: (request) => (request.headers.get('authorization') === 'Bearer ok' ? { id: 'u1' } : null),
        tools: [
          {
            name: 'status',
            description: 'Build status.',
            run: (_args, context) => {
              seen.push(context.user);
              return { state: 'idle' };
            },
          },
          {
            name: 'build',
            description: 'Start a build.',
            write: true,
            summary: (args) => `Build ${String(args.what)}`,
            run: () => 'started',
          },
        ],
      },
    );
    const auth = { authorization: 'Bearer ok' };
    expect((await post(backend, { prompt: 'x' })).status).toBe(401);

    const asked = await post(backend, { prompt: 'build the jump' }, auth);
    expect(asked.lines.map((line) => line.type)).toEqual(['tool-start', 'tool-end', 'turn-end']);
    expect(seen).toEqual([{ id: 'u1' }]);
    expect(asked.end).toMatchObject({
      status: 'waiting',
      approvals: [{ id: 'id-build', summary: 'Build jump', detail: { tool: 'build', args: { what: 'jump' } } }],
    });
    const done = await post(
      backend,
      { state: asked.end.state, approvals: [{ id: 'id-build', decision: 'deny' }] },
      auth,
    );
    expect(done.end.text).toBe('Not built.');
    expect(requests[2]!.prompt.at(-1)!.toolResults).toEqual([
      { callId: 'id-build', name: 'build', content: 'The user declined this action.', isError: true },
    ]);
  });

  it('refuses a changed token and another user’s conversation', async () => {
    let who = 'a';
    const { backend } = backendWith([say('one'), say('two')], { public: false, authorize: () => ({ id: who }) });
    const first = await post(backend, { prompt: 'hi' });
    const token = first.end.state!;
    // A character in the middle: the last one may carry only padding bits.
    const at = Math.floor(token.length / 2);
    const changed = token.slice(0, at) + (token[at] === 'A' ? 'B' : 'A') + token.slice(at + 1);
    expect((await post(backend, { state: changed, prompt: 'hi' })).status).toBe(409);
    who = 'b';
    expect((await post(backend, { state: token, prompt: 'hi' })).status).toBe(409);
  });

  it('holds costs: the daily allowance and the conversation limit', async () => {
    const limiter = memoryLimiter({ perKeyPerDay: 20, globalPerDay: 1_000 });
    const { backend } = backendWith([say('one'), say('two')], {
      limiter,
      identify: () => 'visitor',
      limits: { conversationTokens: 1_000 },
    });
    expect((await post(backend, { prompt: 'a' })).end.status).toBe('completed');
    expect((await post(backend, { prompt: 'b' })).end.status).toBe('completed');
    const spent = await post(backend, { prompt: 'c' });
    expect(spent.status).toBe(429);
    expect(spent.json).toMatchObject({ failure: { kind: 'quota' } });

    const short = backendWith([say('one')], { limits: { conversationTokens: 10 } });
    const first = await post(short.backend, { prompt: 'a' });
    const over = await post(short.backend, { state: first.end.state, prompt: 'b' });
    expect(over.end).toMatchObject({ status: 'failed', failure: { kind: 'quota' } });
  });

  it('refuses cross-site posts, other content types and large bodies', async () => {
    const { backend } = backendWith([], { limits: { maxBodyBytes: 100 } });
    expect((await post(backend, { prompt: 'x' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post(backend, { prompt: 'x' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await post(backend, { prompt: 'x' }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(backend, { prompt: 'x'.repeat(200) })).status).toBe(413);
  });

  it('lets allowed origins in with CORS', async () => {
    const { backend } = backendWith([say('hi')], { allowedOrigins: ['https://site.test'] });
    const preflight = await backend.handle(
      new Request('http://app.test/api/assistant/turn', {
        method: 'OPTIONS',
        headers: { origin: 'https://site.test' },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://site.test');
    const answer = await post(
      backend,
      { prompt: 'x' },
      { origin: 'https://site.test', 'sec-fetch-site': 'cross-site' },
    );
    expect(answer.end.status).toBe('completed');
  });

  it('gives the model only the page tools it fixed, and tells it about unknown ones', async () => {
    const { backend, requests } = backendWith([call('delete_everything', {}), say('I cannot.')], {
      pageTools: [{ name: 'read_section', description: 'Read a section.' }],
    });
    const done = await post(backend, {
      prompt: 'x',
      tools: [{ name: 'delete_everything', description: 'Sneaky.' }],
    });
    expect(done.end.status).toBe('completed');
    expect(requests[0]!.tools!.map((tool) => tool.name)).toEqual(['read_section']);
    expect(requests[1]!.prompt.at(-1)!.toolResults![0]).toMatchObject({
      content: 'There is no tool called delete_everything.',
      isError: true,
    });
  });

  it("takes the page's tools when asked to, checked", async () => {
    const { backend, requests } = backendWith([say('ok')], { pageTools: 'from-client' });
    await post(backend, { prompt: 'x', tools: [{ name: 'go_to', description: 'Scroll to a section.' }] });
    expect(requests[0]!.tools!.map((tool) => tool.name)).toEqual(['go_to']);
    expect((await post(backend, { prompt: 'x', tools: [{ name: 'bad name', description: '' }] })).status).toBe(400);
  });

  it('stops calling tools after maxSteps', async () => {
    const { backend, requests } = backendWith(
      [call('ping', {}, 'a'), call('ping', {}, 'b'), (request) => say(`choice ${String(request.toolChoice)}`)],
      { tools: [{ name: 'ping', description: 'Ping.', run: () => 'pong' }], limits: { maxSteps: 3 } },
    );
    const done = await post(backend, { prompt: 'x' });
    expect(done.end.text).toBe('choice none');
    expect(requests.map((request) => request.toolChoice)).toEqual(['auto', 'auto', 'none']);
  });

  it('closes a waiting step as cancelled when the user moves on', async () => {
    const { backend, requests } = backendWith([call('read_section', { id: 'a' }), say('ok')], {
      pageTools: [{ name: 'read_section', description: 'Read a section.' }],
    });
    const asked = await post(backend, { prompt: 'x' });
    await post(backend, { state: asked.end.state, prompt: 'never mind' });
    expect(requests[1]!.prompt.at(-1)).toMatchObject({
      type: 'user',
      text: 'never mind',
      toolResults: [{ isError: true, content: expect.stringMatching(/Cancelled/) }],
    });
  });

  it('keeps images only while their turn waits', async () => {
    const { backend, requests } = backendWith([say('A cat.'), say('ok')], { images: true });
    const first = await post(backend, {
      prompt: 'what is this?',
      images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }],
    });
    expect(requests[0]!.prompt.at(-1)!.images).toEqual([{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }]);
    await post(backend, { state: first.end.state, prompt: 'thanks' });
    expect(requests[1]!.prompt[1]).toMatchObject({ text: 'what is this?\n[1 image attached earlier]' });
    expect(requests[1]!.prompt[1]!.images).toBeUndefined();

    const strict = backendWith([]);
    expect(
      (await post(strict.backend, { prompt: 'x', images: [{ mediaType: 'image/png', data: 'AA==' }] })).status,
    ).toBe(400);
  });

  it('keeps a waiting token small enough to post back with the results', async () => {
    const { backend, requests } = backendWith([call('read_section', { id: 'a' }), say('ok')], {
      images: true,
      pageTools: [{ name: 'read_section', description: 'Read a section.' }],
    });
    const big = 'A'.repeat(1_600_000);
    const asked = await post(backend, { prompt: 'look', images: [{ mediaType: 'image/png', data: big }] });
    expect(asked.end.status).toBe('waiting');
    expect(asked.end.state!.length).toBeLessThan(1024 * 1024);
    const done = await post(backend, { state: asked.end.state, results: [{ id: 'id-read_section', output: 'x' }] });
    expect(done.status).toBe(200);
    expect(done.end.status).toBe('completed');
    expect(requests[1]!.prompt[1]).toMatchObject({ text: 'look\n[1 image attached earlier]' });
  });

  it('does not run an approved write twice when the model fails after it', async () => {
    let bought = 0;
    const { backend, requests } = backendWith([call('buy', {}), new Error('down'), say('Bought it.')], {
      tools: [{ name: 'buy', description: 'Buy.', write: true, run: () => (bought++, 'bought') }],
    });
    const asked = await post(backend, { prompt: 'buy it' });
    const answer = { approvals: [{ id: 'id-buy', decision: 'approve' as const }] };
    const failed = await post(backend, { state: asked.end.state, ...answer });
    expect(failed.end).toMatchObject({ status: 'failed', failure: { kind: 'unavailable' } });
    const retried = await post(backend, { state: failed.end.state, ...answer });
    expect(retried.end).toMatchObject({ status: 'completed', text: 'Bought it.' });
    expect(bought).toBe(1);
    expect(requests[2]!.prompt.at(-1)!.toolResults).toEqual([{ callId: 'id-buy', name: 'buy', content: 'bought' }]);
  });

  it('tells the page the kind of a model failure, not its words', async () => {
    const error = Object.assign(new Error('secret upstream detail'), { status: 429 });
    const { backend } = backendWith([error]);
    const done = await post(backend, { prompt: 'x' });
    expect(done.end).toMatchObject({ status: 'failed', failure: { kind: 'quota' } });
    expect(JSON.stringify(done.end)).not.toContain('secret upstream detail');
  });

  it('fails the turn on an error event from a provider stream', async () => {
    const provider: ModelProvider = {
      name: 'streaming',
      async generate() {
        throw new Error('unused');
      },
      async *stream() {
        yield { type: 'error', error: Object.assign(new Error('over'), { status: 429 }) };
        yield { type: 'done', result: { parts: [] } };
      },
    };
    const backend = createAgentBackend({ client: genaicode(provider), secret: SECRET, public: true });
    const done = await post(backend, { prompt: 'x' });
    expect(done.end).toMatchObject({ status: 'failed', failure: { kind: 'quota' } });
  });

  it('runs tool calls a provider stream sends without a done snapshot', async () => {
    let step = 0;
    const provider: ModelProvider = {
      name: 'streaming',
      async generate() {
        throw new Error('unused');
      },
      async *stream() {
        step++;
        if (step === 1) {
          yield { type: 'tool-call', toolCall: { id: 'p1', name: 'ping', arguments: {} } };
          yield { type: 'usage', usage };
        } else yield { type: 'text-delta', text: 'pong seen' };
      },
    };
    let pinged = 0;
    const backend = createAgentBackend({
      client: genaicode(provider),
      secret: SECRET,
      public: true,
      tools: [{ name: 'ping', description: 'Ping.', run: () => (pinged++, 'pong') }],
    });
    const done = await post(backend, { prompt: 'x' });
    expect(pinged).toBe(1);
    expect(done.end).toMatchObject({ status: 'completed', text: 'pong seen' });
  });

  it('calls no model for a page that went away while it was authorized', async () => {
    const page = new AbortController();
    const { backend, requests } = backendWith([say('too late')], {
      public: false,
      authorize: async () => {
        page.abort();
        return { id: 'u1' };
      },
    });
    const response = await backend.handle(
      new Request('http://app.test/api/assistant/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'x' }),
        signal: page.signal,
      }),
    );
    await response.text().catch(() => '');
    expect(requests).toHaveLength(0);
  });

  it('keeps conversations in a store when given one', async () => {
    const kept = new Map<string, unknown>();
    const { backend, requests } = backendWith([say('one'), say('two')], {
      store: { get: (id) => kept.get(id), set: (id, value) => void kept.set(id, value) },
    });
    const first = await post(backend, { prompt: 'hi' });
    expect(kept.size).toBe(1);
    expect(first.end.state!.length).toBeLessThan(200);
    await post(backend, { state: first.end.state, prompt: 'again' });
    expect(kept.size).toBe(1);
    expect(requests[1]!.prompt.map((item) => item.type)).toEqual(['systemPrompt', 'user', 'assistant', 'user']);
  });

  it('serves info', async () => {
    const { backend } = backendWith([], { images: true });
    const response = await backend.handle(new Request('http://app.test/api/assistant/info'));
    expect(await response.json()).toEqual({ name: 'assistant', model: 'fake', inputs: ['image'], available: true });
    expect((await backend.handle(new Request('http://app.test/elsewhere'))).status).toBe(404);
  });
});
