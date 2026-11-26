import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { runWeb } from './index.js';
import type { ChatSummary } from './hub.js';

it('keeps identical approval ids, project files and spent budgets with their chat across windows and restart', async () => {
  const base = join(process.cwd(), 'node_modules', '.genaicode-test');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'hub-'));
  const dirs = [join(root, 'a'), join(root, 'b')];
  for (const cwd of dirs) {
    await mkdir(cwd);
    await writeFile(join(cwd, 'README.md'), cwd);
  }
  const decisions = new Map<string, string>();
  const budgets: Array<number | undefined> = [];
  const agent: CodingAgent = {
    name: 'helper',
    command: process.execPath,
    capabilities: { approvals: true, resume: true },
    sessions: {
      name: 'helper',
      where: 'local',
      list: async () =>
        dirs.map((cwd, i) => ({
          id: 'native-' + i,
          source: 'helper',
          agent: 'helper',
          where: 'local',
          updatedAt: Date.now(),
          cwd,
          title: 'chat ' + i,
        })),
      read: async () => [],
    },
    run(task) {
      budgets.push(task.budget?.maxCostUsd);
      const signal = new AbortController();
      const result = (async (): Promise<AgentResult> => {
        if (task.prompt === 'ask') {
          const decision = await task.onApproval!(
            { id: 'same', kind: 'command', summary: 'read README.md' },
            signal.signal,
          );
          decisions.set(task.cwd, decision);
        }
        return {
          ok: true,
          status: 'completed',
          exitCode: 0,
          signal: null,
          sessionId: 'native-' + dirs.indexOf(task.cwd),
          costUsd: 9,
        };
      })();
      return {
        result,
        abort: () => signal.abort(),
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
          const done = await result;
          yield { type: 'session', sessionId: 'native-' + dirs.indexOf(task.cwd) };
          yield { type: 'usage', usage: {}, costUsd: 9 };
          yield { type: 'done', result: done };
        },
      };
    },
  };
  const launch = async (restoreChats = false) => {
    const stdin = new PassThrough();
    let address = '';
    const done = runWeb({
      agents: [agent],
      cwd: root,
      home: true,
      budget: { maxCostUsd: 10 },
      restoreChats,
      env: { HOME: root, GENAICODE_HOME: join(root, 'state') },
      openUrl: (url) => {
        address = url;
      },
      exitWithStdin: true,
      version: 'test',
      clientScript: '',
      assets: new Map(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: new PassThrough(),
    });
    await vi.waitFor(() => expect(address).toBeTruthy());
    const token = new URL(address).searchParams.get('token')!;
    const call = async (path: string, body?: unknown) =>
      fetch(new URL(path, address), {
        method: body ? 'POST' : 'GET',
        headers: { 'x-genaicode-token': token, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    const send = async (id: string, body: unknown) => (await call('/api/command?chat=' + id, body)).json();
    const rows = async (): Promise<ChatSummary[]> => (await (await call('/api/chats')).json()).chats;
    const view = async (id: string) => {
      const r = await call('/api/events?chat=' + id);
      const reader = r.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      await reader.cancel();
      return first;
    };
    return {
      call,
      send,
      rows,
      view,
      close: async () => {
        stdin.end();
        expect(await done).toBe(0);
      },
    };
  };
  let server = await launch();
  try {
    const first = (await server.rows())[0]!.chat;
    const ids: string[] = [];
    for (const cwd of dirs) {
      const { chat } = await (
        await server.call('/api/command', { chat: first, type: 'open', target: { type: 'project', cwd } })
      ).json();
      expect(chat).toEqual(expect.any(String));
      ids.push(chat);
      await server.send(chat, { type: 'submit', text: 'ask' });
    }
    await vi.waitFor(async () => expect((await server.rows()).filter((c) => c.approvals.length)).toHaveLength(2));
    expect(
      (
        await server.call('/api/command?chat=' + ids[0], {
          chat: ids[1],
          type: 'approve',
          id: 'same',
          decision: 'approve',
        })
      ).status,
    ).toBe(409);
    expect(await server.send(ids[1]!, { type: 'approve', id: 'same', decision: 'approve' })).toMatchObject({
      ok: true,
    });
    await vi.waitFor(() => expect([...decisions.keys()]).toEqual([dirs[1]]));
    expect(await server.send(ids[0]!, { type: 'approve', id: 'same', decision: 'deny' })).toMatchObject({ ok: true });
    for (const [i, id] of ids.entries()) {
      const file = await (await server.call('/api/file?path=README.md&chat=' + id)).json();
      expect(file.fullPath).toBe(join(dirs[i]!, 'README.md'));
    }
    await vi.waitFor(async () => expect((await server.rows()).filter((row) => row.turnInProgress)).toHaveLength(0));
    expect(await (await server.call('/api/command', { chat: ids[0], type: 'close' })).json()).toEqual({ ok: true });
    expect(await server.view(ids[0]!)).toContain(ids[0]);
    await server.close();
    server = await launch();
    for (const id of ids) expect((await server.rows()).some((row) => row.chat === id)).toBe(true);
    const initial = (await server.rows())[0]!.chat;
    expect(await server.send(initial, { type: 'continue', id: 'native-1', source: 'helper' })).toMatchObject({
      ok: true,
      chat: ids[1],
    });
    await server.send(ids[1]!, { type: 'submit', text: 'next' });
    await vi.waitFor(() => expect(budgets.at(-1)).toBe(1));
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
