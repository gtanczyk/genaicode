import { PassThrough, Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { AgentCapabilities, AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from '../agents/types.js';
import { createEventMapper, promptText, serveAcp } from './server.js';

type Script = (task: AgentTask, emit: (event: AgentEvent) => void) => Promise<Partial<AgentResult> | void>;

/** An agent whose runs play `scripts` in order. Its command is node itself, so it counts as installed. */
function fakeAgent(
  name: string,
  scripts: Script[],
  capabilities: AgentCapabilities = { resume: true, approvals: true },
) {
  const tasks: AgentTask[] = [];
  const agent: CodingAgent = {
    name,
    command: process.execPath,
    capabilities,
    run(task): AgentRun {
      tasks.push(task);
      const queue: AgentEvent[] = [];
      let wake: (() => void) | undefined;
      const emit = (event: AgentEvent) => {
        queue.push(event);
        wake?.();
      };
      const abort = new AbortController();
      const script = scripts.shift() ?? (async () => {});
      const aborted = new Promise<Partial<AgentResult>>((resolve) =>
        abort.signal.addEventListener('abort', () => resolve({ status: 'aborted', ok: false }), { once: true }),
      );
      const result = Promise.race([script(task, emit), aborted]).then((partial) => {
        const done: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, ...(partial ?? {}) };
        emit({ type: 'done', result: done });
        return done;
      });
      return {
        result,
        abort: () => abort.abort(),
        async *[Symbol.asyncIterator]() {
          for (;;) {
            while (queue.length) {
              const event = queue.shift()!;
              yield event;
              if (event.type === 'done') return;
            }
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
      };
    },
  };
  return { agent, tasks };
}

/** Connect the SDK's own client to `serveAcp`, so every message is checked against the ACP schema. */
async function withClient<T>(
  agents: CodingAgent[],
  op: (
    cx: acp.ClientContext,
    seen: { updates: acp.SessionUpdate[]; permissions: acp.RequestPermissionRequest[] },
  ) => Promise<T>,
  options: {
    answer?: (request: acp.RequestPermissionRequest) => acp.RequestPermissionResponse;
    approveAll?: boolean;
  } = {},
): Promise<T> {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const served = serveAcp({
    agents,
    version: '9.9.9',
    input: toAgent,
    output: fromAgent,
    approveAll: options.approveAll,
  });
  const seen = { updates: [] as acp.SessionUpdate[], permissions: [] as acp.RequestPermissionRequest[] };
  const app = acp
    .client({ name: 'test' })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      seen.updates.push(params.update);
    })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
      seen.permissions.push(params);
      return options.answer?.(params) ?? { outcome: { outcome: 'selected', optionId: 'approve' } };
    });
  const stream = acp.ndJsonStream(
    Writable.toWeb(toAgent) as WritableStream<Uint8Array>,
    Readable.toWeb(fromAgent) as ReadableStream<Uint8Array>,
  );
  try {
    return await app.connectWith(stream, (cx) => op(cx, seen));
  } finally {
    toAgent.end();
    await served;
  }
}

describe('serveAcp', () => {
  it('initializes, runs a prompt and continues the agent session on the next one', async () => {
    const { agent, tasks } = fakeAgent('claude', [
      async (_task, emit) => {
        emit({ type: 'session', sessionId: 'vendor-1' });
        emit({ type: 'text-delta', text: 'Hel' });
        emit({ type: 'text-delta', text: 'lo' });
        emit({ type: 'message', text: 'Hello' });
        emit({ type: 'tool-start', id: 't1', name: 'Bash', input: { command: 'npm test' } });
        emit({ type: 'tool-end', id: 't1', output: 'ok' });
        return { sessionId: 'vendor-1' };
      },
      async () => ({ sessionId: 'vendor-1' }),
    ]);

    await withClient([agent], async (cx, seen) => {
      const init = await cx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION });
      expect(init.protocolVersion).toBe(1);
      expect(init.agentInfo?.name).toBe('genaicode');
      expect(init.agentCapabilities?.mcpCapabilities?.http).toBe(true);

      const session = await cx.request(acp.methods.agent.session.new, { cwd: '/tmp', mcpServers: [] });
      expect(session.configOptions?.map((option) => option.id)).toEqual(['agent', 'mode']);

      const first = await cx.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Run the tests' }],
      });
      expect(first.stopReason).toBe('end_turn');
      const text = seen.updates
        .filter((update) => update.sessionUpdate === 'agent_message_chunk')
        .map((update) => (update.content.type === 'text' ? update.content.text : ''))
        .join('');
      expect(text).toBe('Hello');
      const call = seen.updates.find((update) => update.sessionUpdate === 'tool_call');
      expect(call).toMatchObject({ toolCallId: 't1', title: 'Bash: npm test', kind: 'execute', status: 'in_progress' });
      expect(seen.updates.find((update) => update.sessionUpdate === 'tool_call_update')).toMatchObject({
        toolCallId: 't1',
        status: 'completed',
      });

      await cx.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Again' }],
      });
    });
    expect(tasks.map((task) => [task.prompt, task.cwd, task.resume])).toEqual([
      ['Run the tests', '/tmp', undefined],
      ['Again', '/tmp', 'vendor-1'],
    ]);
    expect(tasks[0]!.permissions).toBeUndefined();
  });

  it('starts each prompt fresh when the driver cannot resume', async () => {
    const { agent, tasks } = fakeAgent(
      'gemini',
      [async () => ({ sessionId: 'g-1' }), async () => ({ sessionId: 'g-2' })],
      { resume: false, approvals: false },
    );
    await withClient([agent], async (cx) => {
      await cx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION });
      const session = await cx.request(acp.methods.agent.session.new, { cwd: '/tmp', mcpServers: [] });
      for (const text of ['one', 'two']) {
        const result = await cx.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text }],
        });
        expect(result.stopReason).toBe('end_turn');
      }
    });
    expect(tasks.map((task) => task.resume)).toEqual([undefined, undefined]);
  });

  it("asks the host for the agent's permission prompts", async () => {
    const decisions: string[] = [];
    const { agent } = fakeAgent('claude', [
      async (task) => {
        decisions.push(await task.onApproval!({ id: 'a1', kind: 'command', summary: 'rm -rf build' }));
        decisions.push(await task.onApproval!({ id: 'a2', kind: 'file-change', summary: 'src/a.ts' }));
      },
    ]);
    await withClient(
      [agent],
      async (cx, seen) => {
        await cx.request(acp.methods.agent.initialize, { protocolVersion: 1 });
        const { sessionId } = await cx.request(acp.methods.agent.session.new, { cwd: '/tmp', mcpServers: [] });
        await cx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'go' }] });
        expect(seen.permissions.map((request) => [request.toolCall.title, request.toolCall.kind])).toEqual([
          ['rm -rf build', 'execute'],
          ['src/a.ts', 'edit'],
        ]);
      },
      {
        answer: (request) =>
          request.toolCall.kind === 'execute'
            ? { outcome: { outcome: 'selected', optionId: 'deny' } }
            : { outcome: { outcome: 'selected', optionId: 'approve' } },
      },
    );
    expect(decisions).toEqual(['deny', 'approve']);
  });

  it('stops the run on session/cancel and reports cancelled', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const { agent } = fakeAgent('claude', [
      async () => {
        started();
        await new Promise(() => {});
      },
    ]);
    await withClient([agent], async (cx) => {
      await cx.request(acp.methods.agent.initialize, { protocolVersion: 1 });
      const { sessionId } = await cx.request(acp.methods.agent.session.new, { cwd: '/tmp', mcpServers: [] });
      const reply = cx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'go' }] });
      await running;
      await cx.notify(acp.methods.agent.session.cancel, { sessionId });
      expect((await reply).stopReason).toBe('cancelled');
    });
  });

  it('switches agent, effort and approvals through config options', async () => {
    const claude = fakeAgent('claude', [async () => ({ sessionId: 'c-1' })], {
      resume: true,
      mcp: true,
      effort: ['low', 'high'],
    });
    const codex = fakeAgent('codex', [async () => {}], { resume: true, mcp: true });
    const gemini = fakeAgent('gemini', [], { resume: false });
    await withClient([gemini.agent, claude.agent, codex.agent], async (cx) => {
      await cx.request(acp.methods.agent.initialize, { protocolVersion: 1 });
      const { sessionId, configOptions } = await cx.request(acp.methods.agent.session.new, {
        cwd: '/tmp',
        mcpServers: [
          { type: 'http', name: 'my game', url: 'http://127.0.0.1:7777/mcp', headers: [{ name: 'x', value: 'y' }] },
          { type: 'http', name: 'my.game', url: 'http://127.0.0.1:7778/mcp', headers: [] },
        ],
      });
      expect(configOptions?.map((option) => option.id)).toEqual(['agent', 'effort', 'mode']);
      // gemini cannot attach MCP servers, so the session starts on claude and does not offer gemini.
      const agentOption = configOptions?.find((option) => option.id === 'agent') as
        | { currentValue: string; options: Array<{ value: string }> }
        | undefined;
      expect(agentOption?.currentValue).toBe('claude');
      expect(agentOption?.options.map((option) => option.value)).toEqual(['claude', 'codex']);
      await expect(
        cx.request(acp.methods.agent.session.setConfigOption, { sessionId, configId: 'agent', value: 'gemini' }),
      ).rejects.toThrow(/does not support MCP/);
      await cx.request(acp.methods.agent.session.setConfigOption, { sessionId, configId: 'effort', value: 'high' });
      await cx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: 'mode',
        value: 'auto-approve',
      });
      await cx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'one' }] });
      const switched = await cx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: 'agent',
        value: 'codex',
      });
      expect(switched.configOptions.map((option) => option.id)).toEqual(['agent', 'mode']);
      await cx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'two' }] });
      await expect(
        cx.request(acp.methods.agent.session.setConfigOption, { sessionId, configId: 'agent', value: 'nope' }),
      ).rejects.toThrow(/not installed/);
    });
    expect(claude.tasks[0]).toMatchObject({
      effort: 'high',
      mcpServers: [
        { name: 'my_game', url: 'http://127.0.0.1:7777/mcp', headers: { x: 'y' } },
        { name: 'my_game_2', url: 'http://127.0.0.1:7778/mcp', headers: {} },
      ],
    });
    // The new agent starts its own session.
    expect(codex.tasks[0]).toMatchObject({ prompt: 'two', resume: undefined, effort: undefined });
  });

  it('approves without asking the host in auto-approve mode', async () => {
    const decisions: string[] = [];
    const { agent } = fakeAgent('codex', [
      async (task) => {
        decisions.push(await task.onApproval!({ id: 'a1', kind: 'command', summary: 'npm test' }));
      },
    ]);
    await withClient(
      [agent],
      async (cx, seen) => {
        await cx.request(acp.methods.agent.initialize, { protocolVersion: 1 });
        const { sessionId, configOptions } = await cx.request(acp.methods.agent.session.new, {
          cwd: '/tmp',
          mcpServers: [],
        });
        expect(configOptions?.find((option) => option.id === 'mode')).toMatchObject({ currentValue: 'auto-approve' });
        await cx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'go' }] });
        expect(seen.permissions).toEqual([]);
      },
      { approveAll: true },
    );
    expect(decisions).toEqual(['approve']);
  });

  it('stops running prompts and returns when its signal aborts', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const { agent } = fakeAgent('claude', [
      async () => {
        started();
        await new Promise(() => {});
      },
    ]);
    const input = new PassThrough();
    const output = new PassThrough();
    const controller = new AbortController();
    const served = serveAcp({ agents: [agent], version: '1', input, output, signal: controller.signal });
    const send = (message: object) => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    const replies: Array<{ id?: number; result?: { sessionId?: string } }> = [];
    output.on('data', (chunk: Buffer) =>
      chunk
        .toString()
        .split('\n')
        .filter(Boolean)
        .forEach((line) => replies.push(JSON.parse(line))),
    );
    send({ id: 1, method: 'session/new', params: { cwd: '/tmp', mcpServers: [] } });
    await expect.poll(() => replies.find((reply) => reply.id === 1)).toBeTruthy();
    const sessionId = replies.find((reply) => reply.id === 1)!.result!.sessionId;
    send({ id: 2, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'go' }] } });
    await running;
    controller.abort(); // the input stays open, as with Ctrl-C
    await served;
  });

  it('returns a failed run as an error', async () => {
    const { agent } = fakeAgent('claude', [async () => ({ status: 'failed', ok: false, error: 'not logged in' })]);
    await withClient([agent], async (cx) => {
      await cx.request(acp.methods.agent.initialize, { protocolVersion: 1 });
      const { sessionId } = await cx.request(acp.methods.agent.session.new, { cwd: '/tmp', mcpServers: [] });
      await expect(
        cx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'go' }] }),
      ).rejects.toThrow(/not logged in/);
    });
  });

  it('refuses session/new when no agent is installed', async () => {
    const missing: CodingAgent = { ...fakeAgent('claude', []).agent, command: '/nonexistent/claude' };
    await withClient([missing], async (cx) => {
      await cx.request(acp.methods.agent.initialize, { protocolVersion: 1 });
      await expect(cx.request(acp.methods.agent.session.new, { cwd: '/tmp', mcpServers: [] })).rejects.toThrow(
        /No supported agent CLI/,
      );
    });
  });
});

describe('promptText', () => {
  it('turns links and embedded files into text', () => {
    expect(
      promptText([
        { type: 'text', text: 'Look at' },
        { type: 'resource_link', name: 'a.ts', uri: 'file:///work/a.ts' },
        { type: 'resource', resource: { uri: 'file:///work/b.ts', text: 'const b = 1;' } },
      ]),
    ).toBe('Look at\n@/work/a.ts\n/work/b.ts:\n```\nconst b = 1;\n```');
    expect(() => promptText([{ type: 'image', data: '', mimeType: 'image/png' }])).toThrow(/Unsupported/);
  });
});

describe('createEventMapper', () => {
  it('sends a final message once, after or without streaming', () => {
    const map = createEventMapper();
    const texts = (events: AgentEvent[]) =>
      events.flatMap(map).map((update) => (update.content as { text: string } | undefined)?.text);
    expect(texts([{ type: 'message', text: 'Plain' }])).toEqual(['Plain']);
    expect(
      texts([
        { type: 'text-delta', text: 'Str' },
        { type: 'message', text: 'Streamed!' },
      ]),
    ).toEqual(['Str', 'eamed!']);
  });

  it('reconciles a final message that spans tool calls', () => {
    const run = (events: AgentEvent[]) =>
      events
        .flatMap(createEventMapper())
        .map((update) => (update.content as { text?: string } | undefined)?.text)
        .filter(Boolean)
        .join('');
    const tool: AgentEvent = { type: 'tool-start', id: 't', name: 'Bash' };
    expect(run([{ type: 'text-delta', text: 'Fixing ' }, tool, { type: 'message', text: 'Fixing complete.' }])).toBe(
      'Fixing complete.',
    );
    expect(
      run([
        { type: 'text-delta', text: 'Fixing ' },
        tool,
        { type: 'text-delta', text: 'done.' },
        { type: 'message', text: 'Fixing done. All tests passed.' },
      ]),
    ).toBe('Fixing done. All tests passed.');
  });

  it('reports changed files as a completed edit', () => {
    expect(createEventMapper()({ type: 'file-change', paths: ['a.ts'] })).toEqual([
      expect.objectContaining({
        sessionUpdate: 'tool_call',
        kind: 'edit',
        status: 'completed',
        locations: [{ path: 'a.ts' }],
      }),
    ]);
  });
});
