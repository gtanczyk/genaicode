import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { createMcpState, handleMcpMessage } from '../mcp-tools.js';
import type { AgentResult, AgentRun, CodingAgent } from '../types.js';
import { sessionSendMcpTool } from './send-mcp.js';
import type { SessionInfo, SessionSource } from './types.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-send-mcp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const env = { GENAICODE_HOME: root };
const session: SessionInfo = {
  source: 'store',
  agent: 'owner',
  id: '12345678-abc',
  cwd: root,
  where: 'local',
  state: 'waiting',
  updatedAt: 1,
  title: 'Knights concept',
};
const ok: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Noted.' };

function owner(result: Promise<AgentResult> = Promise.resolve(ok)) {
  const store: SessionSource = { name: 'store', where: 'local', list: async () => [{ ...session }] };
  return {
    name: 'owner',
    command: 'custom',
    sessions: store,
    capabilities: { resume: true },
    run: vi.fn<CodingAgent['run']>(
      (): AgentRun => ({
        abort() {},
        result,
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', result: await result };
        },
      }),
    ),
  } satisfies CodingAgent;
}

const info = { name: 'test', version: '1' };
const version = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
const asks = { elicitation: { form: {} } };
const tasks = { ...asks, extensions: { 'io.modelcontextprotocol/tasks': {} } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read loosely here
type Reply = { result?: Record<string, any>; error?: { code: number } };
let nextId = 1;

function server(agent: CodingAgent, taskWaitMs = 2_000) {
  const tools = [sessionSendMcpTool([agent], { env })];
  const state = createMcpState();
  const ask = async (method: string, params: Record<string, unknown>, capabilities: object = asks) =>
    (await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: nextId++,
        method,
        params: { ...params, _meta: { ...version, 'io.modelcontextprotocol/clientCapabilities': capabilities } },
      },
      tools,
      { ...info, taskWaitMs },
      state,
    )) as Reply;
  return {
    ask,
    call: (extra: Record<string, unknown>, capabilities?: object) =>
      ask('tools/call', { name: 'sessions_send', ...extra }, capabilities),
  };
}
const args = (text: string) => ({ arguments: { id: session.id, text } });

it('asks the user through the client, then sends and returns the answer', async () => {
  const agent = owner();
  const { call } = server(agent);

  const first = (await call(args('The bakery is done.'))).result!;
  expect(first.resultType).toBe('input_required');
  const request = first.inputRequests.confirm_send;
  expect(request.method).toBe('elicitation/create');
  expect(request.params.message).toContain('owner session "Knights concept"');
  expect(request.params.message).toContain('The bakery is done.');
  expect(agent.run).not.toHaveBeenCalled();

  const accept = { inputResponses: { confirm_send: { action: 'accept' } }, requestState: first.requestState };
  const sent = (await call({ ...args('The bakery is done.'), ...accept })).result!;
  expect(sent.resultType).toBe('complete');
  expect(sent.content[0].text).toContain('Sent.');
  expect(sent.content[0].text).toContain('Noted.');
  expect(agent.run).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: 'The bakery is done.', resume: session.id }),
  );

  // Allowed once: the next message to that session is not asked about.
  const next = (await call(args('And the mill.'))).result!;
  expect(next.content[0].text).toContain('Noted.');
  expect(agent.run).toHaveBeenCalledTimes(2);
});

it('sends nothing on a decline, a moved answer, or a client that cannot ask', async () => {
  const agent = owner();
  const { call } = server(agent);
  const first = (await call(args('Delete the branch.'))).result!;

  const declined = await call({
    ...args('Delete the branch.'),
    inputResponses: { confirm_send: { action: 'decline' } },
    requestState: first.requestState,
  });
  expect(declined.result!.content[0].text).toContain('did not allow');

  // An accept given for one text does not carry to another: it is asked again.
  const moved = await call({
    ...args('Delete everything.'),
    inputResponses: { confirm_send: { action: 'accept' } },
    requestState: first.requestState,
  });
  expect(moved.result!.resultType).toBe('input_required');

  // No state at all: an accept the server never asked for.
  const forged = await call({ ...args('Delete the branch.'), inputResponses: { confirm_send: { action: 'accept' } } });
  expect(forged.result!.resultType).toBe('input_required');

  const mute = await call(args('Hello'), {});
  expect(mute.result!.isError).toBe(true);
  expect(mute.result!.content[0].text).toContain('Nothing was sent');
  expect(agent.run).not.toHaveBeenCalled();
});

it('hands the answer over as a task to a client that takes tasks', async () => {
  let finish!: (result: AgentResult) => void;
  const agent = owner(new Promise<AgentResult>((resolve) => (finish = resolve)));
  const { ask, call } = server(agent);
  const first = (await call(args('Run the tests.'), tasks)).result!;
  const accept = { inputResponses: { confirm_send: { action: 'accept' } }, requestState: first.requestState };

  const started = (await call({ ...args('Run the tests.'), ...accept }, tasks)).result!;
  expect(started).toMatchObject({ resultType: 'task', status: 'working', ttlMs: null });
  expect(started.statusMessage).toContain('Sent.');
  const taskId = started.taskId as string;

  const working = (await ask('tasks/get', { taskId }, tasks)).result!;
  expect(working).toMatchObject({ resultType: 'complete', taskId, status: 'working' });
  expect(working.result).toBeUndefined();

  finish({ ...ok, text: 'All green.' });
  await vi.waitFor(async () => {
    const done = (await ask('tasks/get', { taskId }, tasks)).result!;
    expect(done.status).toBe('completed');
    expect(done.result.content[0].text).toBe('All green.');
  });
  expect((await ask('tasks/get', { taskId: 'nope' }, tasks)).error?.code).toBe(-32602);
});

it('answers with what it has when the other session takes long and the client takes no tasks', async () => {
  const agent = owner(new Promise<AgentResult>(() => undefined));
  const { call } = server(agent, 20);
  const first = (await call(args('Long job.'))).result!;
  const sent = (
    await call({
      ...args('Long job.'),
      inputResponses: { confirm_send: { action: 'accept' } },
      requestState: first.requestState,
    })
  ).result!;
  expect(sent.resultType).toBe('complete');
  expect(sent.content[0].text).toContain('read it later with sessions_read');
});
