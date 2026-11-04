import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentOutputParser } from '../cli-agent.js';
import type { AgentEvent } from '../types.js';
import {
  antigravity,
  antigravityAcpArgs,
  antigravityArgs,
  antigravityMcpServers,
  createAntigravityParser,
} from './antigravity.js';
import { createVibeParser, vibe, vibeArgs } from './vibe.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-antigravity-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const acpServer = join(dir, 'fake-acp.mjs');
writeFileSync(
  acpServer,
  `import { createInterface } from 'node:readline';
const mode = process.env.FAKE_ACP_MODE ?? 'basic';
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
const update = (u) => send({ method: 'session/update', params: { sessionId: 'c-acp', update: u } });
const log = { argv: process.argv.slice(2), calls: [] };
let pendingPromptId;
let pendingApproval;

const finishPrompt = (id, text) => {
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
  send({
    id,
    result: {
      stopReason: mode === 'cancelled' ? 'cancelled' : 'end_turn',
      usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15, cachedReadTokens: 3 },
    },
  });
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === 77) {
    const chosen = msg.result?.outcome?.optionId;
    finishPrompt(pendingPromptId, 'approval:' + chosen + ' log:' + JSON.stringify(log));
    return;
  }
  log.calls.push({ method: msg.method, params: msg.params });
  if (msg.method === 'initialize') {
    return send({ id: msg.id, result: { protocolVersion: 1 } });
  }
  if (msg.method === 'session/new' || msg.method === 'session/resume') {
    return send({
      id: msg.id,
      result: { sessionId: 'c-acp', models: { currentModelId: 'gemini-default' } },
    });
  }
  if (
    msg.method === 'session/set_mode' ||
    msg.method === 'session/set_model' ||
    msg.method === 'session/set_config_option'
  ) {
    return send({ id: msg.id, result: {} });
  }
  if (msg.method === 'session/prompt') {
    const text = msg.params.prompt[0].text;
    if (mode === 'steer' && !pendingPromptId) {
      pendingPromptId = msg.id;
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        name: 'mcp_docs_search',
        kind: 'other',
        status: 'in_progress',
        rawInput: { q: text },
      });
      return;
    }
    if (mode === 'steer' && pendingPromptId) {
      send({ id: pendingPromptId, result: { stopReason: 'end_turn' } });
      pendingPromptId = undefined;
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-1',
        status: 'completed',
        rawOutput: { output: 'found' },
      });
      return finishPrompt(msg.id, 'steered:' + text);
    }
    if (mode === 'approval') {
      pendingPromptId = msg.id;
      send({
        id: 77,
        method: 'session/request_permission',
        params: {
          sessionId: 'c-acp',
          toolCall: { toolCallId: 'tc-cmd', kind: 'execute', title: 'Run npm test' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        },
      });
      return;
    }
    update({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-edit',
      name: 'edit_file',
      kind: 'edit',
      status: 'in_progress',
      rawInput: { Path: 'src/a.ts' },
      locations: [{ path: 'src/a.ts' }],
    });
    update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-edit',
      status: 'completed',
      rawOutput: { output: 'edited' },
    });
    return finishPrompt(msg.id, JSON.stringify(log));
  }
});
`,
);
const agyBin = join(dir, 'agy');
writeFileSync(agyBin, `#!${process.execPath}\nimport(${JSON.stringify(acpServer)});\n`, { mode: 0o755 });

function feed(parser: AgentOutputParser, values: unknown[]) {
  return values.flatMap((value) => parser.event(value));
}

const entry = (fields: Record<string, unknown>) => ({
  sessionId: 's-1',
  createdAt: 1,
  updatedAt: 2,
  generationStatus: 'completed',
  ...fields,
});

describe('vibe driver', () => {
  it('maps task options to programmatic-mode flags', () => {
    expect(vibeArgs({ prompt: '-go', cwd: '.', maxTurns: 5 }, { maxPriceUsd: 0.5 })).toEqual([
      '--output',
      'streaming',
      '--agent',
      'accept-edits',
      '--trust',
      '--max-turns',
      '5',
      '--max-price',
      '0.5',
      '--prompt=-go',
    ]);
    expect(vibeArgs({ prompt: 'go', cwd: '.' }, { agent: 'plan', trustWorkspace: false })).toEqual([
      '--output',
      'streaming',
      '--agent',
      'plan',
      '--prompt=go',
    ]);
    expect(vibe().capabilities).toMatchObject({ maxTurns: true });
  });

  it('decodes streamed history entries', () => {
    const events = feed(createVibeParser(), [
      entry({ id: 'u', type: 'message', role: 'user', content: [{ type: 'text', text: 'go' }] }),
      entry({ id: 'r', type: 'reasoning', text: 'thinking' }),
      entry({
        id: 'e1',
        type: 'effect',
        title: 'Edit',
        detail: {
          kind: 'file_edit',
          toolName: 'search_replace',
          display: { summary: 'a.ts' },
          input: { filePath: 'a.ts', oldString: 'a', newString: 'b' },
        },
        state: { status: 'completed', outputText: 'ok', display: {} },
      }),
      entry({
        id: 'e2',
        type: 'effect',
        title: 'Shell',
        detail: { kind: 'shell', toolName: 'bash', display: { summary: 'npm test' }, input: { command: 'npm test' } },
        state: { status: 'failed', error: { message: 'exit 1' }, display: {} },
      }),
      entry({ id: 'a', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }),
      entry({
        id: 'n',
        type: 'notice',
        level: 'error',
        message: 'Rate limited',
        detail: { kind: 'agent_changed', agentName: 'x' },
      }),
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 's-1' },
      {
        type: 'tool-start',
        id: 'e1',
        name: 'search_replace',
        input: { filePath: 'a.ts', oldString: 'a', newString: 'b' },
      },
      { type: 'tool-end', id: 'e1', name: 'search_replace', isError: false, output: 'ok' },
      { type: 'file-change', paths: ['a.ts'] },
      { type: 'tool-start', id: 'e2', name: 'bash', input: { command: 'npm test' } },
      { type: 'tool-end', id: 'e2', name: 'bash', isError: true, output: 'exit 1' },
      { type: 'message', text: 'Done.' },
      { type: 'error', message: 'Rate limited' },
    ]);
  });
});

describe('antigravity driver', () => {
  it('maps task options to print-mode flags', () => {
    expect(antigravityArgs({ prompt: 'go', cwd: '.', model: 'm', effort: 'high' })).toEqual([
      '--mode',
      'accept-edits',
      '--sandbox',
      '--output-format',
      'stream-json',
      '--model',
      'm',
      '--effort',
      'high',
      '--print',
      'go',
    ]);
    expect(antigravityArgs({ prompt: 'go', cwd: '.' }, { sandbox: false, mode: 'plan' })).toEqual([
      '--mode',
      'plan',
      '--output-format',
      'stream-json',
      '--print',
      'go',
    ]);
    expect(antigravityArgs({ prompt: 'next', cwd: '.', resume: 'c-1', permissions: 'yolo' })).toEqual([
      '--mode',
      'accept-edits',
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--conversation',
      'c-1',
      '--print',
      'next',
    ]);
    expect(antigravityAcpArgs({ prompt: 'go', cwd: '.' })).toEqual(['acp', '--sandbox']);
    expect(antigravityAcpArgs({ prompt: 'go', cwd: '.', permissions: 'yolo' })).toEqual(['acp']);
    expect(
      antigravityMcpServers([{ name: 'docs', url: 'https://mcp.example', headers: { Authorization: 's' } }]),
    ).toEqual([
      { type: 'http', name: 'docs', url: 'https://mcp.example', headers: [{ name: 'Authorization', value: 's' }] },
    ]);
    expect(antigravity().capabilities).toMatchObject({
      mcp: true,
      resume: true,
      approvals: true,
      steer: true,
      permissions: { approval: ['ask', 'auto-approve', 'deny'], sandbox: ['workspace-write', 'unrestricted'] },
    });
  });

  it('drives agy acp with mcpServers, session/resume, tool calls, file changes and usage', async () => {
    const servers = [
      { name: 'docs', url: 'https://mcp.example/docs', headers: { Authorization: 'Bearer secret' } },
      { name: 'fs', command: 'mcp-fs', args: ['--root', '.'], env: { LOG: '1' } },
    ];
    const run = antigravity({ command: agyBin }).run({
      prompt: 'go',
      cwd: dir,
      model: 'gemini-3',
      effort: 'high',
      mcpServers: servers,
    });
    const events: AgentEvent[] = [];
    for await (const event of run) events.push(event);
    const result = await run.result;
    expect(result.status).toBe('completed');
    expect(result.sessionId).toBe('c-acp');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 4, totalTokens: 15, cachedInputTokens: 3 });
    expect(events).toContainEqual({ type: 'file-change', paths: ['src/a.ts'] });
    const log = JSON.parse(result.text!) as { argv: string[]; calls: Array<{ method: string; params: unknown }> };
    expect(log.argv).toEqual(['acp', '--sandbox']);
    expect(log.argv.join(' ')).not.toContain('secret');
    expect(log.calls.map((c) => c.method)).toEqual([
      'initialize',
      'session/new',
      'session/set_mode',
      'session/set_model',
      'session/set_config_option',
      'session/prompt',
    ]);
    expect(log.calls[1]?.params).toEqual({
      cwd: dir,
      mcpServers: [
        {
          type: 'http',
          name: 'docs',
          url: 'https://mcp.example/docs',
          headers: [{ name: 'Authorization', value: 'Bearer secret' }],
        },
        {
          type: 'stdio',
          name: 'fs',
          command: 'mcp-fs',
          args: ['--root', '.'],
          env: [{ name: 'LOG', value: '1' }],
        },
      ],
    });

    const resumed = await antigravity({ command: agyBin }).run({
      prompt: 'second',
      cwd: dir,
      resume: 'c-prev',
      mcpServers: servers.slice(0, 1),
    }).result;
    const resumedLog = JSON.parse(resumed.text!) as { calls: Array<{ method: string; params: unknown }> };
    expect(resumedLog.calls[1]).toEqual({
      method: 'session/resume',
      params: {
        sessionId: 'c-prev',
        cwd: dir,
        mcpServers: [
          {
            type: 'http',
            name: 'docs',
            url: 'https://mcp.example/docs',
            headers: [{ name: 'Authorization', value: 'Bearer secret' }],
          },
        ],
      },
    });
  });

  it('routes ACP permission requests to onApproval and honors auto-approve / deny', async () => {
    const seen: unknown[] = [];
    const asked = await antigravity({ command: agyBin }).run({
      prompt: 'go',
      cwd: dir,
      env: { ...process.env, FAKE_ACP_MODE: 'approval' },
      permissions: { approval: 'ask' },
      onApproval: (req) => {
        seen.push(req);
        return 'approve';
      },
    }).result;
    expect(seen).toMatchObject([{ id: 'tc-cmd', kind: 'command', summary: 'Run npm test', scope: 'once' }]);
    expect(asked.text).toMatch(/^approval:allow /);

    const denied = await antigravity({ command: agyBin }).run({
      prompt: 'go',
      cwd: dir,
      env: { ...process.env, FAKE_ACP_MODE: 'approval' },
      permissions: { approval: 'deny' },
    }).result;
    expect(denied.text).toMatch(/^approval:deny /);

    const auto = await antigravity({ command: agyBin }).run({
      prompt: 'go',
      cwd: dir,
      env: { ...process.env, FAKE_ACP_MODE: 'approval' },
      permissions: 'yolo',
    }).result;
    expect(auto.text).toMatch(/^approval:allow /);
  });

  it('steers a running ACP turn', async () => {
    const run = antigravity({ command: agyBin }).run({
      prompt: 'initial',
      cwd: dir,
      env: { ...process.env, FAKE_ACP_MODE: 'steer' },
    });
    for await (const event of run) {
      if (event.type === 'tool-start') void run.steer!('follow-up');
    }
    const result = await run.result;
    expect(result).toMatchObject({ status: 'completed', text: 'steered:follow-up' });
  });

  it('decodes stream-json', () => {
    const parser = createAntigravityParser();
    const step = (fields: Record<string, unknown>) => ({
      event: 'step_update',
      step_update: { conversation_id: 'c-1', ...fields },
    });
    const events = feed(parser, [
      { event: 'init', conversation_id: 'c-1', init: { cwd: '.', model: 'gemini-x' } },
      step({ step_index: 0, state: 'DONE', step_type: 'user_input' }),
      step({ step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Fixing ' }),
      step({
        step_index: 2,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'npm test' } },
      }),
      step({
        step_index: 2,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', output: 'ok' },
      }),
      step({
        step_index: 3,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'view_file',
        tool_info: { name: 'view_file', error: { type: 'x', message: 'missing' } },
      }),
      step({ step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'done.' }),
      {
        event: 'result',
        result: {
          conversation_id: 'c-1',
          status: 'SUCCESS',
          response: 'Fixing done.',
          usage: { input_tokens: 6, output_tokens: 3, total_tokens: 9, cache_read_tokens: 2 },
        },
      },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 'c-1', model: 'gemini-x' },
      { type: 'text-delta', text: 'Fixing ' },
      { type: 'tool-start', id: '2', name: 'run_command', input: { CommandLine: 'npm test' } },
      { type: 'tool-end', id: '2', name: 'run_command', isError: false, output: 'ok' },
      { type: 'tool-start', id: '3', name: 'view_file' },
      { type: 'tool-end', id: '3', name: 'view_file', isError: true, output: 'missing' },
      { type: 'text-delta', text: 'done.' },
      { type: 'message', text: 'Fixing done.' },
      { type: 'usage', usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9, cachedInputTokens: 2 } },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('reports a failed result', () => {
    const parser = createAntigravityParser();
    const events = feed(parser, [{ event: 'result', result: { status: 'ERROR', error: 'quota exceeded' } }]);
    expect(events).toEqual([{ type: 'error', message: 'quota exceeded' }]);
    expect(parser.outcome?.()).toEqual({ ok: false, error: 'quota exceeded' });
  });
});
