import { startLocalMcpServer } from './mcp-server.js';
import * as protocol from './mcp-tools.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createMcpState,
  handleMcpMessage,
  McpInputRequired,
  parseSkill,
  skillText,
  type McpSkill,
  type McpTool,
} from './mcp-tools.js';

const tools: McpTool[] = [
  {
    name: 'echo',
    description: 'Says it back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    call: async (args) => String(args.text),
  },
];
const skill: McpSkill = { name: 'answering', description: "Use when it's asked: now.", body: '# How\n\nSay it back.' };
const info = { name: 'test', version: '1', instructions: 'Use echo.', skills: [skill] };
const modern = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } };
const ask = async (method: string, params?: Record<string, unknown>) =>
  (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }, tools, info)) as {
    result?: Record<string, unknown>;
    error?: { code: number; data?: unknown };
  };

describe('handleMcpMessage', () => {
  it('terminates a started SSE response with the request id on an internal failure', async () => {
    const local = await startLocalMcpServer({ name: 'progress', tools });
    const handle = vi
      .spyOn(protocol, 'handleMcpMessage')
      .mockImplementationOnce(async (_message, _tools, _info, _state, notify) => {
        notify!({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1, progressToken: 0 } });
        throw new Error('Internal failure after progress');
      });
    try {
      const server = local.mcpServer;
      if (!('url' in server)) throw new Error('Expected an HTTP transport');
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { ...server.headers, accept: 'text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'request',
          method: 'tools/call',
          params: { name: 'echo', _meta: { progressToken: 0 } },
        }),
      });
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      const messages = (await response.text())
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)));
      expect(messages).toEqual([
        { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1, progressToken: 0 } },
        { jsonrpc: '2.0', id: 'request', error: { code: -32603, message: 'Internal error' } },
      ]);
    } finally {
      handle.mockRestore();
      await local.close();
    }
  });

  it('keeps the handshake of older clients as it was', async () => {
    const { result } = await ask('initialize', { protocolVersion: '2025-06-18' });
    expect(result).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'test', version: '1' },
      instructions: 'Use echo.',
    });
    expect((await ask('tools/list')).result).toEqual({
      tools: [{ name: 'echo', description: 'Says it back.', inputSchema: tools[0]!.inputSchema }],
    });
    expect((await ask('tools/call', { name: 'echo', arguments: { text: 'hi' } })).result).toEqual({
      content: [{ type: 'text', text: 'hi' }],
    });
    // Skills are for clients that name the newer revision.
    expect((await ask('skills/list')).error?.code).toBe(-32601);
  });

  it('answers server/discover with what it serves', async () => {
    const { result } = await ask('server/discover', modern);
    expect(result).toMatchObject({
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: {}, resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'test', version: '1' } },
      instructions: 'Use echo.',
      cacheScope: 'private',
    });
    expect(result?.ttlMs).toBeGreaterThan(0);
    const plain = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: modern }, tools, {
      name: 'test',
      version: '1',
    });
    expect((plain as { result: { capabilities: unknown } }).result.capabilities).toEqual({ tools: {} });
  });

  it('marks results of the newer revision as whole, listings with how long they hold', async () => {
    const list = (await ask('tools/list', modern)).result;
    expect(list).toMatchObject({ resultType: 'complete', ttlMs: 300_000, cacheScope: 'private' });
    const call = (await ask('tools/call', { ...modern, name: 'echo', arguments: { text: 'hi' } })).result;
    expect(call).toEqual({ resultType: 'complete', content: [{ type: 'text', text: 'hi' }] });
  });

  it('refuses a revision it does not speak, naming the one it does', async () => {
    const { error } = await ask('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } });
    expect(error).toMatchObject({ code: -32022, data: { supported: ['2026-07-28'], requested: '2099-01-01' } });
  });

  it('serves its skills: listed, fetched and read as SKILL.md', async () => {
    const uri = 'skill://answering/SKILL.md';
    const listed = (await ask('skills/list', modern)).result as { skills: Array<Record<string, unknown>> };
    expect(listed.skills).toHaveLength(1);
    expect(listed.skills[0]).toMatchObject({
      uri,
      frontmatter: { name: 'answering', description: skill.description },
    });
    const [file] = listed.skills[0]!.resources as Array<{ uri: string; digest: string; size: number }>;
    const text = skillText(skill);
    expect(file).toMatchObject({ uri, size: Buffer.byteLength(text) });
    expect(file!.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect((await ask('skills/get', { ...modern, uri })).result).toMatchObject({ skill: { uri } });
    expect((await ask('skills/get', { ...modern, uri: 'skill://none/SKILL.md' })).error?.code).toBe(-32602);

    const read = (await ask('resources/read', { ...modern, uri })).result;
    expect(read).toMatchObject({ resultType: 'complete', contents: [{ uri, mimeType: 'text/markdown', text }] });
    expect((await ask('resources/read', { ...modern, uri: 'file:///etc/passwd' })).error?.code).toBe(-32602);
    expect((await ask('resources/list', modern)).result).toMatchObject({ resources: [{ uri, name: 'answering' }] });
  });
});

describe('parseSkill', () => {
  it('reads back what skillText writes', () => {
    expect(parseSkill(skillText(skill))).toEqual(skill);
  });

  it('reads frontmatter quoted either way, or not at all', () => {
    expect(parseSkill("---\nname: a\ndescription: 'It''s here: now.'\n---\n\nBody\n")).toEqual({
      name: 'a',
      description: "It's here: now.",
      body: 'Body',
    });
    expect(parseSkill('---\nname: a\ndescription: Plain words.\n---\nBody')?.description).toBe('Plain words.');
  });

  it('is undefined without a name and a description', () => {
    expect(parseSkill('# No frontmatter')).toBeUndefined();
    expect(parseSkill('---\nname: a\n---\nBody')).toBeUndefined();
  });
});

describe('tasks and input', () => {
  const capable = {
    _meta: {
      ...modern._meta,
      'io.modelcontextprotocol/clientCapabilities': { extensions: { 'io.modelcontextprotocol/tasks': {} } },
    },
  };
  const slow = (work: Promise<string>, cancel?: () => void): McpTool => ({
    name: 'slow',
    description: 'Takes a while.',
    inputSchema: { type: 'object' },
    call: async () => ({
      text: 'Started.',
      task: { result: work, status: () => 'Half way', ...(cancel ? { cancel } : {}) },
    }),
  });
  const send = async (
    tool: McpTool,
    method: string,
    params: Record<string, unknown>,
    state = createMcpState(),
    wait = 20,
  ) =>
    (await handleMcpMessage(
      { jsonrpc: '2.0', id: 7, method, params },
      [tool],
      { name: 't', version: '1', taskWaitMs: wait },
      state,
    )) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read loosely here
      result?: Record<string, any>;
      error?: { code: number };
    };

  it('offers tasks only with somewhere to keep them', async () => {
    const tool = slow(Promise.resolve('Done.'));
    const withState = await send(tool, 'server/discover', modern);
    expect(withState.result!.capabilities.extensions).toEqual({ 'io.modelcontextprotocol/tasks': {} });
    const without = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'server/discover', params: modern },
      [tool],
      {
        name: 't',
        version: '1',
      },
    );
    expect((without as { result: { capabilities: unknown } }).result.capabilities).toEqual({ tools: {} });
  });

  it('gives a client that takes tasks one to poll, to its end', async () => {
    let finish!: (text: string) => void;
    const tool = slow(new Promise<string>((resolve) => (finish = resolve)));
    const state = createMcpState();
    const started = (await send(tool, 'tools/call', { ...capable, name: 'slow' }, state)).result!;
    expect(started).toMatchObject({ resultType: 'task', status: 'working', statusMessage: 'Started.', ttlMs: null });
    expect(started.taskId).toMatch(/^[\x21-\x7e]{1,128}$/);
    const taskId = started.taskId as string;
    expect((await send(tool, 'tasks/get', { ...capable, taskId }, state)).result).toMatchObject({
      resultType: 'complete',
      status: 'working',
      statusMessage: 'Half way',
    });
    finish('Done.');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await send(tool, 'tasks/get', { ...capable, taskId }, state)).result).toMatchObject({
      status: 'completed',
      result: { content: [{ type: 'text', text: 'Done.' }] },
    });
  });

  it('fails a task whose work failed, and lets one go on cancel', async () => {
    const state = createMcpState();
    const failing = slow(Promise.reject(new Error('It broke.')));
    const failed = (await send(failing, 'tools/call', { ...capable, name: 'slow' }, state)).result!;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await send(failing, 'tasks/get', { ...capable, taskId: failed.taskId }, state)).result).toMatchObject({
      status: 'failed',
      error: { message: 'It broke.' },
    });

    let cancelled = false;
    let finish!: (text: string) => void;
    const tool = slow(new Promise<string>((resolve) => (finish = resolve)), () => (cancelled = true));
    const started = (await send(tool, 'tools/call', { ...capable, name: 'slow' }, state)).result!;
    expect((await send(tool, 'tasks/cancel', { ...capable, taskId: started.taskId }, state)).result).toEqual({
      resultType: 'complete',
    });
    expect(cancelled).toBe(true);
    finish('Too late.');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await send(tool, 'tasks/get', { ...capable, taskId: started.taskId }, state)).result!.status).toBe(
      'cancelled',
    );
  });

  it('waits a while for a client that takes no tasks', async () => {
    const quick = (await send(slow(Promise.resolve('Done.')), 'tools/call', { ...modern, name: 'slow' })).result!;
    expect(quick).toEqual({ resultType: 'complete', content: [{ type: 'text', text: 'Started.\n\nDone.' }] });
    const never = (await send(slow(new Promise(() => undefined)), 'tools/call', { ...modern, name: 'slow' })).result!;
    expect(never.content).toEqual([{ type: 'text', text: 'Started.' }]);
  });

  it('turns a tool that has to ask into an input request, and passes the answers back in', async () => {
    const seen: unknown[] = [];
    const asking: McpTool = {
      name: 'ask',
      description: 'Asks first.',
      inputSchema: { type: 'object' },
      call: async (_args, context) => {
        seen.push(context);
        if (!context?.inputResponses) {
          throw new McpInputRequired({ ok: { method: 'elicitation/create', params: { message: 'Sure?' } } }, 'state-1');
        }
        return 'Went ahead.';
      },
    };
    const first = (await send(asking, 'tools/call', { ...modern, name: 'ask' })).result!;
    expect(first).toEqual({
      resultType: 'input_required',
      inputRequests: { ok: { method: 'elicitation/create', params: { message: 'Sure?' } } },
      requestState: 'state-1',
    });
    const retry = { ...modern, name: 'ask', inputResponses: { ok: { action: 'accept' } }, requestState: 'state-1' };
    expect((await send(asking, 'tools/call', retry)).result!.content[0].text).toBe('Went ahead.');
    expect(seen[1]).toMatchObject({ inputResponses: { ok: { action: 'accept' } }, requestState: 'state-1' });
    // An older client cannot be asked: it gets the refusal as an error.
    const legacy = (await send(asking, 'tools/call', { name: 'ask' })).result!;
    expect(legacy.isError).toBe(true);
  });

  it('forwards notifications/progress when _meta.progressToken and onNotify are provided', async () => {
    const notifications: object[] = [];
    const seenProgress: boolean[] = [];
    const waiter: McpTool = {
      name: 'waiter',
      description: 'Reports progress.',
      inputSchema: { type: 'object' },
      call: async (_args, context) => {
        seenProgress.push(typeof context?.progress === 'function');
        context?.progress?.(15, 240, 'still waiting');
        return 'done';
      },
    };
    const answer = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'waiter', arguments: {}, _meta: { progressToken: 'tok-1' } },
      },
      [waiter],
      { name: 't', version: '1' },
      undefined,
      (note) => notifications.push(note),
    );
    expect(answer).toEqual({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'done' }] } });
    expect(notifications).toEqual([
      {
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: 'tok-1', progress: 15, total: 240, message: 'still waiting' },
      },
    ]);
    // Without a progressToken, context.progress is omitted.
    await handleMcpMessage(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'waiter', arguments: {} } },
      [waiter],
      { name: 't', version: '1' },
      undefined,
      (note) => notifications.push(note),
    );
    expect(seenProgress).toEqual([true, false]);
    expect(notifications).toHaveLength(1);
  });
});
