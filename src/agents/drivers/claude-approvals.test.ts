import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ApprovalDecision, ApprovalHandler, ApprovalRequest } from '../types.js';
import { claude } from './claude.js';
import {
  claudeApprovalArgs,
  claudeApprovalEnv,
  claudeApprovalTool,
  startClaudeApprovalServer,
} from './claude-approvals.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-claude-approval-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const answer = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text) as unknown;

describe('claudeApprovalTool', () => {
  const call = { tool_name: 'Bash', input: { command: 'npm test', description: 'Run tests' }, tool_use_id: 'tu-1' };

  it('allows exactly the input Claude asked about', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    const result = await claudeApprovalTool(onApproval).call(call);
    expect(answer(result)).toEqual({ behavior: 'allow', updatedInput: call.input });
    expect(onApproval.mock.calls[0]![0]).toEqual({
      id: 'tu-1',
      kind: 'command',
      scope: 'once',
      summary: 'Bash: npm test',
      detail: call,
    });
  });

  it('denies with a message', async () => {
    const result = await claudeApprovalTool(() => 'deny').call(call);
    expect(answer(result)).toEqual({ behavior: 'deny', message: expect.any(String) });
  });

  it('classifies edits and other tools', async () => {
    const seen: ApprovalRequest[] = [];
    const tool = claudeApprovalTool((request) => {
      seen.push(request);
      return 'deny';
    });
    await tool.call({ tool_name: 'Write', input: { file_path: '/w/a.ts', content: 'x' } });
    await tool.call({ tool_name: 'mcp__docs__search', input: { q: 'x' } });
    expect(seen.map(({ kind, summary }) => [kind, summary])).toEqual([
      ['file-change', 'Write: /w/a.ts'],
      ['other', 'mcp__docs__search'],
    ]);
    expect(seen[0]!.id).toMatch(/^claude-/);
  });

  it('denies malformed calls without asking', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    const tool = claudeApprovalTool(onApproval);
    for (const args of [
      undefined,
      [],
      { tool_name: 'Bash' },
      { tool_name: 'Bash', input: ['ls'] },
      { tool_name: 7, input: {} },
      { tool_name: '', input: {} },
      { tool_name: 'x'.repeat(201), input: {} },
      { tool_name: 'Bash', input: {}, tool_use_id: 3 },
    ])
      expect(answer(await tool.call(args))).toMatchObject({ behavior: 'deny' });
    expect(onApproval).not.toHaveBeenCalled();
  });

  it('denies without a handler, when it throws, and when the caller goes away', async () => {
    expect(answer(await claudeApprovalTool(undefined).call(call))).toMatchObject({ behavior: 'deny' });
    const thrown = claudeApprovalTool(() => {
      throw new Error('ui crashed');
    });
    expect(answer(await thrown.call(call))).toMatchObject({ behavior: 'deny' });
    let signal: AbortSignal | undefined;
    const pending = claudeApprovalTool((_, given) => {
      signal = given;
      return new Promise<ApprovalDecision>(() => {});
    });
    const gone = new AbortController();
    const result = pending.call(call, gone.signal);
    gone.abort();
    expect(answer(await result)).toMatchObject({ behavior: 'deny' });
    expect(signal?.aborted).toBe(true);
  });

  it('raises the MCP tool timeout unless the environment sets one', () => {
    expect(claudeApprovalEnv({})).toEqual({ MCP_TOOL_TIMEOUT: '86400000' });
    expect(claudeApprovalEnv({ MCP_TOOL_TIMEOUT: '5000' })).toEqual({});
  });

  it('names the permission prompt tool for a server', () => {
    expect(claudeApprovalArgs('app_tools')).toEqual(['--permission-prompt-tool', 'mcp__app_tools__approve']);
    expect(claudeApprovalArgs('app_tools', 'ask')).toEqual(['--permission-prompt-tool', 'mcp__app_tools__ask']);
  });
});

/** POST one JSON-RPC message; resolves with the status and parsed body. */
function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      signal,
    });
    req.on('response', (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : undefined }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('startClaudeApprovalServer', () => {
  const call = (id: number) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'ls' } } },
  });

  it('serves the tool over MCP behind its bearer token', async () => {
    const approvals = await startClaudeApprovalServer(() => 'approve');
    try {
      const { url, headers, name } = approvals.server;
      expect(name).toBe('genaicode_approval');
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      expect(approvals.args).toEqual(['--permission-prompt-tool', 'mcp__genaicode_approval__approve']);
      expect((await post(url, call(1))).status).toBe(401);
      expect((await post(url, call(1), { authorization: 'Bearer wrong' })).status).toBe(401);
      const init = await post(
        url,
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
        headers,
      );
      expect(init.body).toMatchObject({
        id: 1,
        result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } },
      });
      expect((await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers)).status).toBe(202);
      const list = await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers);
      expect(list.body).toMatchObject({ result: { tools: [{ name: 'approve' }] } });
      const allowed = (await post(url, call(3), headers)).body as { result: { content: { text: string }[] } };
      expect(answer(allowed.result)).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
      const unknown = await post(url, { ...call(4), params: { name: 'other', arguments: {} } }, headers);
      expect(unknown.body).toMatchObject({ error: { code: -32602 } });
    } finally {
      await approvals.close();
    }
  });

  it('withdraws the question when the caller disconnects or the server closes', async () => {
    const asked: AbortSignal[] = [];
    const approvals = await startClaudeApprovalServer((_, signal) => {
      asked.push(signal!);
      return new Promise<ApprovalDecision>(() => {});
    });
    const { url, headers } = approvals.server;
    const hangUp = new AbortController();
    const first = post(url, call(1), headers, hangUp.signal).catch(() => 'gone');
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    hangUp.abort();
    expect(await first).toBe('gone');
    await vi.waitFor(() => expect(asked[0]!.aborted).toBe(true));

    const second = post(url, call(2), headers).catch(() => 'closed');
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    await approvals.close();
    expect(asked[1]!.aborted).toBe(true);
    await second;
  });
});

// Stands in for `claude -p`: finds the approval server in its MCP config, asks it about one
// Bash call, and reports the answer, its argv and the config as the result.
const fake = join(dir, 'fake-claude.mjs');
writeFileSync(
  fake,
  `import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const config = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
const tool = args[args.indexOf('--permission-prompt-tool') + 1];
const [, server, name] = tool.split('__');
const { url, headers } = config.mcpServers[server];
const rpc = async (id, method, params) => {
  const res = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  return res.json();
};
await rpc(1, 'initialize', { protocolVersion: '2025-06-18' });
const called = await rpc(2, 'tools/call', { name, arguments: { tool_name: 'Bash', input: { command: 'npm test' }, tool_use_id: 'tu-9' } });
const report = { answer: JSON.parse(called.result.content[0].text), args, servers: Object.keys(config.mcpServers), timeout: process.env.MCP_TOOL_TIMEOUT };
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(report) }));
`,
);
const bin = join(dir, 'claude');
writeFileSync(bin, `#!${process.execPath}\nimport(${JSON.stringify(fake)});\n`, { mode: 0o755 });

describe('claude() with onApproval', () => {
  async function run(onApproval: ApprovalHandler, mcpServers?: { name: string; url: string }[]) {
    const agent = claude({ command: bin });
    const events: AgentEvent[] = [];
    const env = { ...process.env };
    delete env.MCP_TOOL_TIMEOUT;
    const task = agent.run({ prompt: 'fix it', cwd: dir, env, onApproval, mcpServers });
    for await (const event of task) events.push(event);
    const result = await task.result;
    expect(result.status).toBe('completed');
    return { report: JSON.parse(result.text!), events };
  }

  it('declares approvals and routes the permission prompt tool to onApproval', async () => {
    expect(claude().capabilities.approvals).toBe(true);
    const { report, events } = await run(() => 'approve');
    expect(report.answer).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' } });
    expect(report.args).toContain('acceptEdits');
    expect(report.args).not.toContain('bypassPermissions');
    expect(report.servers).toEqual(['genaicode_approval']);
    expect(report.timeout).toBe(String(24 * 60 * 60 * 1000));
    expect(events.filter((event) => event.type.startsWith('approval'))).toEqual([
      { type: 'approval-request', request: expect.objectContaining({ id: 'tu-9', kind: 'command', scope: 'once' }) },
      { type: 'approval-resolved', id: 'tu-9', decision: 'approve' },
    ]);
  });

  it('keeps the task MCP servers next to the approval server', async () => {
    const { report } = await run(
      () => 'deny',
      [
        { name: 'genaicode_approval', url: 'https://mcp.example/a' },
        { name: 'docs', url: 'https://mcp.example/docs' },
      ],
    );
    expect(report.answer).toMatchObject({ behavior: 'deny' });
    expect(report.servers).toEqual(['genaicode_approval', 'docs', 'genaicode_approval_2']);
    expect(report.args).toContain('mcp__genaicode_approval_2__approve');
  });
});
