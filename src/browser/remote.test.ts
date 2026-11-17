import { describe, expect, it } from 'vitest';
import { withFallback } from '../agents/failover.js';
import type { AgentEvent, ApprovalRequest } from '../agents/types.js';
import { createAgentBackend, type AgentBackendOptions } from '../backend/backend.js';
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

function served(steps: GenerationResult[], options: Partial<AgentBackendOptions> = {}) {
  const requests: GenerationRequest[] = [];
  const provider: ModelProvider = {
    name: 'fake',
    capabilities: { tools: true },
    async generate(request) {
      requests.push(request);
      const step = steps.shift();
      if (!step) throw new Error('the script ran out');
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
    const { fetch } = served([say('from the server')], {
      limiter: memoryLimiter({ perKeyPerDay: 1, globalPerDay: 1 }),
    });
    const agent = withFallback([
      remote({ url: '/api/assistant', fetch }),
      nano({ languageModel: fakeLanguageModel(['from nano']).factory }),
    ]);
    expect((await agent.run({ prompt: 'a', cwd: '' }).result).text).toBe('from the server');
    const run = agent.run({ prompt: 'b', cwd: '' });
    const events = await collect(run);
    expect((await run.result).text).toBe('from nano');
    expect(events.find((event) => event.type === 'failover')).toMatchObject({
      from: 'assistant',
      to: 'nano',
      failure: { kind: 'quota' },
    });
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
