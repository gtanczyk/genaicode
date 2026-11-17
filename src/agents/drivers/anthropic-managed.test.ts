import { describe, expect, it } from 'vitest';
import {
  anthropicManaged,
  anthropicManagedProvider,
  type AnthropicManagedAgentConfig,
  type AnthropicManagedClient,
  type AnthropicManagedEvent,
  type AnthropicManagedOptions,
  type AnthropicManagedSession,
} from './anthropic-managed.js';
import type { AgentEvent, AgentTask } from '../types.js';

type Step = AnthropicManagedEvent | (AnthropicManagedEvent & Record<string, unknown>) | (() => Promise<unknown>);

let clock = 0;
/** A persisted event: an id and a processing time, in order. */
function ev(type: string, extra: Record<string, unknown> = {}): AnthropicManagedEvent {
  clock += 1;
  return {
    type,
    id: `sevt_${clock}`,
    processed_at: new Date(Date.UTC(2026, 10, 17, 10, 0, clock)).toISOString(),
    ...extra,
  };
}

const idle = (type = 'end_turn', extra: Record<string, unknown> = {}) =>
  ev('session.status_idle', { stop_reason: { type }, stop_details: null, ...extra });

interface FakeOptions {
  streams?: Step[][];
  history?: AnthropicManagedEvent[];
  session?: Partial<AnthropicManagedSession>;
  agent?: Partial<AnthropicManagedAgentConfig>;
  /** Called with every `events.send` batch. */
  onSend?: (events: Record<string, unknown>[]) => void;
}

function fakeClient(options: FakeOptions = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const sent: Record<string, unknown>[] = [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  const session: AnthropicManagedSession = {
    id: 'sesn_1',
    status: 'running',
    created_at: '2026-11-17T10:00:00Z',
    agent: { model: { id: 'claude-opus-5-5' }, mcp_servers: [] },
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 50,
      list_cost: { amount: '12', currency: 'USD' },
    },
    ...options.session,
  };
  const agent: AnthropicManagedAgentConfig = {
    id: 'agent_1',
    version: 3,
    system: 'Be careful.',
    model: { id: 'claude-opus-5-5', effort: { type: 'high' }, speed: 'fast' },
    tools: [{ type: 'agent_toolset_20260401' }],
    mcp_servers: [],
    ...options.agent,
  };
  const streams = [...(options.streams ?? [])];
  let files = 0;
  const client: AnthropicManagedClient = {
    beta: {
      agents: {
        async retrieve(id, params) {
          record('agents.retrieve', id, params);
          return agent;
        },
      },
      sessions: {
        async create(params) {
          record('sessions.create', params);
          return session;
        },
        async retrieve(id) {
          record('sessions.retrieve', id);
          if (id !== session.id) throw Object.assign(new Error('Not found'), { status: 404 });
          return session;
        },
        async update(id, params) {
          record('sessions.update', id, params);
          return session;
        },
        async delete(id) {
          record('sessions.delete', id);
        },
        events: {
          async send(id, params) {
            const events = params.events as Record<string, unknown>[];
            record('events.send', id, events);
            sent.push(...events);
            options.onSend?.(events);
          },
          async stream(id, params, requestOptions) {
            record('events.stream', id, params);
            const steps = streams.shift() ?? [];
            const signal = requestOptions?.signal;
            // Like the SDK's stream, an aborted request ends the wait with an error.
            const aborted = new Promise<never>((_, reject) => {
              signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')), { once: true });
            });
            aborted.catch(() => undefined);
            return (async function* () {
              for (const step of steps) {
                if (typeof step === 'function') await Promise.race([step(), aborted]);
                else yield step;
              }
            })();
          },
          list(id, params) {
            record('events.list', id, params);
            const p = (params ?? {}) as { order?: string; 'created_at[gte]'?: string };
            let events = [...(options.history ?? [])];
            if (p['created_at[gte]']) events = events.filter((e) => (e.processed_at ?? '') >= p['created_at[gte]']!);
            if (p.order === 'desc') events.reverse();
            return (async function* () {
              yield* events;
            })();
          },
        },
      },
      vaults: {
        async create(params) {
          record('vaults.create', params);
          return { id: 'vlt_1' };
        },
        async delete(id) {
          record('vaults.delete', id);
        },
        credentials: {
          async create(vaultId, params) {
            record('vaults.credentials.create', vaultId, params);
          },
        },
      },
      files: {
        async upload(params) {
          record('files.upload', params.file.name, await params.file.text());
          return { id: `file_${++files}` };
        },
        async delete(id) {
          record('files.delete', id);
        },
      },
    },
  };
  const called = (method: string) => calls.filter((call) => call.method === method).map((call) => call.args);
  return { client, calls, sent, called, session };
}

const base = (
  client: AnthropicManagedClient,
  extra: Partial<AnthropicManagedOptions> = {},
): AnthropicManagedOptions => ({
  client,
  agent: 'agent_1',
  environment: 'env_1',
  pollIntervalMs: 1,
  ...extra,
});

async function drain(run: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

const task = (extra: Partial<AgentTask> = {}): AgentTask => ({ prompt: 'Fix the bug', cwd: '.', ...extra });

describe('anthropicManaged', () => {
  it('starts a session with the prompt, streams its events and ends on the idle turn', async () => {
    const fake = fakeClient({
      streams: [
        [
          ev('session.status_running'),
          { type: 'event_start', event: { type: 'agent.message', id: 'sevt_msg' } },
          {
            type: 'event_delta',
            event_id: 'sevt_msg',
            delta: { type: 'content_delta', content: { type: 'text', text: 'Do' } },
          },
          ev('agent.message', { content: [{ type: 'text', text: 'Done' }] }),
          ev('agent.tool_use', {
            id: 'sevt_tool',
            name: 'bash',
            input: { command: 'ls' },
            evaluated_permission: 'allow',
          }),
          ev('agent.tool_result', { tool_use_id: 'sevt_tool', content: [{ type: 'text', text: 'a.ts' }] }),
          ev('agent.message', { content: [{ type: 'text', text: 'All fixed.' }] }),
          idle(),
        ],
      ],
    });
    const run = anthropicManaged(base(fake.client)).run(task({ budget: { maxCostUsd: 2.5 } }));
    const events = await drain(run);
    const result = await run.result;

    const [create] = fake.called('sessions.create')[0] as [Record<string, unknown>];
    expect(create).toEqual({
      agent: 'agent_1',
      environment_id: 'env_1',
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: 'Fix the bug' }] }],
      budget: { type: 'limit', max_list_cost: { amount: '250', currency: 'USD' } },
    });
    expect(fake.called('events.stream')[0]).toEqual(['sesn_1', { event_deltas: ['agent.message'] }]);
    expect(events.filter((e) => e.type !== 'usage' && e.type !== 'done')).toEqual([
      { type: 'session', sessionId: 'sesn_1', model: 'claude-opus-5-5' },
      { type: 'text-delta', text: 'Do' },
      { type: 'message', text: 'Done' },
      { type: 'tool-start', id: 'sevt_tool', name: 'bash', input: { command: 'ls' } },
      { type: 'tool-end', id: 'sevt_tool', name: 'bash', output: 'a.ts' },
      { type: 'message', text: 'All fixed.' },
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      ok: true,
      sessionId: 'sesn_1',
      text: 'All fixed.',
      costUsd: 0.12,
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 },
    });
    // Nothing to stop: the turn ended by itself.
    expect(fake.sent).toEqual([]);
  });

  it('answers a tool confirmation through onApproval and reports it resolved once', async () => {
    let answered!: () => void;
    const answer = new Promise<void>((resolve) => (answered = resolve));
    const fake = fakeClient({
      onSend: (events) => {
        if (events.some((e) => e.type === 'user.tool_confirmation')) answered();
      },
      streams: [
        [
          ev('agent.tool_use', {
            id: 'sevt_ask',
            name: 'bash',
            input: { command: 'rm -rf dist' },
            evaluated_permission: 'ask',
          }),
          idle('requires_action', { stop_reason: { type: 'requires_action', event_ids: ['sevt_ask'] } }),
          () => answer,
          ev('user.tool_confirmation', { tool_use_id: 'sevt_ask', result: 'allow' }),
          ev('agent.tool_result', { tool_use_id: 'sevt_ask', content: [] }),
          idle(),
        ],
      ],
    });
    const requests: unknown[] = [];
    const run = anthropicManaged(base(fake.client)).run(
      task({
        permissions: { approval: 'ask' },
        onApproval: (request) => {
          requests.push(request);
          return 'approve';
        },
      }),
    );
    const events = await drain(run);
    expect(requests).toEqual([
      { id: 'sevt_ask', kind: 'command', summary: 'rm -rf dist', detail: { command: 'rm -rf dist' } },
    ]);
    expect(fake.sent).toEqual([{ type: 'user.tool_confirmation', tool_use_id: 'sevt_ask', result: 'allow' }]);
    expect(events.filter((e) => e.type === 'approval-resolved')).toHaveLength(1);
    expect((await run.result).ok).toBe(true);
  });

  it('sends a deny with its note', async () => {
    const fake = fakeClient();
    const provider = anthropicManagedProvider(base(fake.client));
    await provider.answer!('sesn_1', 'sevt_x', 'deny', 'Use the test db');
    await provider.answer!('sesn_1', 'sevt_y', 'approve', 'ignored');
    expect(fake.sent).toEqual([
      { type: 'user.tool_confirmation', tool_use_id: 'sevt_x', result: 'deny', deny_message: 'Use the test db' },
      { type: 'user.tool_confirmation', tool_use_id: 'sevt_y', result: 'allow' },
    ]);
  });

  it("reports the session's budget pause as a budget failure", async () => {
    const fake = fakeClient({
      streams: [
        [
          ev('session.usage', { usage: { input_tokens: 1, list_cost: { amount: '250', currency: 'USD' } } }),
          idle('budget_reached'),
        ],
      ],
    });
    const run = anthropicManaged(base(fake.client)).run(task({ budget: { maxCostUsd: 2.5 } }));
    const result = await run.result;
    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({ kind: 'budget' });
  });

  it('classifies a terminal rate-limit error as quota, so withFallback can move on', async () => {
    const fake = fakeClient({
      streams: [
        [
          ev('session.error', {
            error: { type: 'model_rate_limited_error', message: 'Slow down', retry_status: { type: 'retrying' } },
          }),
          ev('session.error', {
            error: { type: 'model_rate_limited_error', message: 'Slow down', retry_status: { type: 'exhausted' } },
          }),
          idle('retries_exhausted'),
        ],
      ],
    });
    const run = anthropicManaged(base(fake.client)).run(task());
    const events = await drain(run);
    const result = await run.result;
    expect(result).toMatchObject({
      ok: false,
      error: 'model_rate_limited_error: Slow down',
      failure: { kind: 'quota' },
    });
    expect(events.some((e) => e.type === 'rate-limit')).toBe(true);
  });

  it('reports a refusal as a failed turn with its explanation', async () => {
    const fake = fakeClient({
      streams: [[idle('refusal', { stop_details: { type: 'refusal', category: null, explanation: 'Not allowed' } })]],
    });
    const result = await anthropicManaged(base(fake.client)).run(task()).result;
    expect(result).toMatchObject({ ok: false, error: 'The model refused: Not allowed' });
  });

  it('resumes: sends the message (and system context) to the session and reads only events after it', async () => {
    const old = [ev('user.message'), ev('agent.message', { content: [{ type: 'text', text: 'Earlier' }] }), idle()];
    const fresh = [ev('agent.message', { content: [{ type: 'text', text: 'Again' }] }), idle()];
    const history = [...old];
    const fake = fakeClient({
      history,
      session: { status: 'idle', budget: { type: 'limit' } },
      onSend: () => history.push(...fresh),
      streams: [[]],
    });
    const run = anthropicManaged(base(fake.client)).run(task({ resume: 'sesn_1', budget: { maxCostUsd: 1 } }));
    const events = await drain(run);
    const result = await run.result;
    expect(fake.sent).toEqual([{ type: 'user.message', content: [{ type: 'text', text: 'Fix the bug' }] }]);
    // The cap covers the session: this run's dollar on top of the 12 cents it already spent.
    expect(fake.called('sessions.update')).toEqual([
      ['sesn_1', { budget: { type: 'limit', max_list_cost: { amount: '112', currency: 'USD' } } }],
    ]);
    expect(events.filter((e) => e.type === 'message')).toEqual([{ type: 'message', text: 'Again' }]);
    expect(result).toMatchObject({ ok: true, text: 'Again' });
    expect(fake.called('sessions.create')).toEqual([]);
  });

  it('appends system context on resume as a system.message after the user message', async () => {
    const fake = fakeClient({ session: { status: 'idle' }, history: [idle()] });
    const provider = anthropicManagedProvider(base(fake.client));
    const snapshot = await provider.start({ prompt: 'Next', resume: 'sesn_1', system: 'Be brief.' });
    expect(snapshot.state).toBe('queued');
    expect(fake.sent).toEqual([
      { type: 'user.message', content: [{ type: 'text', text: 'Next' }] },
      { type: 'system.message', content: [{ type: 'text', text: 'Be brief.' }] },
    ]);
  });

  it('refuses to change what a running session was created with', async () => {
    const fake = fakeClient({ session: { status: 'idle' } });
    const provider = anthropicManagedProvider(base(fake.client));
    await expect(provider.start({ prompt: 'x', resume: 'sesn_1', model: 'claude-sonnet-5-5' })).rejects.toThrow(
      /its model cannot change/,
    );
    await expect(
      provider.start({
        prompt: 'x',
        resume: 'sesn_1',
        mcpServers: [{ name: 'gh', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer t' } }],
      }),
    ).rejects.toThrow(/only when a session starts/);
    await expect(provider.start({ prompt: 'x', resume: 'sesn_9' })).rejects.toThrow(/does not exist/);
    expect(fake.sent).toEqual([]);
  });

  it('adds MCP servers to the agent for the session and keeps bearer tokens in a vault it frees after the run', async () => {
    const fake = fakeClient({
      agent: { mcp_servers: [{ type: 'url', name: 'linear', url: 'https://mcp.linear.app/mcp' }] },
      streams: [[idle()]],
    });
    const run = anthropicManaged(base(fake.client, { vaultIds: ['vlt_team'] })).run(
      task({
        mcpServers: [
          { name: 'linear', url: 'https://mcp.linear.app/mcp' },
          { name: 'game', url: 'https://www.example.com/mcp', headers: { authorization: 'Bearer secret' } },
        ],
      }),
    );
    const events = await drain(run);
    expect((await run.result).ok).toBe(true);
    expect(fake.called('vaults.credentials.create')).toEqual([
      [
        'vlt_1',
        {
          display_name: 'game',
          auth: { type: 'static_bearer', mcp_server_url: 'https://www.example.com/mcp', token: 'secret' },
        },
      ],
    ]);
    const [create] = fake.called('sessions.create')[0] as [Record<string, unknown>];
    expect(create.vault_ids).toEqual(['vlt_team', 'vlt_1']);
    expect(create.agent).toEqual({
      type: 'agent_with_overrides',
      id: 'agent_1',
      version: 3,
      mcp_servers: [
        { type: 'url', name: 'linear', url: 'https://mcp.linear.app/mcp' },
        { type: 'url', name: 'game', url: 'https://www.example.com/mcp' },
      ],
      tools: [{ type: 'agent_toolset_20260401' }, { type: 'mcp_toolset', mcp_server_name: 'game' }],
    });
    expect(fake.called('vaults.delete')).toEqual([['vlt_1']]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('refuses MCP headers it cannot vault', async () => {
    const fake = fakeClient();
    const run = anthropicManaged(base(fake.client)).run(
      task({ mcpServers: [{ name: 'x', url: 'https://x.example.com', headers: { 'X-Api-Key': 'k' } }] }),
    );
    const result = await run.result;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only as 'Authorization: Bearer/);
    expect(fake.called('sessions.create')).toEqual([]);
  });

  it('overrides model and effort, keeping the agent settings for the same model', async () => {
    const fake = fakeClient({ streams: [[idle()], [idle()]] });
    await anthropicManaged(base(fake.client, { agent: { id: 'agent_1', version: 3 } })).run(task({ effort: 'max' }))
      .result;
    await anthropicManaged(base(fake.client)).run(task({ model: 'claude-sonnet-5-5' })).result;
    const agents = fake
      .called('sessions.create')
      .map(([params]) => (params as { agent: Record<string, unknown> }).agent);
    expect(agents[0]).toMatchObject({ version: 3, model: { id: 'claude-opus-5-5', speed: 'fast', effort: 'max' } });
    // Another model: none of the agent's model settings carry over.
    expect(agents[1].model).toEqual({ id: 'claude-sonnet-5-5' });
    expect(fake.called('agents.retrieve')[0]).toEqual(['agent_1', { version: 3 }]);
  });

  it('appends task system instructions to the agent system prompt', async () => {
    const fake = fakeClient({ streams: [[idle()]] });
    const provider = anthropicManagedProvider(base(fake.client));
    await provider.start({ prompt: 'x', system: 'Reply in Polish.' });
    const [create] = fake.called('sessions.create')[0] as [{ agent: Record<string, unknown> }];
    expect(create.agent.system).toBe('Be careful.\n\nReply in Polish.');
  });

  it('mounts start files and a GitHub workspace', async () => {
    const fake = fakeClient({ streams: [[idle()]] });
    const provider = anthropicManagedProvider(base(fake.client, { githubToken: async () => 'ghp_x' }));
    const snapshot = await provider.start({
      prompt: 'x',
      workspace: 'https://github.com/acme/game.git#feature/a',
      files: [{ path: 'notes/plan.md', content: '# Plan' }],
    });
    expect(fake.called('files.upload')).toEqual([['plan.md', '# Plan']]);
    const [create] = fake.called('sessions.create')[0] as [Record<string, unknown>];
    expect(create.resources).toEqual([
      { type: 'file', file_id: 'file_1', mount_path: '/workspace/notes/plan.md' },
      {
        type: 'github_repository',
        url: 'https://github.com/acme/game',
        checkout: { type: 'branch', name: 'feature/a' },
        authorization_token: 'ghp_x',
      },
    ]);
    expect(snapshot.release).toEqual(['file:file_1']);
    await expect(provider.start({ prompt: 'x', files: [{ path: '../etc/passwd', content: '' }] })).rejects.toThrow(
      /leaves the workspace/,
    );
  });

  it('frees what it made when the session cannot be created', async () => {
    const fake = fakeClient();
    fake.client.beta.sessions.create = async () => {
      throw Object.assign(new Error('Too many requests'), { status: 429 });
    };
    const run = anthropicManaged(base(fake.client)).run(
      task({ mcpServers: [{ name: 'g', url: 'https://g.example.com', headers: { Authorization: 'Bearer t' } }] }),
    );
    const result = await run.result;
    expect(result.failure).toEqual({ kind: 'quota' });
    expect(fake.called('vaults.delete')).toEqual([['vlt_1']]);
  });

  it('runs custom tools with the given handlers and sends their results', async () => {
    let resulted!: () => void;
    const result = new Promise<void>((resolve) => (resulted = resolve));
    const fake = fakeClient({
      onSend: (events) => {
        if (events.some((e) => e.type === 'user.custom_tool_result')) resulted();
      },
      streams: [
        [
          ev('agent.custom_tool_use', { id: 'sevt_c', name: 'run_tests', input: { path: 'a' } }),
          ev('agent.custom_tool_use', { id: 'sevt_d', name: 'unknown', input: {} }),
          idle('requires_action'),
          () => result,
          ev('user.custom_tool_result', { custom_tool_use_id: 'sevt_c', content: [{ type: 'text', text: 'ok a' }] }),
          idle(),
        ],
      ],
    });
    const run = anthropicManaged(
      base(fake.client, {
        tools: { run_tests: async (input, { sessionId }) => `ok ${String(input.path)} ${sessionId}` },
      }),
    ).run(task());
    const events = await drain(run);
    expect(fake.sent).toEqual([
      {
        type: 'user.custom_tool_result',
        custom_tool_use_id: 'sevt_c',
        content: [{ type: 'text', text: 'ok a sesn_1' }],
      },
      {
        type: 'user.custom_tool_result',
        custom_tool_use_id: 'sevt_d',
        content: [{ type: 'text', text: "No handler for custom tool 'unknown'." }],
        is_error: true,
      },
    ]);
    expect(events).toContainEqual({ type: 'tool-end', id: 'sevt_c', name: 'run_tests', output: 'ok a' });
    expect((await run.result).ok).toBe(true);
  });

  it('interrupts the session when the run is aborted', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeClient({ streams: [[ev('session.status_running'), () => hold]] });
    const run = anthropicManaged(base(fake.client)).run(task());
    for await (const event of run) if (event.type === 'session') break;
    run.abort();
    const result = await run.result;
    release();
    expect(result.status).toBe('aborted');
    expect(fake.sent).toContainEqual({ type: 'user.interrupt' });
  });
});

describe('anthropicManaged after review', () => {
  it('stops an aborted run without waiting for a custom tool handler', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const fake = fakeClient({
      streams: [
        [ev('agent.custom_tool_use', { id: 'sevt_slow', name: 'slow', input: {} }), () => new Promise(() => {})],
      ],
    });
    const run = anthropicManaged(
      base(fake.client, {
        tools: {
          slow: () => {
            started();
            return new Promise<string>(() => {});
          },
        },
      }),
    ).run(task());
    await running;
    run.abort();
    const result = await run.result;
    expect(result.status).toBe('aborted');
    expect(fake.sent).toEqual([{ type: 'user.interrupt' }]);
  });

  it('does not run again a custom tool call the history already answered', async () => {
    const history = [
      ev('agent.custom_tool_use', { id: 'sevt_old', name: 'deploy', input: {} }),
      ev('user.custom_tool_result', { custom_tool_use_id: 'sevt_old', content: [{ type: 'text', text: 'done' }] }),
      idle(),
    ];
    const fake = fakeClient({ history, streams: [[]] });
    let calls = 0;
    const provider = anthropicManagedProvider(
      base(fake.client, {
        tools: {
          deploy: () => {
            calls += 1;
            return 'again';
          },
        },
      }),
    );
    const updates = [];
    for await (const update of provider.watch!('sesn_1', new AbortController().signal)) updates.push(update);
    expect(calls).toBe(0);
    expect(fake.sent).toEqual([]);
    expect(updates.flatMap((u) => u.events ?? [])).toContainEqual({
      type: 'tool-end',
      id: 'sevt_old',
      name: 'deploy',
      output: 'done',
    });
  });
});

describe('anthropicManagedProvider.get', () => {
  it('reads an idle session with the reason of its last turn', async () => {
    const fake = fakeClient({ session: { status: 'idle' }, history: [ev('user.message'), idle('end_turn')] });
    const snapshot = await anthropicManagedProvider(base(fake.client)).get('sesn_1');
    expect(snapshot).toMatchObject({ id: 'sesn_1', state: 'idle', stopReason: 'end-turn', costUsd: 0.12 });
  });

  it('reads a message sent after the last idle as a queued turn', async () => {
    const fake = fakeClient({ session: { status: 'idle' }, history: [idle('end_turn'), ev('user.message')] });
    expect((await anthropicManagedProvider(base(fake.client)).get('sesn_1'))?.state).toBe('queued');
  });

  it('reads a session that ended on an error as failed', async () => {
    const fake = fakeClient({
      session: { status: 'terminated' },
      history: [
        ev('session.error', {
          error: { type: 'model_overloaded_error', message: 'Busy', retry_status: { type: 'terminal' } },
        }),
        ev('session.status_terminated'),
      ],
    });
    expect(await anthropicManagedProvider(base(fake.client)).get('sesn_1')).toMatchObject({
      state: 'failed',
      error: 'model_overloaded_error: Busy',
      failure: { kind: 'unavailable' },
    });
  });

  it('reads the error that exhausted the retries of an idle turn', async () => {
    const fake = fakeClient({
      session: { status: 'idle' },
      history: [
        ev('user.message'),
        ev('session.status_running'),
        ev('session.error', {
          error: { type: 'billing_error', message: 'No credit', retry_status: { type: 'exhausted' } },
        }),
        idle('retries_exhausted'),
      ],
    });
    expect(await anthropicManagedProvider(base(fake.client)).get('sesn_1')).toMatchObject({
      state: 'idle',
      stopReason: 'error',
      error: 'billing_error: No credit',
      failure: { kind: 'quota' },
    });
  });

  it('returns null for a session that does not exist', async () => {
    const fake = fakeClient();
    expect(await anthropicManagedProvider(base(fake.client)).get('sesn_404')).toBeNull();
  });
});
