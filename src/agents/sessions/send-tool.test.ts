import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { AgentResult, AgentRun, CodingAgent } from '../types.js';
import { createAgentSession } from '../session.js';
import { claimSession } from './send-lock.js';
import { SessionSendGate, sessionSendTool } from './send-tool.js';
import type { SessionInfo, SessionSource } from './types.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-send-tool-'));
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

function owner(rows: SessionInfo[]) {
  const store: SessionSource = { name: 'store', where: 'local', list: async () => rows };
  return {
    name: 'owner',
    command: 'custom',
    sessions: store,
    capabilities: { resume: true },
    run: vi.fn<CodingAgent['run']>(
      (): AgentRun => ({
        abort() {},
        result: Promise.resolve(ok),
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', result: ok };
        },
      }),
    ),
  } satisfies CodingAgent;
}

it('asks once per session, then sends without asking, and reports the answer', async () => {
  const agent = owner([{ ...session }]);
  const gate = new SessionSendGate();
  const tool = sessionSendTool([agent], gate, { env });
  const confirm = vi.fn(async () => true);
  const done = vi.fn();

  // Nobody to ask: nothing is sent.
  expect(await tool.call({ id: session.id, text: 'Hi' })).toContain('did not allow');
  expect(agent.run).not.toHaveBeenCalled();

  const detach = gate.attach({ confirm, done });
  expect(await tool.call({ id: session.id, text: 'The bakery is done.' })).toContain('owner · "Knights concept"');
  await gate.settled();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: session.id, cwd: root }), 'The bakery is done.');
  expect(agent.run).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: 'The bakery is done.', cwd: root, resume: session.id }),
  );
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }), { result: ok });

  await tool.call({ id: session.id, text: 'And the mill.' });
  await gate.settled();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(agent.run).toHaveBeenCalledTimes(2);

  // Detached, or another chat attached: what was allowed is gone.
  detach();
  expect(await tool.call({ id: session.id, text: 'Still there?' })).toContain('did not allow');
  const again = vi.fn(async () => true);
  gate.attach({ confirm: again });
  await tool.call({ id: session.id, text: 'New chat.' });
  await gate.settled();
  expect(again).toHaveBeenCalledTimes(1);
  expect(agent.run).toHaveBeenCalledTimes(3);

  // An unfinished session takes it too, not only one waiting for a reply.
  const unfinished = owner([{ ...session, state: 'unfinished' }]);
  const other = new SessionSendGate();
  other.attach({ confirm, done });
  await sessionSendTool([unfinished], other, { env }).call({ id: session.id, text: 'Pick it up.' });
  await other.settled();
  expect(unfinished.run).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenLastCalledWith(expect.objectContaining({ id: session.id }), { result: ok });
});

it('sends nothing when the person says no, or the session cannot take it', async () => {
  const rows = [{ ...session }];
  const agent = owner(rows);
  const gate = new SessionSendGate();
  const tool = sessionSendTool([agent], gate, { env });
  const confirm = vi.fn(async () => false);
  gate.attach({ confirm });
  expect(await tool.call({ id: session.id, text: 'Hi' })).toContain('did not allow');
  rows[0].cwd = 'relative/dir';
  await expect(tool.call({ id: session.id, text: 'Hi' })).rejects.toThrow(/working directory/);
  rows[0].cwd = root;
  await expect(tool.call({ id: 'nope', text: 'Hi' })).rejects.toThrow(/could not be found/);
  await expect(tool.call({ id: session.id, text: '\u001b[2Jhi' })).rejects.toThrow(/plain message/);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(agent.run).not.toHaveBeenCalled();
});

it('asks the person through the running turn, and auto-approve answers for them', async () => {
  const holding = () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const agent = {
      name: 'lead',
      command: 'custom',
      capabilities: {},
      run: (): AgentRun => ({
        abort() {},
        result: held.then(() => ok),
        async *[Symbol.asyncIterator]() {
          await held;
          yield { type: 'done', result: ok };
        },
      }),
    } satisfies CodingAgent;
    return { agent, release };
  };
  const { agent: lead, release } = holding();
  const chat = createAgentSession({ agent: lead, cwd: root });
  const request = { id: 'q1', kind: 'other' as const, summary: 'Send to owner' };
  expect(await chat.ask(request)).toBe('deny');
  chat.send('go');
  const answer = chat.ask(request);
  await vi.waitFor(() => expect(chat.get().approvals).toEqual([request]));
  expect(chat.approve('q1', 'approve')).toBe(true);
  expect(await answer).toBe('approve');
  const entry = () =>
    chat
      .get()
      .turns.at(-1)!
      .entries.find((e) => e.kind === 'approval');
  expect(entry()).toMatchObject({ kind: 'approval', decision: 'approve' });
  // Unanswered when the turn ends: denied.
  const late = chat.ask({ ...request, id: 'q2' });
  release();
  expect(await late).toBe('deny');
  chat.close();

  const busy = holding();
  const yes = createAgentSession({ agent: busy.agent, cwd: root, autoApprove: () => 'approve' });
  expect(await yes.ask(request)).toBe('deny');
  yes.send('go');
  await vi.waitFor(() => expect(yes.get().turns).toHaveLength(1));
  expect(await yes.ask(request)).toBe('approve');
  expect(yes.get().turns[0]!.entries.find((e) => e.kind === 'approval')).toMatchObject({
    decision: 'approve',
    automatic: true,
  });
  busy.release();
  yes.close();
});

it('queues a message for a session that is working and sends it when the turn ends', async () => {
  const rows: SessionInfo[] = [{ ...session, state: 'active', turnInProgress: true }];
  const agent = owner(rows);
  const gate = new SessionSendGate();
  const tool = sessionSendTool([agent], gate, { env, pollMs: 5 });
  const confirm = vi.fn(async () => true);
  const queued = vi.fn();
  const done = vi.fn();
  gate.attach({ confirm, queued, done });

  expect(await tool.call({ id: session.id, text: 'First.' })).toMatch(/^Queued for owner · "Knights concept"/);
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }), 'First.', { queued: true });
  expect(queued).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }), 'First.');
  // A second message waits behind the first, without asking again.
  expect(await tool.call({ id: session.id, text: 'Second.' })).toMatch(/^Queued/);
  expect(confirm).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(agent.run).not.toHaveBeenCalled();

  // The turn ends: both go, in order, one turn each.
  rows[0] = { ...session, state: 'waiting' };
  await gate.settled();
  expect(agent.run.mock.calls.map(([task]) => task.prompt)).toEqual(['First.', 'Second.']);
  expect(done).toHaveBeenCalledTimes(2);
  expect(done).toHaveBeenLastCalledWith(expect.objectContaining({ id: session.id }), { result: ok });
});

it('drops a queued message when the wait runs out or the chat closes', async () => {
  const rows: SessionInfo[] = [{ ...session, state: 'active' }];
  const agent = owner(rows);
  const gate = new SessionSendGate();
  const done = vi.fn();
  gate.attach({ confirm: async () => true, done });
  await sessionSendTool([agent], gate, { env, pollMs: 5, maxWaitMs: 20 }).call({ id: session.id, text: 'Late.' });
  await gate.settled();
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }), {
    error: expect.stringMatching(/still working.*not sent/),
  });

  const closing = new AbortController();
  const other = new SessionSendGate();
  const stopped = vi.fn();
  other.attach({ confirm: async () => true, done: stopped });
  await sessionSendTool([agent], other, { env, pollMs: 5, signal: closing.signal }).call({
    id: session.id,
    text: 'Never.',
  });
  closing.abort();
  await other.settled();
  expect(stopped).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }), { error: expect.any(String) });
  expect(agent.run).not.toHaveBeenCalled();

  // An archived session is not working: refused as before, nothing queued.
  rows[0] = { ...session, state: 'active', archived: true };
  await expect(sessionSendTool([agent], gate, { env }).call({ id: session.id, text: 'Hi' })).rejects.toThrow(
    /waiting or unfinished/,
  );
});

it('waits when another sender holds the session after the check, instead of dropping the message', async () => {
  const agent = owner([{ ...session }]);
  const gate = new SessionSendGate();
  const queued = vi.fn();
  const done = vi.fn();
  gate.attach({ confirm: async () => true, queued, done });
  const release = claimSession('store', session.id, env)!;
  expect(await sessionSendTool([agent], gate, { env, pollMs: 5 }).call({ id: session.id, text: 'Hold on.' })).toMatch(
    /^Sent/,
  );
  await vi.waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  expect(agent.run).not.toHaveBeenCalled();
  release();
  await gate.settled();
  expect(agent.run).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }), { result: ok });
});
