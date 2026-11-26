import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { TowerInbox } from '../agents/sessions/tower.js';
import { scopedMcpServers } from '../agents/mcp-server.js';
import { SessionSendGate } from '../agents/sessions/send-tool.js';
import { ArtifactPool, createArtifactStore } from '../agents/artifacts.js';
import { runWeb } from './index.js';
import { ChatHub, type ChatSummary } from './hub.js';
import { createChatController } from './controller.js';
import { createProjectFiles } from './files.js';
import { createUploads } from './uploads.js';

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
    const env = { HOME: root, GENAICODE_HOME: join(root, 'state') };
    const done = runWeb({
      towerInbox: new TowerInbox([agent], env),
      agents: [agent],
      cwd: root,
      home: true,
      budget: { maxCostUsd: 10 },
      restoreChats,
      env,
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
    expect(
      await server.send(ids[0]!, { type: 'tower', id: 'turn:' + ids[1] + ':1:same', decision: 'approve' }),
    ).toMatchObject({
      ok: true,
    });
    await vi.waitFor(() => expect([...decisions.keys()]).toEqual([dirs[1]]));
    expect(await server.send(ids[0]!, { type: 'approve', id: 'same', decision: 'deny' })).toMatchObject({ ok: true });
    for (const [i, id] of ids.entries()) {
      const file = await (await server.call('/api/file?path=README.md&chat=' + id)).json();
      expect(file.fullPath).toBe(join(dirs[i]!, 'README.md'));
    }
    await vi.waitFor(async () => expect((await server.rows()).filter((row) => row.turnInProgress)).toHaveLength(0));
    const archived = [{ source: 'helper', id: 'native-0' }];
    await server.call('/api/archive', { sessions: archived, archived: true });
    expect((await server.rows()).find((row) => row.chat === ids[0])?.archived).toBe(true);
    await server.call('/api/archive', { sessions: archived, archived: false });
    expect((await server.rows()).find((row) => row.chat === ids[0])?.archived).toBeFalsy();
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
    const again = await server.send(initial, { type: 'continue', id: 'native-0', source: 'helper' });
    expect(again.chat).toBe(ids[0]);
    await server.send(again.chat, { type: 'submit', text: 'ask' });
    await vi.waitFor(async () =>
      expect((await server.rows()).find((row) => row.chat === again.chat)?.approvals.length).toBe(1),
    );
    await server.close();
    const runsBeforeRestore = budgets.length;
    server = await launch(true);
    expect((await server.rows()).find((row) => row.chat === again.chat)).toMatchObject({
      interrupted: true,
      glyph: 'err',
    });
    expect(await server.view(again.chat)).toContain('Stopped when the app quit.');
    expect(budgets.length).toBe(runsBeforeRestore);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('routes tools through separate capabilities on one listener and revokes only the chat that closes', async () => {
  const channels = scopedMcpServers();
  const open = (reply: string) =>
    channels.open({
      name: 'ask',
      tools: [
        {
          name: 'ask_user',
          description: 'Ask this chat',
          inputSchema: { type: 'object' },
          call: async () => reply,
        },
      ],
    });
  try {
    const [a, b] = await Promise.all([open('first'), open('second')]);
    const request = (server: typeof a) => {
      const spec = server.mcpServer;
      if (!('url' in spec)) throw new Error('Expected an HTTP server');
      return fetch(spec.url, {
        method: 'POST',
        headers: { ...spec.headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'ask_user', arguments: {} },
        }),
      });
    };
    if (!('url' in a.mcpServer && 'url' in b.mcpServer)) throw new Error('Expected HTTP scopes');
    expect(new URL(a.mcpServer.url).origin).toBe(new URL(b.mcpServer.url).origin);
    expect(a.mcpServer.url).not.toBe(b.mcpServer.url);
    expect((await (await request(a)).json()).result.content[0].text).toBe('first');
    await a.close();
    expect((await request(a)).ok).toBe(false);
    expect((await (await request(b)).json()).result.content[0].text).toBe('second');
  } finally {
    await channels.close();
  }
});

it('isolates send consent and artifact contents while sharing recipient order and the memory cap', async () => {
  const original = new SessionSendGate();
  const first = original.fork(),
    second = original.fork();
  const target = { source: 'local', id: 'recipient', agent: 'helper', cwd: process.cwd() };
  first.attach({ confirm: async () => true });
  second.attach({ confirm: async () => false });
  expect(await first.allow(target, 'one')).toBe(true);
  expect(await second.allow(target, 'two')).toBe(false);
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const order: string[] = [];
  const a = first.line(target, async () => {
    order.push('first');
    await held;
  });
  const b = second.line(target, async () => {
    order.push('second');
  });
  await Promise.resolve();
  expect(order).toEqual(['first']);
  finish();
  await Promise.all([a, b]);
  expect(order).toEqual(['first', 'second']);
  const pool = new ArtifactPool(10);
  const active = createArtifactStore({ cwd: target.cwd, pool, idle: () => false });
  const idle = createArtifactStore({ cwd: target.cwd, pool, idle: () => true });
  const old = await idle.publish({ title: 'old', content: 'abcdef' });
  expect(active.read(old.id)).toBeUndefined();
  const current = await active.publish({ title: 'new', content: '123456' });
  expect(idle.read(old.id)).toBeUndefined();
  expect(active.read(current.id)?.body.toString()).toBe('123456');
});

it('keeps shown chats and active shell groups, gives reconnects time and unloads the oldest idle controllers', async () => {
  const cwd = process.cwd();
  const hub = new ChatHub(async (chatId) => {
    const placeholder: CodingAgent = {
      name: 'placeholder',
      command: 'genaicode-test-uninstalled',
      capabilities: {},
      run() {
        throw new Error('Unexpected agent run');
      },
    };
    const controller = createChatController({ agents: [placeholder], allowNoAgent: true, cwd, chatId });
    return {
      controller,
      files: createProjectFiles(cwd),
      uploads: createUploads(cwd),
      async close() {
        controller.stop();
        controller.close();
        await controller.resourcesIdle();
      },
    };
  });
  const active: ReturnType<typeof createChatController>[] = [];
  try {
    await hub.load(hub.initial);
    for (let i = 0; i < 14; i++) await hub.load('idle-' + i);
    const hide = hub.shown('idle-0');
    await hub.evict(Date.now() + 25_000);
    expect(hub.chats.size).toBe(15);
    await hub.evict(Date.now() + 40_000);
    expect(hub.chats.has('idle-1')).toBe(false);
    expect(hub.chats.has('idle-0')).toBe(true);
    for (let i = 0; i < 4; i++) {
      const chat = await hub.load('shell-' + i);
      chat.controller.submit("!trap '' TERM; echo ready; while :; do sleep 30; done");
      active.push(chat.controller);
    }
    await vi.waitFor(() => expect(active.every((c) => c.get().notices.some((n) => n.text === 'ready'))).toBe(true), {
      timeout: 5000,
    });
    await hub.evict(Date.now() + 610_000);
    expect([...hub.chats.keys()]).toEqual([hub.initial, 'idle-0', 'shell-0', 'shell-1', 'shell-2', 'shell-3']);
    hide();
    await hub.evict(Date.now() + 610_000);
    expect(hub.chats.has('idle-0')).toBe(false);
  } finally {
    const start = Date.now();
    await hub.close();
    expect(active.every((c) => !c.hasShellProcesses())).toBe(true);
    expect(Date.now() - start).toBeLessThan(10_000);
  }
}, 20_000);
