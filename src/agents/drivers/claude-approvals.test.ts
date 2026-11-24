import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentTask,
  ApprovalDecision,
  ApprovalHandler,
  ApprovalRequest,
  QuestionHandler,
} from '../types.js';
import { claude, hasClaudeDefaultMode, type ClaudeAgentOptions } from './claude.js';
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

  it('allows the input as asked even when the handler mutates the request', async () => {
    const input = { command: 'npm test' };
    const result = await claudeApprovalTool((request) => {
      (request.detail as { input: { command: string } }).input.command = 'redacted';
      return 'approve';
    }).call({ tool_name: 'Bash', input });
    expect(answer(result)).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' } });
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

  describe('AskUserQuestion', () => {
    const input = {
      questions: [
        {
          question: 'Which color?',
          header: 'Color',
          multiSelect: false,
          options: [
            { label: 'Red', description: 'Warm' },
            { label: 'Blue', description: 'Cool' },
          ],
        },
        { question: 'Which sizes?', header: 'Sizes', multiSelect: true, options: [{ label: 'S' }, { label: 'M' }] },
      ],
    };
    const ask = { tool_name: 'AskUserQuestion', input, tool_use_id: 'tu-q' };

    it('asks onQuestion and returns the answers keyed by question text', async () => {
      const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
      const onQuestion = vi.fn<QuestionHandler>(() => ({ q1: ['Blue'], q2: ['S', 'M', 'XL'] }));
      const result = await claudeApprovalTool(onApproval, { onQuestion }).call(ask);
      expect(answer(result)).toEqual({
        behavior: 'allow',
        updatedInput: { ...input, answers: { 'Which color?': 'Blue', 'Which sizes?': 'S, M, XL' } },
      });
      expect(onApproval).not.toHaveBeenCalled();
      expect(onQuestion.mock.calls[0]![0]).toEqual({
        id: 'tu-q',
        kind: 'question',
        scope: 'once',
        summary: 'Which color?',
        detail: ask,
        questions: [
          {
            id: 'q1',
            question: 'Which color?',
            header: 'Color',
            freeText: true,
            options: [
              { label: 'Red', description: 'Warm' },
              { label: 'Blue', description: 'Cool' },
            ],
          },
          {
            id: 'q2',
            question: 'Which sizes?',
            header: 'Sizes',
            multiple: true,
            freeText: true,
            options: [{ label: 'S' }, { label: 'M' }],
          },
        ],
      });
    });

    it('keeps one answer for a single choice and drops what was not asked', async () => {
      const onQuestion: QuestionHandler = () => ({ q1: ['Red', 'Blue'], q9: ['x'], q2: [] });
      const result = await claudeApprovalTool(undefined, { onQuestion }).call(ask);
      expect(answer(result)).toEqual({
        behavior: 'allow',
        updatedInput: { ...input, answers: { 'Which color?': 'Red' } },
      });
    });

    it('declines when skipped or when nobody answers questions', async () => {
      const skipped = await claudeApprovalTool(() => 'approve', { onQuestion: () => undefined }).call(ask);
      expect(answer(skipped)).toMatchObject({ behavior: 'deny' });
      const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
      expect(answer(await claudeApprovalTool(onApproval).call(ask))).toMatchObject({ behavior: 'deny' });
      expect(onApproval).not.toHaveBeenCalled();
    });

    it('asks under a read-only sandbox too', async () => {
      const onQuestion: QuestionHandler = () => ({ q1: ['Red'] });
      const result = await claudeApprovalTool(undefined, { onQuestion, sandbox: 'read-only', cwd: dir }).call(ask);
      expect(answer(result)).toMatchObject({ behavior: 'allow' });
    });

    it('treats a malformed question as an ordinary permission prompt', async () => {
      const onApproval = vi.fn<ApprovalHandler>(() => 'deny');
      const odd = { tool_name: 'AskUserQuestion', input: { questions: [{ question: 'x' }] } };
      expect(answer(await claudeApprovalTool(onApproval).call(odd))).toMatchObject({ behavior: 'deny' });
      expect(onApproval.mock.calls[0]![0]).toMatchObject({ kind: 'other', summary: 'AskUserQuestion' });
    });
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
const toolName = process.env.FAKE_TOOL || 'Bash';
const toolInput = toolName === 'ExitPlanMode' ? { plan: 'Step 1' } : { command: 'npm test' };
const called = await rpc(2, 'tools/call', { name, arguments: { tool_name: toolName, input: toolInput, tool_use_id: 'tu-9' } });
const report = { answer: JSON.parse(called.result.content[0].text), args, servers: Object.keys(config.mcpServers), timeout: process.env.MCP_TOOL_TIMEOUT };
const permIdx = args.indexOf('--permission-mode');
const permissionMode = permIdx >= 0 ? args[permIdx + 1] : undefined;
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1', ...(permissionMode ? { permissionMode } : {}) }));
if (process.env.FAKE_FALLBACK) console.log(JSON.stringify({ type: 'assistant', session_id: 's-1', message: { model: process.env.FAKE_FALLBACK, content: [] } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(report) }));
`,
);
const bin = join(dir, 'claude');
writeFileSync(bin, `#!${process.execPath}\nimport(${JSON.stringify(fake)});\n`, { mode: 0o755 });

describe('claude() with onApproval', () => {
  async function run(
    onApproval: ApprovalHandler | undefined,
    mcpServers?: { name: string; url: string }[],
    permissions?: AgentTask['permissions'],
    extra: {
      options?: Omit<ClaudeAgentOptions, 'command'>;
      env?: NodeJS.ProcessEnv;
      extraArgs?: string[];
      mode?: AgentTask['mode'];
    } = {},
  ) {
    const agent = claude({ command: bin, ...extra.options });
    const events: AgentEvent[] = [];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(dir, 'empty-claude-config'),
      ...extra.env,
    };
    delete env.MCP_TOOL_TIMEOUT;
    const task = agent.run({
      prompt: 'fix it',
      cwd: dir,
      env,
      onApproval,
      mcpServers,
      permissions,
      extraArgs: extra.extraArgs,
      mode: extra.mode,
    });
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

  it('auto-approves without onApproval and reports the decision as automatic', async () => {
    const { report, events } = await run(undefined, undefined, 'yolo');
    expect(report.answer).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' } });
    expect(report.args).toContain('{"sandbox":{"enabled":false}}');
    expect(events.filter((event) => event.type === 'approval-resolved')).toEqual([
      { type: 'approval-resolved', id: 'tu-9', decision: 'approve', automatic: true },
    ]);
  });

  it('keeps auto-approve inside the sandbox', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    const { report, events } = await run(onApproval, undefined, {
      approval: 'auto-approve',
      sandbox: 'workspace-write',
    });
    // An unsandboxed Bash call is outside workspace-write, so nobody is asked.
    expect(report.answer).toMatchObject({ behavior: 'deny' });
    expect(onApproval).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'approval-resolved')).toEqual([
      { type: 'approval-resolved', id: 'tu-9', decision: 'deny', automatic: true },
    ]);
  });

  it('inherits permissions.defaultMode from user settings unless overridden', async () => {
    const configDir = join(dir, 'user-auto');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));

    // Inherits defaultMode: omits --permission-mode.
    const inherited = await run(() => 'approve', undefined, undefined, { env: { CLAUDE_CONFIG_DIR: configDir } });
    expect(inherited.report.args).not.toContain('--permission-mode');

    // Explicit permissionMode option overrides user settings.
    const explicit = await run(() => 'approve', undefined, undefined, {
      options: { permissionMode: 'plan' },
      env: { CLAUDE_CONFIG_DIR: configDir },
    });
    expect(
      explicit.report.args.slice(
        explicit.report.args.indexOf('--permission-mode'),
        explicit.report.args.indexOf('--permission-mode') + 2,
      ),
    ).toEqual(['--permission-mode', 'plan']);

    // Explicit task.permissions overrides user settings.
    const owned = await run(
      () => 'approve',
      undefined,
      { approval: 'ask', sandbox: 'read-only' },
      {
        env: { CLAUDE_CONFIG_DIR: configDir },
      },
    );
    expect(
      owned.report.args.slice(
        owned.report.args.indexOf('--permission-mode'),
        owned.report.args.indexOf('--permission-mode') + 2,
      ),
    ).toEqual(['--permission-mode', 'plan']);

    // Excluding user settings falls back to acceptEdits.
    const noUser = await run(() => 'approve', undefined, undefined, {
      env: { CLAUDE_CONFIG_DIR: configDir },
      extraArgs: ['--setting-sources', 'project'],
    });
    expect(noUser.report.args).toContain('acceptEdits');

    const bare = await run(() => 'approve', undefined, undefined, {
      env: { CLAUDE_CONFIG_DIR: configDir },
      extraArgs: ['--bare'],
    });
    expect(bare.report.args).toContain('acceptEdits');
  });

  it('denies ExitPlanMode automatically during an explicit Plan turn even with auto-approve or approving handler', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    for (const permissions of [undefined, 'yolo', { approval: 'auto-approve' }] as const) {
      const { report, events } = await run(onApproval, undefined, permissions, {
        mode: 'plan',
        env: { FAKE_TOOL: 'ExitPlanMode' },
      });
      expect(report.answer).toMatchObject({ behavior: 'deny' });
      expect(events.filter((event) => event.type === 'approval-resolved')).toEqual([
        { type: 'approval-resolved', id: 'tu-9', decision: 'deny', automatic: true },
      ]);
    }
    expect(onApproval).not.toHaveBeenCalled();

    // A direct follow-up resuming the Plan session with mode omitted keeps Plan mode and still refuses ExitPlanMode.
    const persistent = claude({ command: bin });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(dir, 'empty-claude-config'),
      FAKE_TOOL: 'ExitPlanMode',
    };
    delete env.MCP_TOOL_TIMEOUT;
    const first = persistent.run({ prompt: 'plan it', cwd: dir, env, mode: 'plan', permissions: 'yolo', onApproval });
    const firstEvents: AgentEvent[] = [];
    for await (const event of first) firstEvents.push(event);
    const firstResult = await first.result;
    expect(firstEvents).toContainEqual({ type: 'session', sessionId: 's-1', mode: 'plan' });
    // A fallback model's report later in the run (no mode in it) keeps the session's Plan mode.
    const fallback = persistent.run({
      prompt: 'plan it',
      cwd: dir,
      env: { ...env, FAKE_FALLBACK: 'claude-sonnet' },
      mode: 'plan',
      permissions: 'yolo',
      onApproval,
    });
    const fallbackEvents: AgentEvent[] = [];
    for await (const event of fallback) fallbackEvents.push(event);
    await fallback.result;
    expect(fallbackEvents).toContainEqual({ type: 'session', sessionId: 's-1', model: 'claude-sonnet' });
    for (const permissions of [undefined, 'yolo'] as const) {
      const resumed = persistent.run({
        prompt: 'refine it',
        cwd: dir,
        env,
        permissions,
        resume: firstResult.sessionId,
        onApproval,
      });
      const resumedResult = await resumed.result;
      const resumedReport = JSON.parse(resumedResult.text!);
      expect(resumedReport.args).toContain('plan');
      expect(resumedReport.answer).toMatchObject({ behavior: 'deny' });
    }
    expect(onApproval).not.toHaveBeenCalled();
  });

  it('leaves no temp MCP config on disk when mode or option validation fails', async () => {
    const marker = `cleanup-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const hasLeakedConfig = () =>
      readdirSync(tmpdir())
        .filter((entry) => entry.startsWith('genaicode-claude-mcp-'))
        .some((entry) => {
          try {
            return readFileSync(join(tmpdir(), entry, 'mcp.json'), 'utf8').includes(marker);
          } catch {
            return false;
          }
        });
    const badMode = await claude({ command: bin }).run({
      prompt: 'go',
      cwd: dir,
      mode: 'bogus' as 'plan',
      mcpServers: [{ name: 's', url: 'https://mcp.example/s', headers: { Authorization: `Bearer ${marker}` } }],
    }).result;
    expect(badMode.status).toBe('failed');
    expect(badMode.error).toMatch(/Invalid mode/);

    const conflict = await claude({ command: bin, permissionMode: 'plan' }).run({
      prompt: 'go',
      cwd: dir,
      permissions: { approval: 'ask' },
      onApproval: () => 'approve',
      mcpServers: [{ name: 's', url: 'https://mcp.example/s', headers: { Authorization: `Bearer ${marker}` } }],
    }).result;
    expect(conflict.status).toBe('failed');
    expect(conflict.error).toMatch(/permissionMode/);

    expect(hasLeakedConfig()).toBe(false);
  });
});

describe('hasClaudeDefaultMode', () => {
  const withSettings = (name: string, content: string) => {
    const configDir = join(dir, name);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'settings.json'), content);
    return { CLAUDE_CONFIG_DIR: configDir };
  };

  it('reads permissions.defaultMode from CLAUDE_CONFIG_DIR or HOME/.claude', () => {
    expect(hasClaudeDefaultMode({ CLAUDE_CONFIG_DIR: join(dir, 'missing') })).toBe(false);
    expect(hasClaudeDefaultMode(withSettings('bad-json', '{not json'))).toBe(false);
    expect(hasClaudeDefaultMode(withSettings('auto-block-only', JSON.stringify({ autoMode: { allow: [] } })))).toBe(
      false,
    );
    expect(
      hasClaudeDefaultMode(withSettings('auto-default', JSON.stringify({ permissions: { defaultMode: 'auto' } }))),
    ).toBe(true);

    const home = join(dir, 'home-test');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'plan' } }));
    expect(hasClaudeDefaultMode({ HOME: home })).toBe(true);
    expect(hasClaudeDefaultMode({ HOME: home, CLAUDE_CONFIG_DIR: '' })).toBe(true);
  });

  it('falls back when the configured mode is disabled or user settings are skipped', () => {
    expect(
      hasClaudeDefaultMode(
        withSettings(
          'auto-disabled',
          JSON.stringify({ permissions: { defaultMode: 'auto' }, disableAutoMode: 'disable' }),
        ),
      ),
    ).toBe(false);
    expect(
      hasClaudeDefaultMode(
        withSettings(
          'auto-nested-disabled',
          JSON.stringify({ permissions: { defaultMode: 'auto', disableAutoMode: 'disable' } }),
        ),
      ),
    ).toBe(false);
    expect(
      hasClaudeDefaultMode(
        withSettings(
          'bypass-disabled',
          JSON.stringify({
            permissions: { defaultMode: 'bypassPermissions', disableBypassPermissionsMode: 'disable' },
          }),
        ),
      ),
    ).toBe(false);
    const enabled = withSettings('auto-enabled', JSON.stringify({ permissions: { defaultMode: 'auto' } }));
    expect(hasClaudeDefaultMode(enabled, { disableAutoMode: 'disable' })).toBe(false);
    expect(hasClaudeDefaultMode(enabled, { permissions: { disableAutoMode: 'disable' } })).toBe(false);
    expect(hasClaudeDefaultMode(enabled, undefined, ['--setting-sources=project,local'])).toBe(false);
    expect(hasClaudeDefaultMode(enabled, undefined, ['--setting-sources', 'user,project'])).toBe(true);
    expect(hasClaudeDefaultMode(enabled, undefined, ['--bare'])).toBe(false);
    expect(
      hasClaudeDefaultMode({ CLAUDE_CONFIG_DIR: join(dir, 'missing') }, { permissions: { defaultMode: 'auto' } }),
    ).toBe(true);
  });
});
