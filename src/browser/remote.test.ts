import { describe, expect, it, vi } from 'vitest';
import { withFallback } from '../agents/failover.js';
import type { AgentEvent, ApprovalRequest } from '../agents/types.js';
import { createAgentBackend, type AgentBackendOptions } from '../backend/backend.js';
import type { TurnRequest } from '../backend/protocol.js';
import { memoryLimiter } from '../backend/limiter.js';
import { genaicode } from '../core/client.js';
import type { GenerationRequest, GenerationResult, ModelProvider } from '../core/types.js';
import { fakeLanguageModel } from './fake-model.js';
import { nano } from './nano.js';
import { createPageAgent } from './page-agent.js';
import { remote } from './remote.js';
import type { PageTool } from './tools.js';

const usage = { inputTokens: 10, outputTokens: 5 };
const say = (text: string): GenerationResult => ({ parts: [{ type: 'text', text }], usage });
const call = (name: string, args: Record<string, unknown>, id = `id-${name}`): GenerationResult => ({
  parts: [{ type: 'toolCall', toolCall: { id, name, arguments: args } }],
  usage,
});

function served(steps: (GenerationResult | Error)[], options: Partial<AgentBackendOptions> = {}) {
  const requests: GenerationRequest[] = [];
  const provider: ModelProvider = {
    name: 'fake',
    capabilities: { tools: true },
    async generate(request) {
      requests.push(request);
      const step = steps.shift();
      if (!step) throw new Error('the script ran out');
      if (step instanceof Error) throw step;
      return step;
    },
  };
  const backend = createAgentBackend({
    client: genaicode(provider),
    secret: 'test-secret-test-secret-test-secret!',
    public: true,
    pageTools: 'from-client',
    ...options,
  });
  // The page's fetch goes straight to the handler: same origin, no network.
  const fetch = (async (input: string, init?: RequestInit) =>
    backend.handle(new Request(`http://app.test${input}`, init))) as typeof globalThis.fetch;
  return { fetch, requests };
}

async function collect(run: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

describe('remote', () => {
  it('runs page tools the model calls, asking before a write one', async () => {
    let title = 'Shop';
    const tools: PageTool[] = [
      {
        name: 'rename',
        description: 'Change the page heading.',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        write: true,
        summary: (args) => `Rename to ${String(args.title)}`,
        run: ({ title: next }) => {
          title = String(next);
          return 'renamed';
        },
      },
    ];
    const { fetch, requests } = served([call('rename', { title: 'Store' }), say('Done, it is Store now.')]);
    const asked: ApprovalRequest[] = [];
    const agent = remote({ url: '/api/assistant', tools, fetch });
    const run = agent.run({
      prompt: 'call it Store',
      cwd: '',
      onApproval: (request) => {
        asked.push(request);
        return 'approve';
      },
    });
    const events = await collect(run);
    const result = await run.result;
    expect(result).toMatchObject({
      status: 'completed',
      ok: true,
      text: 'Done, it is Store now.',
      usage: { totalTokens: 30 },
    });
    expect(title).toBe('Store');
    expect(asked.map((request) => request.summary)).toEqual(['Rename to Store']);
    expect(events.map((event) => event.type)).toEqual([
      'session',
      'usage',
      'tool-start',
      'approval-request',
      'approval-resolved',
      'tool-end',
      'text-delta',
      'message',
      'usage',
      'done',
    ]);
    expect(requests[0]!.tools!.map((tool) => tool.name)).toEqual(['rename']);
  });

  it('cuts a long page tool output before posting it', async () => {
    const tools: PageTool[] = [{ name: 'read_page', description: 'The page text.', run: () => 'x'.repeat(3_000_000) }];
    const { fetch, requests } = served([call('read_page', {}), say('Long page.')]);
    const result = await remote({ url: '/api/assistant', tools, fetch }).run({ prompt: 'read it', cwd: '' }).result;
    expect(result).toMatchObject({ ok: true, text: 'Long page.' });
    expect(requests[1]!.prompt.at(-1)!.toolResults![0]!.content.length).toBeLessThan(9_000);
  });

  it('continues a conversation with resume', async () => {
    const { fetch, requests } = served([say('one'), say('two')]);
    const agent = remote({ url: '/api/assistant', fetch });
    const first = await agent.run({ prompt: 'hi', cwd: '' }).result;
    await agent.run({ prompt: 'again', cwd: '', resume: first.sessionId }).result;
    expect(requests[1]!.prompt.filter((item) => item.type !== 'systemPrompt').map((item) => item.type)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
  });

  it('declines a write tool in a read-only task without asking', async () => {
    let ran = false;
    const tools: PageTool[] = [{ name: 'wipe', description: 'Wipe.', write: true, run: () => ((ran = true), 'gone') }];
    const { fetch, requests } = served([call('wipe', {}), say('I may not.')]);
    const result = await remote({ url: '/api/assistant', tools, fetch }).run({
      prompt: 'wipe it',
      cwd: '',
      permissions: { sandbox: 'read-only' },
    }).result;
    expect(result.ok).toBe(true);
    expect(ran).toBe(false);
    expect(requests[1]!.prompt.at(-1)!.toolResults![0]).toMatchObject({
      isError: true,
      content: expect.stringMatching(/read-only/),
    });
  });

  it('fails over to the built-in model when the backend is over its allowance', async () => {
    const limiter = memoryLimiter({ globalPerDay: 2_000 });
    const { fetch } = served([say('from the server')], { limiter });
    const agent = withFallback([
      remote({ url: '/api/assistant', fetch }),
      nano({ languageModel: fakeLanguageModel(['from nano']).factory }),
    ]);
    expect((await agent.run({ prompt: 'a', cwd: '' }).result).text).toBe('from the server');
    await limiter.spend(undefined, 2_000, 0);
    const run = agent.run({ prompt: 'b', cwd: '' });
    const events = await collect(run);
    expect((await run.result).text).toBe('from nano');
    expect(events.find((event) => event.type === 'failover')).toMatchObject({
      from: 'assistant',
      to: 'nano',
      failure: { kind: 'quota' },
    });
  });

  it('tells the page what the agent that runs first takes, and forgets in every agent', async () => {
    const limiter = memoryLimiter({ globalPerDay: 2_000 });
    const { fetch } = served([], { limiter });
    const nanoModel = fakeLanguageModel(['from nano'], { media: ['image'] });
    const server = remote({ url: '/api/assistant', fetch });
    const builtIn = nano({ languageModel: nanoModel.factory, inputs: ['image'] });
    const agent = withFallback([server, builtIn]);
    // The server is open and takes text only: it runs first.
    expect(await agent.info!()).toEqual({ available: true, inputs: [] });
    await limiter.spend(undefined, 2_000, 0);
    // Over its allowance: the built-in model runs, and it takes images.
    expect(await agent.info!()).toEqual({ available: true, inputs: ['image'] });
    const page = createPageAgent({ agent });
    await page.refresh();
    expect(page.get().model).toMatchObject({ status: 'available', inputs: ['image'] });
    // A run starts where info() pointed: the image goes to the built-in model, not to the server.
    const photo = new File([new Uint8Array(8)], 'cat.png', { type: 'image/png' });
    const result = await agent.run({ prompt: 'what is it?', cwd: '', attachments: [photo] } as never).result;
    expect(result.text).toBe('from nano');
    expect(nanoModel.calls[0]!.media).toEqual([{ type: 'image', value: photo }]);

    // A model still to download is available: the run downloads it.
    const later = nano({ languageModel: fakeLanguageModel(['x'], { availability: 'downloadable' }).factory });
    expect(await later.info()).toMatchObject({ available: true });

    const unavailable = withFallback([server, nano({ languageModel: undefined as never })]);
    const info = await unavailable.info!();
    expect(info.available).toBe(false);
    expect(info.resetsAt).toBeGreaterThan(Date.now());

    const forgotten: (string | undefined)[] = [];
    const both = withFallback([
      { ...server, forget: (id?: string) => forgotten.push(`server ${id}`) },
      { ...builtIn, forget: (id?: string) => forgotten.push(`nano ${id}`) },
    ] as never);
    both.forget!('s-1');
    expect(forgotten).toEqual(['server s-1', 'nano s-1']);
  });

  it('goes back to a server that says it is available again before a model that cannot run', async () => {
    const { fetch, requests } = served([Object.assign(new Error('busy'), { status: 503 }), say('back')]);
    const agent = withFallback([remote({ url: '/api/assistant', fetch }), nano({ languageModel: undefined as never })]);
    expect((await agent.run({ prompt: 'a', cwd: '' }).result).ok).toBe(false);
    expect(await agent.info!()).toMatchObject({ available: true });
    expect((await agent.run({ prompt: 'b', cwd: '' }).result).text).toBe('back');
    expect(requests).toHaveLength(2);
  });

  it('starts with the agent whose inputs it offered when another could not be asked', async () => {
    const { fetch, requests } = served([say('from the server')]);
    let reachable = false;
    const flaky = (async (input: string, init?: RequestInit) => {
      if (!reachable && input.endsWith('/info')) throw new TypeError('Failed to fetch');
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    const nanoModel = fakeLanguageModel(['from nano'], { media: ['image'] });
    const agent = withFallback([
      remote({ url: '/api/assistant', fetch: flaky }),
      nano({ languageModel: nanoModel.factory, inputs: ['image'] }),
    ]);
    expect(await agent.info!()).toEqual({ available: true, inputs: ['image'] });
    reachable = true;
    expect((await agent.run({ prompt: 'a', cwd: '' }).result).text).toBe('from nano');
    expect(requests).toHaveLength(0);
  });

  it('does not hand a prompt to the fallback after a write ran', async () => {
    let count = 0;
    const tools: PageTool[] = [{ name: 'add', description: 'Add one.', write: true, run: () => String(++count) }];
    const { fetch } = served([call('add', {}), Object.assign(new Error('busy'), { status: 503 })]);
    const nanoModel = fakeLanguageModel(['from nano']);
    const agent = withFallback([
      remote({ url: '/api/assistant', tools, fetch }),
      nano({ languageModel: nanoModel.factory, tools }),
    ]);
    const result = await agent.run({ prompt: 'add one', cwd: '', onApproval: () => 'approve' }).result;
    expect(count).toBe(1);
    expect(result).toMatchObject({ status: 'failed', error: expect.stringMatching(/already changed something/) });
    expect(result.failure).toBeUndefined();
  });

  it('counts a failed step against the budget, so the fallback does not start', async () => {
    const broken: ModelProvider = {
      name: 'fake',
      capabilities: { tools: true },
      generate: () => Promise.reject(new Error('unused')),
      async *stream() {
        yield { type: 'usage', usage: { totalTokens: 30 } };
        throw Object.assign(new Error('busy'), { status: 503 });
      },
    };
    const turns: number[] = [];
    const { fetch } = served([], { client: genaicode(broken), onTurn: (report) => turns.push(report.tokens) });
    const nanoModel = fakeLanguageModel(['from nano']);
    const agent = withFallback([remote({ url: '/api/assistant', fetch }), nano({ languageModel: nanoModel.factory })]);
    const result = await agent.run({ prompt: 'hi', cwd: '', budget: { maxTokens: 20 } }).result;
    expect(turns).toEqual([30]);
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'budget' } });
    expect(result.usage?.totalTokens).toBe(30);
    expect(nanoModel.calls).toHaveLength(0);
  });

  it('asks before a page tool the server marks write, even if the page does not', async () => {
    const tools: PageTool[] = [{ name: 'wipe', description: 'Wipe.', run: () => 'gone' }];
    const { fetch } = served([call('wipe', {}), say('ok')], {
      pageTools: [{ name: 'wipe', description: 'Wipe.', write: true }],
    });
    const asked: string[] = [];
    await remote({ url: '/api/assistant', tools, fetch, sendTools: false }).run({
      prompt: 'wipe',
      cwd: '',
      onApproval: (request) => (asked.push(request.id), 'deny'),
    }).result;
    expect(asked).toEqual(['id-wipe']);
  });

  it('runs a class-based page tool the server marks write on its own instance', async () => {
    class Wipe {
      name = 'wipe';
      description = 'Wipe.';
      wiped = 0;
      validate() {}
      run() {
        return `wiped ${++this.wiped}`;
      }
    }
    const wipe = new Wipe();
    const { fetch } = served([call('wipe', {}), say('ok')], {
      pageTools: [{ name: 'wipe', description: 'Wipe.', write: true }],
    });
    const events = await collect(
      remote({ url: '/api/assistant', tools: [wipe], fetch, sendTools: false }).run({
        prompt: 'wipe',
        cwd: '',
        onApproval: () => 'approve',
      }),
    );
    expect(wipe.wiped).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool-end', name: 'wipe', output: 'wiped 1' }));
  });

  it('says the server is unavailable when it cannot be reached', async () => {
    const fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof globalThis.fetch;
    const result = await remote({ url: '/api/assistant', fetch }).run({ prompt: 'x', cwd: '' }).result;
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'unavailable' } });
  });

  it('says the server is unavailable when the stream breaks mid-turn', async () => {
    const fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(out) {
            out.enqueue(new TextEncoder().encode('{"type":"text-delta","text":"Hel"}\n'));
            out.error(new TypeError('terminated'));
          },
        }),
      )) as typeof globalThis.fetch;
    const result = await remote({ url: '/api/assistant', fetch }).run({ prompt: 'x', cwd: '' }).result;
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'unavailable' } });
  });

  it('stops while the page is still finding its tools', async () => {
    const { fetch } = served([]);
    const agent = remote({ url: '/api/assistant', fetch, tools: () => new Promise<PageTool[]>(() => {}) });
    const run = agent.run({ prompt: 'x', cwd: '' });
    run.abort();
    expect((await run.result).status).toBe('aborted');
    const timed = agent.run({ prompt: 'x', cwd: '', timeoutMs: 10 });
    expect((await timed.result).status).toBe('timeout');
  });

  it('stops while the page is still finding its request headers', async () => {
    const { fetch } = served([]);
    const agent = remote({
      url: '/api/assistant',
      fetch,
      headers: () => new Promise<Record<string, string>>(() => {}),
    });
    const run = agent.run({ prompt: 'x', cwd: '' });
    run.abort();
    expect((await run.result).status).toBe('aborted');
    expect((await agent.run({ prompt: 'x', cwd: '', timeoutMs: 10 }).result).status).toBe('timeout');
  });

  it('starts over when the conversation expired', async () => {
    let now = Date.now();
    const realNow = Date.now;
    const { fetch } = served([say('one'), say('two')], { limits: { stateTtlMs: 1_000 } });
    const agent = remote({ url: '/api/assistant', fetch });
    const first = await agent.run({ prompt: 'hi', cwd: '' }).result;
    Date.now = () => (now += 5_000);
    try {
      const second = await agent.run({ prompt: 'again', cwd: '', resume: first.sessionId }).result;
      expect(second).toMatchObject({ ok: true, text: 'two' });
    } finally {
      Date.now = realNow;
    }
  });

  it('tells a page agent what the backend takes, and forgets on reset', async () => {
    const { fetch } = served([say('hi')], { images: true });
    const agent = remote({ url: '/api/assistant', fetch });
    const forget = vi.spyOn(agent, 'forget');
    const page = createPageAgent({ agent });
    expect(page.get().model.status).toBe('checking');
    expect(await page.refresh()).toBe('available');
    expect(page.get().model.inputs).toEqual(['image']);
    page.send('hi');
    await new Promise<void>((resolve) => {
      const stop = page.subscribe((state) => {
        if (state.session.status === 'idle' && state.session.turns[0]?.result) {
          stop();
          resolve();
        }
      });
    });
    page.reset();
    expect(forget).toHaveBeenCalledWith(expect.stringMatching(/^remote-/));
  });

  it('shows a page agent as unavailable while the allowance is spent', async () => {
    const { fetch } = served([], { limiter: memoryLimiter({ perKeyPerDay: 0, globalPerDay: 0 }) });
    const page = createPageAgent({ agent: remote({ url: '/api/assistant', fetch }) });
    expect(await page.refresh()).toBe('unavailable');
  });

  it('keeps the kinds of tokens the server reports', async () => {
    const { fetch } = served([say('hi')]);
    const result = await remote({ url: '/api/assistant', fetch }).run({ prompt: 'x', cwd: '' }).result;
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('drops an expired token on a continuation too', async () => {
    let turn = 0;
    const tools: PageTool[] = [{ name: 'look', description: 'Look.', run: () => 'seen' }];
    const sent: TurnRequest[] = [];
    const ndjson = (lines: unknown[]) => new Response(lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
    const fetch = (async (_input: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init!.body)) as TurnRequest);
      turn++;
      if (turn === 1) return ndjson([{ type: 'turn-end', status: 'completed', state: 'old', text: 'one' }]);
      if (turn === 2) {
        return ndjson([
          { type: 'turn-end', status: 'waiting', state: 'waiting', calls: [{ id: 'c', name: 'look', input: {} }] },
        ]);
      }
      if (turn === 3) return new Response(JSON.stringify({ error: 'expired' }), { status: 409 });
      return ndjson([{ type: 'turn-end', status: 'completed', state: 'new', text: 'fresh' }]);
    }) as typeof globalThis.fetch;
    const agent = remote({ url: '/api/assistant', tools, fetch });
    const first = await agent.run({ prompt: 'a', cwd: '' }).result;
    const second = await agent.run({ prompt: 'b', cwd: '', resume: first.sessionId }).result;
    expect(second.ok).toBe(false);
    await agent.run({ prompt: 'c', cwd: '', resume: first.sessionId }).result;
    expect(sent[3]!.state).toBeUndefined();
  });

  it('drives a page agent', async () => {
    const { fetch } = served([say('Hello from the server.')]);
    const page = createPageAgent({ agent: remote({ url: '/api/assistant', fetch }) });
    page.send('hi');
    await new Promise<void>((resolve) => {
      const stop = page.subscribe((state) => {
        if (state.session.status === 'idle' && state.session.turns[0]?.result) {
          stop();
          resolve();
        }
      });
    });
    const turn = page.get().session.turns[0]!;
    expect(turn.entries).toEqual([{ kind: 'text', text: 'Hello from the server.', streaming: false }]);
    expect(turn.result).toMatchObject({ ok: true });
  });
});
