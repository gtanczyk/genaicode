import { describe, expect, it } from 'vitest';
import type { AgentOutputParser } from '../cli-agent.js';
import { copilotArgs, copilotMcpConfig, createCopilotParser } from './copilot.js';

function feed(parser: AgentOutputParser, values: unknown[]) {
  return values.flatMap((value) => parser.event(value));
}

// Every line is an envelope: { type, id, parentId, timestamp, ephemeral?, data }; `result` is flat.
const envelope = (type: string, data: Record<string, unknown>) => ({
  type,
  id: `e-${type}`,
  parentId: null,
  timestamp: '2026-09-23T00:00:00.000Z',
  data,
});

describe('copilot driver', () => {
  it('maps task options to prompt-mode flags', () => {
    expect(copilotArgs({ prompt: '-go', cwd: '.', model: 'gpt-x', effort: 'high' })).toEqual([
      '--output-format',
      'json',
      '--allow-all-tools',
      '--no-ask-user',
      '--model',
      'gpt-x',
      '--reasoning-effort',
      'high',
      '--prompt=-go',
    ]);
  });

  it('passes permission patterns one value per flag', () => {
    expect(
      copilotArgs(
        { prompt: 'go', cwd: '.' },
        {
          allowAllTools: false,
          allowTools: ['write'],
          denyTools: ['shell(rm)'],
          excludedTools: ['web_fetch', 'web_search'],
        },
      ),
    ).toEqual([
      '--output-format',
      'json',
      '--allow-tool=write',
      '--deny-tool=shell(rm)',
      '--excluded-tools=web_fetch,web_search',
      '--no-ask-user',
      '--prompt=go',
    ]);
  });

  it('points at the MCP config file and pre-allows its servers without --allow-all-tools', () => {
    const task = {
      prompt: 'go',
      cwd: '.',
      mcpServers: [
        { name: 'docs', url: 'https://mcp.example' },
        { name: 'genaicode_ask', url: 'http://127.0.0.1:1/mcp', trusted: true },
      ],
    };
    expect(copilotArgs(task, {}, '/tmp/m.json')).toEqual([
      '--output-format',
      'json',
      '--allow-all-tools',
      '--no-ask-user',
      '--additional-mcp-config',
      '@/tmp/m.json',
      '--prompt=go',
    ]);
    const args = copilotArgs(task, { allowAllTools: false }, '/tmp/m.json');
    expect(args).toContain('--allow-tool=docs');
    expect(args).toContain('--allow-tool=genaicode_ask');
    // A trusted server is pre-allowed even when allowMcpTools is off; untrusted servers are not.
    const strict = copilotArgs(task, { allowAllTools: false, allowMcpTools: false }, '/tmp/m.json');
    expect(strict).toContain('--allow-tool=genaicode_ask');
    expect(strict).not.toContain('--allow-tool=docs');
  });

  it('builds the MCP config document', () => {
    expect(
      copilotMcpConfig([
        { name: 'docs', url: 'https://mcp.example', headers: { Authorization: 'Bearer s' }, toolTimeoutSec: 86_400 },
        { name: 'fs', command: 'mcp-fs', args: ['.'], env: { LOG: '1' }, toolTimeoutSec: 300 },
      ]),
    ).toEqual({
      mcpServers: {
        docs: {
          type: 'http',
          url: 'https://mcp.example',
          tools: ['*'],
          headers: { Authorization: 'Bearer s' },
          timeout: 86_400_000,
        },
        fs: {
          type: 'local',
          command: 'mcp-fs',
          args: ['.'],
          tools: ['*'],
          env: { LOG: '1' },
          timeout: 300_000,
        },
      },
    });
  });

  it('names no model Auto picked when the request fails before any reply', () => {
    const events = feed(createCopilotParser(), [
      envelope('session.start', { sessionId: 's-1', selectedModel: 'auto' }),
      envelope('session.auto_mode_resolved', { chosenModel: 'claude-sonnet-4.6' }),
      envelope('session.error', { message: 'quota exceeded' }),
    ]);
    expect(events.filter((event) => event.type === 'session')).toEqual([{ type: 'session', sessionId: 's-1' }]);
  });

  it('keeps the model a reply names when that reply then calls a tool', () => {
    const events = feed(createCopilotParser(), [
      envelope('session.start', { sessionId: 's-1', selectedModel: 'auto' }),
      envelope('session.auto_mode_resolved', { chosenModel: 'model-a' }),
      envelope('assistant.message', { messageId: 'm1', content: 'Reading.', model: 'model-b' }),
      envelope('tool.execution_start', { toolCallId: 't1', toolName: 'view', arguments: { path: 'a.ts' } }),
    ]);
    expect(events.filter((event) => event.type === 'session').at(-1)).toEqual({
      type: 'session',
      sessionId: 's-1',
      model: 'model-b',
    });
  });

  it('reports the model Auto picks and the one a reply names', () => {
    const events = feed(createCopilotParser(), [
      envelope('session.start', { sessionId: 's-1', selectedModel: 'auto' }),
      envelope('session.auto_mode_resolved', { chosenModel: 'claude-sonnet-4.6' }),
      envelope('assistant.message', { messageId: 'm1', content: 'Hi', model: 'claude-sonnet-4.6' }),
      envelope('session.model_change', { previousModel: 'claude-sonnet-4.6', newModel: 'gpt-5.4' }),
      envelope('assistant.message', { messageId: 'm2', content: 'Again' }),
      envelope('assistant.message', { messageId: 'm3', content: 'More', model: 'gpt-x' }),
    ]);
    expect(events.filter((event) => event.type === 'session')).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'session', sessionId: 's-1', model: 'claude-sonnet-4.6' },
      { type: 'session', sessionId: 's-1', model: 'gpt-5.4' },
      { type: 'session', sessionId: 's-1', model: 'gpt-x' },
    ]);
  });

  it('decodes the JSONL session events', () => {
    const parser = createCopilotParser();
    const events = feed(parser, [
      envelope('session.mcp_servers_loaded', { servers: [] }),
      envelope('session.start', { sessionId: 's-1', selectedModel: 'gpt-x', copilotVersion: '1.0.88' }),
      envelope('assistant.reasoning_delta', { deltaContent: 'thinking' }),
      envelope('assistant.message_delta', { messageId: 'm1', deltaContent: 'Editing ' }),
      envelope('assistant.message', { messageId: 'm1', content: 'Editing a.py', outputTokens: 4 }),
      envelope('tool.execution_start', { toolCallId: 't1', toolName: 'edit', arguments: { path: 'a.py' } }),
      envelope('tool.execution_complete', { toolCallId: 't1', success: true, result: { content: 'ok' } }),
      envelope('tool.execution_start', { toolCallId: 't2', toolName: 'bash', arguments: { command: 'false' } }),
      envelope('tool.execution_complete', {
        toolCallId: 't2',
        success: true,
        shellExecution: { exitCode: 1 },
        result: { content: '' },
      }),
      envelope('tool.execution_start', {
        toolCallId: 't3',
        toolName: 'docs-search',
        mcpServerName: 'docs',
        mcpToolName: 'search',
        arguments: { q: 'x' },
      }),
      envelope('tool.execution_complete', { toolCallId: 't3', success: false, error: { message: 'denied' } }),
      envelope('assistant.message', { messageId: 'm2', content: 'sub', parentToolCallId: 't9' }),
      { ...envelope('assistant.message', { messageId: 'm4', content: 'sub-agent text' }), agentId: 'sa-1' },
      { ...envelope('assistant.message_delta', { messageId: 'm4', deltaContent: 'sub' }), agentId: 'sa-1' },
      envelope('assistant.message', { messageId: 'm3', content: 'Done.', outputTokens: 5 }),
      {
        type: 'result',
        timestamp: '2026-09-23T00:00:01.000Z',
        sessionId: 's-1',
        exitCode: 0,
        usage: {
          premiumRequests: 1,
          totalApiDurationMs: 900,
          sessionDurationMs: 1000,
          codeChanges: { linesAdded: 2, linesRemoved: 1, filesModified: ['a.py', 'b.py'] },
        },
      },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 's-1', model: 'gpt-x' },
      { type: 'text-delta', text: 'Editing ' },
      { type: 'message', text: 'Editing a.py' },
      { type: 'tool-start', id: 't1', name: 'edit', input: { path: 'a.py' } },
      { type: 'tool-end', id: 't1', name: 'edit', isError: false, output: 'ok' },
      { type: 'file-change', paths: ['a.py'] },
      { type: 'tool-start', id: 't2', name: 'bash', input: { command: 'false' } },
      { type: 'tool-end', id: 't2', name: 'bash', isError: true, output: '' },
      { type: 'tool-start', id: 't3', name: 'docs/search', input: { q: 'x' } },
      { type: 'tool-end', id: 't3', name: 'docs/search', isError: true, output: 'denied' },
      { type: 'message', text: 'Done.' },
      { type: 'file-change', paths: ['b.py'] },
      { type: 'usage', usage: { outputTokens: 9 } },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('fails on a non-zero result and reports the last session error', () => {
    const parser = createCopilotParser();
    const events = feed(parser, [
      envelope('session.error', { errorType: 'model', message: 'Model not available' }),
      { type: 'result', sessionId: 's-2', exitCode: 1, usage: { codeChanges: { filesModified: [] } } },
    ]);
    expect(events).toEqual([
      { type: 'error', message: 'Model not available' },
      { type: 'session', sessionId: 's-2' },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: false, error: 'Model not available' });
  });

  it('fails a blocked run even with exit code 0', () => {
    const parser = createCopilotParser();
    const events = feed(parser, [
      { type: 'result', sessionId: 's-3', exitCode: 0, outcome: 'blocked', blocker: 'needs input' },
    ]);
    expect(events).toContainEqual({ type: 'error', message: 'Copilot is blocked: needs input' });
    expect(parser.outcome?.()).toEqual({ ok: false, error: 'Copilot is blocked: needs input' });
  });
});
