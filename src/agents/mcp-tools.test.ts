import { describe, expect, it } from 'vitest';
import { handleMcpMessage, parseSkill, skillText, type McpSkill, type McpTool } from './mcp-tools.js';

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
