import { cp, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import type { AgentEvent, AgentResult, CodingAgent } from '../agents/types.js';
import { TowerInbox } from '../agents/sessions/tower.js';
import { scopedMcpServers } from '../agents/mcp-server.js';
import { SessionSendGate } from '../agents/sessions/send-tool.js';
import { ArtifactPool, createArtifactStore } from '../agents/artifacts.js';
import { chatStore } from './chat-store.js';
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
  const launch = async (restoreChats = false, stateDir = join(root, 'state')) => {
    const stdin = new PassThrough();
    let address = '';
    const env = { HOME: root, GENAICODE_HOME: stateDir };
    const stderr = new PassThrough();
    let warnings = '';
    stderr.on('data', (chunk) => {
      warnings += chunk;
    });
    const done = runWeb({
      towerInbox: new TowerInbox([agent], env),
      agents: [agent],
      cwd: root,
      home: true,
      budget: { maxCostUsd: 10 },
      maxChats: 2,
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
      stderr,
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
      warnings: () => warnings,
      unauthenticated: (path: string) => fetch(new URL(path, address)),
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
    expect((await server.call('/api/chats?chat=gone')).status).toBe(200);
    expect((await server.call('/api/file?chat=gone')).status).toBe(404);
    for (const path of ['/api/events', '/api/chats', '/api/file']) {
      const live = await server.unauthenticated(path + '?chat=' + first);
      const missing = await server.unauthenticated(path + '?chat=gone');
      expect([missing.status, await missing.text()]).toEqual([live.status, await live.text()]);
      expect(live.status).toBe(403);
    }
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
    const { chat: queued } = await server.send(first, { type: 'home-chat' });
    await server.send(queued, { type: 'submit', text: 'keep this for later' });
    expect(await (await server.call('/api/chats?running=1')).json()).toEqual({ running: 3 });
    const disk = chatStore({ GENAICODE_HOME: join(root, 'state') }, root, true);
    await vi.waitFor(
      async () => {
        expect((await disk.read(queued))?.drafts).toContain('keep this for later');
        expect((await disk.index())?.ids).toContain(queued);
      },
      { timeout: 5000 },
    );
    // Boot from the live checkpoint, without giving the original process a chance to shut down.
    const copy = join(root, 'crash');
    await cp(join(root, 'state'), copy, { recursive: true });
    const crash = chatStore({ GENAICODE_HOME: copy }, root, true);
    const previous = (await crash.read(ids[0]!))!;
    previous.session.agent = 'retired-team';
    previous.session.sessionId = 'foreign-session';
    await crash.save(previous);
    const broken = (await crash.read(ids[1]!))!;
    await crash.save({ ...broken, session: { ...broken.session, turns: JSON.parse('[null]') } });
    const catalog = (await crash.index())!;
    const stale = '12345678-1234-1234-1234-123456789012';
    const missing = {
      ...catalog.chats!.find((row) => row.chat === ids[1])!,
      chat: stale,
      id: 'native-1',
      source: 'helper',
    };
    await crash.saveIndex(catalog.ids, ids[0]!, [...catalog.chats!, missing]);
    const runsBefore = budgets.length;
    const recovered = await launch(true, copy);
    try {
      const view = await recovered.view(queued);
      expect(view).toContain('keep this for later');
      expect(recovered.warnings()).toContain('Skipping saved chat ' + ids[1]);
      expect((await recovered.rows()).find((row) => row.chat === queued)?.interrupted).toBe(true);
      expect((await recovered.rows()).find((row) => row.chat === ids[0])?.agent).toBe('helper');
      expect(await recovered.view(ids[0]!)).not.toContain('foreign-session');
      const opened = await recovered.send(ids[0]!, { type: 'continue', id: 'native-1', source: 'helper' });
      expect(opened).toMatchObject({ ok: true, chat: expect.any(String) });
      expect(opened.chat).not.toBe(stale);
      expect((await recovered.rows()).some((row) => row.chat === stale)).toBe(false);
      expect(budgets).toHaveLength(runsBefore);
    } finally {
      await recovered.close();
    }
    const fresh = await launch(false, copy);
    try {
      expect(await fresh.rows()).toHaveLength(1);
    } finally {
      await fresh.close();
    }
    await server.send(queued, { type: 'submit', text: `!"${process.execPath}" -e "setTimeout(() => {}, 30000)"` });
    await vi.waitFor(async () => expect(await server.view(queued)).toContain('"shells":1'));
    expect(await server.send(queued, { type: 'stop' })).toMatchObject({ draft: 'keep this for later' });
    await vi.waitFor(async () => expect(await server.view(queued)).toContain('"shells":0'));
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
      await server.send(ids[0]!, {
        type: 'tower',
        generation: 999,
        id: 'turn:' + ids[1] + ':1:same',
        decision: 'approve',
      }),
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
    server = await launch(true);
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
  const other = createArtifactStore({ cwd: target.cwd, pool, idle: () => false });
  await other.publish({ title: 'other', content: 'abc' });
  const latest = await active.publish({ title: 'latest', content: 'abcdefghijk' });
  expect(active.read(latest.id)?.body.toString()).toBe('abcdefghijk');
  expect(other.list()).toEqual([]);
});

const placeholder: CodingAgent = {
  name: 'placeholder',
  command: 'genaicode-test-uninstalled',
  capabilities: {},
  run() {
    throw new Error('Unexpected agent run');
  },
};

it('keeps shown chats and active shell groups, gives reconnects time and unloads the oldest idle controllers', async () => {
  const cwd = process.cwd();
  const hub = new ChatHub(async (chatId) => {
    const controller = createChatController({
      agents: [placeholder],
      allowNoAgent: true,
      cwd,
      chatId,
      artifactChannel: { store: createArtifactStore({ cwd }) },
    });
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
    expect(hub.summaries().some((row) => row.chat === 'idle-1')).toBe(false);
    const artifacts = (await hub.load('artifact-chat')).controller.artifacts!;
    const artifact = await artifacts.publish({ title: 'Report', content: 'still here' });
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
    expect([...hub.chats.keys()]).toEqual([
      hub.initial,
      'idle-0',
      'artifact-chat',
      'shell-0',
      'shell-1',
      'shell-2',
      'shell-3',
    ]);
    expect(hub.chats.get('artifact-chat')?.controller.artifacts?.read(artifact.id)?.body.toString()).toBe('still here');
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

it('saves all chats and the catalog before waiting for a slow or failing shutdown', async () => {
  const cwd = process.cwd();
  const saved = new Set<string>();
  const indexed = vi.fn(async () => {});
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const closing = vi.fn();
  const hub = new ChatHub(
    async (id) => {
      const controller = createChatController({
        agents: [placeholder],
        allowNoAgent: true,
        cwd,
        chatId: id,
      });
      return {
        controller,
        files: createProjectFiles(cwd),
        uploads: createUploads(cwd),
        async save() {
          saved.add(id);
        },
        async close() {
          controller.close();
          closing(id);
          if (id === 'slow') await blocked;
          else throw new Error('close failed');
        },
      };
    },
    2,
    'slow',
    undefined,
    indexed,
  );
  await hub.load('slow');
  await hub.load('failed');
  const result = expect(hub.close()).rejects.toThrow('Could not save or close every chat');
  try {
    await vi.waitFor(() => expect(closing).toHaveBeenCalledTimes(2));
    expect(indexed).toHaveBeenCalled();
    expect([...saved].sort()).toEqual(['failed', 'slow']);
  } finally {
    unblock();
    await result;
  }
});

it('coalesces mid-turn streaming checkpoints and avoids announcing project chats before switchChat resolves', async () => {
  const base = join(process.cwd(), 'node_modules', '.genaicode-test');
  await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(join(base, 'hub-perf-')));
  const homeDir = join(root, 'home');
  const projectDir = join(root, 'project');
  await mkdir(homeDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  let emit!: (text: string) => void;
  let finish!: () => void;
  const streamingAgent: CodingAgent = {
    name: 'streamer',
    command: process.execPath,
    capabilities: {},
    run() {
      const queue: AgentEvent[] = [];
      let wake: (() => void) | undefined;
      let done = false;
      emit = (text) => {
        queue.push({ type: 'text-delta', text });
        wake?.();
      };
      const result = new Promise<AgentResult>((resolve) => {
        finish = () => {
          done = true;
          const res: AgentResult = { ok: true, status: 'completed', exitCode: 0, signal: null };
          queue.push({ type: 'done', result: res });
          wake?.();
          resolve(res);
        };
      });
      return {
        result,
        abort: () => finish?.(),
        async *[Symbol.asyncIterator]() {
          while (!done || queue.length) {
            if (!queue.length) {
              await new Promise<void>((r) => {
                wake = r;
              });
              wake = undefined;
            }
            while (queue.length) yield queue.shift()!;
          }
        },
      };
    },
  };
  const saves = vi.fn(async () => {});
  const hub = new ChatHub(
    async (id) => {
      const controller = createChatController({
        agents: [streamingAgent],
        cwd: homeDir,
        home: true,
        chatId: id,
        env: { HOME: root, GENAICODE_HOME: join(root, 'state') },
        knownProjectDirs: () => [projectDir],
      });
      return {
        controller,
        files: createProjectFiles(homeDir),
        uploads: createUploads(homeDir),
        save: saves,
        async close() {
          controller.stop();
          controller.close();
          await controller.resourcesIdle();
        },
      };
    },
    4,
    'initial-chat',
    undefined,
    async () => {},
    undefined,
    true,
  );
  try {
    await hub.load(hub.initial);
    const seenCwds: string[] = [];
    const unsub = hub.subscribe(() => {
      for (const row of hub.summaries()) {
        if (row.chat !== hub.initial && row.cwd) seenCwds.push(row.cwd);
      }
    });
    const opened = await hub.open(hub.initial, { type: 'project', cwd: projectDir });
    unsub();
    expect(opened).toEqual(expect.any(String));
    // Never broadcast the temporary homeDir before openProject switched to projectDir.
    expect(seenCwds.length).toBeGreaterThan(0);
    expect(seenCwds.every((cwd) => cwd !== homeDir)).toBe(true);

    // Wait for initial open/turn-start checkpoint to settle, then verify streaming deltas coalesce.
    hub.chats.get(opened!)!.controller.submit('stream something');
    await vi.waitFor(() => expect(hub.running).toBe(1));
    await vi.waitFor(() => expect(saves).toHaveBeenCalled(), { timeout: 2000 });
    const countAfterStart = saves.mock.calls.length;

    emit('chunk 1 ');
    emit('chunk 2 ');
    emit('chunk 3 ');
    await new Promise((r) => setTimeout(r, 400));
    expect(saves.mock.calls.length).toBe(countAfterStart);

    // Finishing the turn preempts the 2 s streaming throttle and checkpoints promptly.
    finish();
    await vi.waitFor(() => expect(saves.mock.calls.length).toBeGreaterThan(countAfterStart), { timeout: 1500 });
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true });
  }
});
