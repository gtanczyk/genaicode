import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, AgentRun, CodingAgent } from '../types.js';
import { recordHook } from './live.js';
import { claimSession } from './send-lock.js';
import { sendSession } from './send.js';
import { TowerInbox } from './tower.js';
import { createAgentSession } from '../session.js';
import type { SessionInfo, SessionSource } from './types.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-send-'));
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
};
const ok: AgentResult = { status: 'completed', ok: true, exitCode: 0, signal: null, text: 'Ready.' };

function agentFor(rows: SessionInfo[] = [session], result = Promise.resolve(ok)) {
  const store: SessionSource = { name: 'store', where: 'local', list: async () => rows };
  return {
    name: 'owner',
    command: 'custom',
    sessions: store,
    capabilities: { resume: true, permissions: { sandbox: ['read-only'] } },
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

it('consumes the reviewed draft once, checks the project and activity again, and never retries a stale decision', async () => {
  const rows = [{ ...session }];
  const agent = agentFor(rows);
  const inbox = new TowerInbox([agent], env);
  const chat = createAgentSession({ agent, cwd: root });
  const propose = () =>
    inbox.proposalTool.call({ id: session.id, source: session.source, text: ' Review this exactly.\n ' });
  const first = () => inbox.view(chat.get()).items[0];
  try {
    await propose();
    const changed = first().id;
    rows[0].cwd = join(root, 'another-project');
    expect(await inbox.decide(chat, changed, 'send')).toBe(true);
    await vi.waitFor(() => expect(inbox.view(chat.get()).status).toContain('has changed'));
    expect(await inbox.decide(chat, changed, 'send')).toBe(false);
    rows[0].cwd = root;
    await propose();
    rows[0].turnInProgress = true;
    expect(await inbox.decide(chat, first().id, 'send')).toBe(true);
    await vi.waitFor(() => expect(inbox.view(chat.get()).items).toHaveLength(0));
    await expect(propose()).rejects.toThrow(/waiting/);
    delete rows[0].turnInProgress;
    await propose();
    const dismissed = first().id;
    expect(await inbox.decide(chat, dismissed, 'dismiss')).toBe(true);
    expect(await inbox.decide(chat, dismissed, 'send')).toBe(false);
    expect(agent.run).not.toHaveBeenCalled();
    await propose();
    const reviewed = first().id;
    expect(await Promise.all([inbox.decide(chat, reviewed, 'send'), inbox.decide(chat, reviewed, 'send')])).toEqual([
      true,
      false,
    ]);
    await vi.waitFor(() => expect(inbox.view(chat.get()).status).toContain('Message sent'));
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: ' Review this exactly.\n ', cwd: root, resume: session.id }),
    );
    await propose();
    const closed = first().id;
    inbox.close();
    expect(await inbox.decide(chat, closed, 'send')).toBe(false);
  } finally {
    inbox.close();
    chat.close();
  }
});

it('resolves a prefix and resumes the owner in the stored directory with the exact prompt and chosen permissions', async () => {
  const agent = agentFor([{ ...session, state: 'unfinished' }]);
  const events: AgentEvent[] = [];
  const prompt = '  Keep the first line.\nAnd the second. ';
  expect(
    await sendSession([agent], '12345678', prompt, {
      env,
      permissions: { sandbox: 'read-only' },
      onEvent: (e) => events.push(e),
    }),
  ).toBe(ok);
  expect(agent.run).toHaveBeenCalledWith(
    expect.objectContaining({ prompt, cwd: root, resume: session.id, env, permissions: { sandbox: 'read-only' } }),
  );
  expect(events).toEqual([{ type: 'done', result: ok }]);
});

it.each([
  { where: 'cloud' },
  { state: 'active' },
  { state: undefined },
  { waitingFor: 'approval' },
  { waitingFor: 'reply', turnInProgress: true },
  { cwd: undefined },
  { cwd: 'relative' },
  { cwd: join(root, 'gone') },
] satisfies Partial<SessionInfo>[])('refuses an ineligible session %o before starting the agent', async (change) => {
  const agent = agentFor([{ ...session, ...change }]);
  await expect(sendSession([agent], session.id, 'Go', { env })).rejects.toThrow();
  expect(agent.run).not.toHaveBeenCalled();
});

it('requires an exact id for the named source and a unique id for a CLI prefix', async () => {
  const agent = agentFor([session, { ...session, id: '12345678-other' }]);
  await expect(sendSession([agent], '12345678', 'go', { env })).rejects.toThrow(/sessions start/);
  await expect(sendSession([agentFor()], '12345678', 'go', { env, source: 'store' })).rejects.toThrow(
    /No local session/,
  );
  await expect(sendSession([agent], session.id, 'go', { env, source: 'elsewhere' })).rejects.toThrow(
    /No local session/,
  );
  await expect(sendSession([{ ...agent, capabilities: {} }], session.id, 'go', { env })).rejects.toThrow(
    /No driver can resume/,
  );
  expect(agent.run).not.toHaveBeenCalled();
});

it('checks the latest store and hook state just before sending', async () => {
  const agent = agentFor();
  agent.sessions.list = vi
    .fn()
    .mockResolvedValueOnce([session])
    .mockResolvedValueOnce([{ ...session, state: 'active' }]);
  await expect(sendSession([agent], session.id, 'go', { env })).rejects.toThrow(/waiting or unfinished/);
  const hooked = { ...session, id: 'hook-12345678' };
  const owner = agentFor([hooked]);
  const hook = (event: string) => recordHook('store', { session_id: hooked.id, hook_event_name: event }, { env });
  await hook('UserPromptSubmit');
  await expect(sendSession([owner], hooked.id, 'go', { env })).rejects.toThrow(/waiting or unfinished/);
  await hook('PermissionRequest');
  await expect(sendSession([owner], hooked.id, 'go', { env })).rejects.toThrow(/approval/);
  expect(owner.run).not.toHaveBeenCalled();
  await hook('Stop');
  await expect(sendSession([owner], hooked.id, 'go', { env })).resolves.toBe(ok);
});

it('keeps a second sender out until the first result settles, then releases the session on failure', async () => {
  let finish!: (value: AgentResult) => void;
  const first = agentFor(
    [session],
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const other = agentFor();
  const running = sendSession([first], '12345678', 'first', { env });
  await vi.waitFor(() => expect(first.run).toHaveBeenCalledOnce());
  await expect(sendSession([other], session.id, 'second', { env, source: 'store' })).rejects.toThrow(/already running/);
  expect(other.run).not.toHaveBeenCalled();
  finish({ ...ok, ok: false, status: 'failed' });
  expect((await running).ok).toBe(false);
  expect(await sendSession([other], session.id, 'next', { env })).toBe(ok);
  expect(other.run.mock.calls[0]![0].permissions).toBeUndefined();
});

it('reclaims a send after the process holding its claim has exited', async () => {
  const isolated = { GENAICODE_HOME: mkdtempSync(join(root, 'crashed-')) };
  claimSession(session.source, session.id, isolated);
  const dir = join(isolated.GENAICODE_HOME, 'sending');
  const lock = join(dir, readdirSync(dir)[0]!);
  const marker = readdirSync(lock)[0]!;
  const exited = spawnSync(process.execPath, ['-e', '']);
  expect(exited.status).toBe(0);
  renameSync(join(lock, marker), join(lock, marker.replace(String(process.pid), String(exited.pid))));
  expect(await sendSession([agentFor()], session.id, 'retry', { env: isolated })).toBe(ok);
  expect(readdirSync(dir)).toEqual([]);
});
