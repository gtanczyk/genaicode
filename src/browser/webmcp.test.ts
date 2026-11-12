import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageTool } from './tools.js';
import { argumentProblems, toolText } from './tools.js';
import { exposeWebMcp, webMcpSupported, webMcpTools } from './webmcp.js';

interface Registered {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; consequentialHint: boolean };
  execute(input: unknown): Promise<unknown>;
}

const globals = globalThis as { document?: unknown; navigator?: unknown; confirm?: unknown };
const saved = { document: globals.document, navigator: globals.navigator, confirm: globals.confirm };
function define(key: 'document' | 'navigator' | 'confirm', value: unknown) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
afterEach(() => {
  define('document', saved.document);
  define('navigator', saved.navigator);
  define('confirm', saved.confirm);
});

const tools: PageTool[] = [
  { name: 'read', description: 'Read.', run: () => ({ items: 2 }) },
  {
    name: 'buy',
    description: 'Buy.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    write: true,
    summary: (args) => `Buy ${String(args.id)}`,
    run: vi.fn(({ id }) => `bought ${String(id)}`),
  },
];

describe('exposeWebMcp', () => {
  it('does nothing without WebMCP', () => {
    define('document', {});
    expect(webMcpSupported()).toBe(false);
    expect(() => exposeWebMcp(tools)()).not.toThrow();
  });

  it('registers the tools on document.modelContext and takes them back', async () => {
    const registered: Registered[] = [];
    let signal: AbortSignal | undefined;
    define('document', {
      modelContext: {
        registerTool: (tool: Registered, options: { signal: AbortSignal }) => {
          registered.push(tool);
          signal = options.signal;
          return Promise.resolve();
        },
      },
    });
    expect(webMcpSupported()).toBe(true);
    const calls: unknown[] = [];
    const confirm = vi.fn(() => true);
    const remove = exposeWebMcp(tools, { confirm, onCall: (call) => calls.push(call) });

    expect(registered.map((tool) => tool.name)).toEqual(['read', 'buy']);
    expect(registered[0].annotations).toEqual({ readOnlyHint: true, consequentialHint: false });
    expect(registered[1].annotations).toEqual({ readOnlyHint: false, consequentialHint: true });
    expect(registered[0].inputSchema).toEqual({ type: 'object', properties: {} });

    expect(await registered[0].execute({})).toBe('{"items":2}');
    expect(await registered[1].execute({ id: 'a1' })).toBe('bought a1');
    expect(confirm).toHaveBeenCalledWith(tools[1], { id: 'a1' });
    await expect(registered[1].execute({})).rejects.toThrow('"id" is required');
    confirm.mockReturnValueOnce(false);
    await expect(registered[1].execute({ id: 'a2' })).rejects.toThrow('declined');
    expect(tools[1].run).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      { tool: 'read', args: {}, output: '{"items":2}' },
      { tool: 'buy', args: { id: 'a1' }, output: 'bought a1' },
      { tool: 'buy', args: {}, error: 'Bad arguments: "id" is required.' },
      { tool: 'buy', args: { id: 'a2' }, error: 'The user declined this action.' },
    ]);

    remove();
    expect(signal?.aborted).toBe(true);
  });

  it('speaks the first implementations: navigator.modelContext, MCP results, the confirm() dialog', async () => {
    const registered: Registered[] = [];
    const unregistered: string[] = [];
    define('document', {});
    define('navigator', {
      modelContext: {
        registerTool: (tool: Registered) => {
          if (tool.name === 'read') throw new Error('name taken');
          registered.push(tool);
        },
        unregisterTool: (name: string) => unregistered.push(name),
      },
    });
    const ask = vi.fn(() => false);
    define('confirm', ask);
    const remove = exposeWebMcp(tools);
    expect(registered.map((tool) => tool.name)).toEqual(['buy']);
    expect(await registered[0].execute({ id: 'a1' })).toEqual({
      content: [{ type: 'text', text: 'The user declined this action.' }],
      isError: true,
    });
    expect(ask).toHaveBeenCalledWith('An AI agent wants to: Buy a1');
    ask.mockReturnValue(true);
    expect(await registered[0].execute({ id: 'a1' })).toEqual({ content: [{ type: 'text', text: 'bought a1' }] });
    remove();
    expect(unregistered).toEqual(['buy']);
  });
});

describe('exposeWebMcp cleanup', () => {
  it('takes back only what it registered, even when asked before registration settles', async () => {
    const unregistered: string[] = [];
    const settle: Array<() => void> = [];
    define('document', {
      modelContext: {
        registerTool: (tool: Registered) =>
          tool.name === 'buy'
            ? Promise.reject(new Error('Duplicate tool name'))
            : new Promise<void>((resolve) => settle.push(resolve)),
        unregisterTool: (name: string) => unregistered.push(name),
      },
    });
    const remove = exposeWebMcp(tools);
    remove();
    expect(unregistered).toEqual([]);
    settle.forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
    // `read` registered after the cleanup and is taken back; `buy` was never ours.
    expect(unregistered).toEqual(['read']);

    const late = exposeWebMcp(tools);
    settle.at(-1)!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    late();
    late();
    expect(unregistered).toEqual(['read', 'read']);
  });
});

describe('webMcpTools', () => {
  it('lists the page tools an in-page agent can call', async () => {
    define('document', {});
    expect(await webMcpTools()).toEqual([]);
    const executeTool = vi.fn(async () => '"ok"');
    const listed = [
      { name: 'search', description: 'Search.', inputSchema: '{"type":"object"}', annotations: { readOnlyHint: true } },
      { name: 'order', inputSchema: { type: 'object' } },
    ];
    define('document', { modelContext: { registerTool() {}, getTools: async () => listed, executeTool } });
    const found = await webMcpTools();
    expect(found.map(({ name, write, inputSchema }) => ({ name, write, inputSchema }))).toEqual([
      { name: 'search', write: false, inputSchema: { type: 'object' } },
      { name: 'order', write: true, inputSchema: { type: 'object' } },
    ]);
    expect(await found[0].run({ q: 'x' })).toBe('"ok"');
    expect(executeTool).toHaveBeenCalledWith(listed[0], { q: 'x' }, { signal: undefined });

    // Chrome's first builds take the arguments as JSON text.
    const strict = vi.fn(async (_tool: unknown, input: unknown) => {
      if (typeof input !== 'string') throw new Error('Failed to parse input arguments');
      return input;
    });
    define('document', { modelContext: { registerTool() {}, getTools: async () => listed, executeTool: strict } });
    expect(await (await webMcpTools())[0].run({ q: 'x' })).toBe('{"q":"x"}');
    const failing = vi.fn(async () => {
      throw new Error('out of stock');
    });
    define('document', { modelContext: { registerTool() {}, getTools: async () => listed, executeTool: failing } });
    await expect((await webMcpTools())[1].run({})).rejects.toThrow('out of stock');
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe('tools', () => {
  it('turns outputs into text and finds bad arguments', () => {
    expect(toolText(undefined)).toBe('done');
    expect(toolText({ text: 'hi' })).toBe('hi');
    expect(toolText([1, 2])).toBe('[1,2]');
    const tool = {
      inputSchema: {
        type: 'object',
        properties: { n: { type: 'integer' }, tags: { type: 'array' }, mode: { enum: ['a', 'b'] } },
        required: ['n'],
      },
    };
    expect(argumentProblems(tool, { n: 2, tags: ['x'], mode: 'a', extra: true })).toEqual([]);
    expect(argumentProblems(tool, { n: 1.5, tags: 'x', mode: 'c' })).toEqual([
      '"n" must be an integer',
      '"tags" must be an array',
      '"mode" must be one of "a", "b"',
    ]);
    expect(argumentProblems(tool, {})).toEqual(['"n" is required']);
  });
});
