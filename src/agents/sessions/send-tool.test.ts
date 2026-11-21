import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { AgentResult, AgentRun, CodingAgent } from '../types.js';
import { createAgentSession } from '../session.js';
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

  gate.attach({ confirm, done });
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
});

it('sends nothing when the person says no, or the session cannot take it', async () => {
  const rows = [{ ...session }];
  const agent = owner(rows);
  const gate = new SessionSendGate();
  const tool = sessionSendTool([agent], gate, { env });
  const confirm = vi.fn(async () => false);
  gate.attach({ confirm });
  expect(await tool.call({ id: session.id, text: 'Hi' })).toContain('did not allow');
  rows[0].turnInProgress = true;
  await expect(tool.call({ id: session.id, text: 'Hi' })).rejects.toThrow(/waiting or unfinished/);
  await expect(tool.call({ id: 'nope', text: 'Hi' })).rejects.toThrow(/could not be found/);
  await expect(tool.call({ id: session.id, text: '\u001b[2Jhi' })).rejects.toThrow(/plain message/);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(agent.run).not.toHaveBeenCalled();
});

it('asks the person through the running turn, and auto-approve answers for them', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const lead = {
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
  const chat = createAgentSession({ agent: lead, cwd: root });
  const request = { id: 'q1', kind: 'other' as const, summary: 'Send to owner' };
  expect(await chat.ask(request)).toBe('deny');
  chat.send('go');
  const answer = chat.ask(request);
  await vi.waitFor(() => expect(chat.get().approvals).toEqual([request]));
  expect(chat.approve('q1', 'approve')).toBe(true);
  expect(await answer).toBe('approve');
  // Unanswered when the turn ends: denied.
  const late = chat.ask({ ...request, id: 'q2' });
  release();
  expect(await late).toBe('deny');
  chat.close();

  const yes = createAgentSession({ agent: lead, cwd: root, autoApprove: () => 'approve' });
  expect(await yes.ask(request)).toBe('deny');
  yes.close();
});
