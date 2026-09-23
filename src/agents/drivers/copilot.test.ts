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
        { allowAllTools: false, allowTools: ['write'], denyTools: ['shell(rm)'] },
      ),
    ).toEqual([
      '--output-format',
      'json',
      '--allow-tool=write',
      '--deny-tool=shell(rm)',
      '--no-ask-user',
      '--prompt=go',
    ]);
  });

  it('points at the MCP config file and pre-allows its servers without --allow-all-tools', () => {
    const task = { prompt: 'go', cwd: '.', mcpServers: [{ name: 'docs', url: 'https://mcp.example' }] };
    expect(copilotArgs(task, {}, '/tmp/m.json')).toEqual([
      '--output-format',
      'json',
      '--allow-all-tools',
      '--no-ask-user',
      '--additional-mcp-config',
      '@/tmp/m.json',
      '--prompt=go',
    ]);
    expect(copilotArgs(task, { allowAllTools: false }, '/tmp/m.json')).toContain('--allow-tool=docs');
  });

  it('builds the MCP config document', () => {
    expect(
      copilotMcpConfig([
        { name: 'docs', url: 'https://mcp.example', headers: { Authorization: 'Bearer s' } },
        { name: 'fs', command: 'mcp-fs', args: ['.'], env: { LOG: '1' } },
      ]),
    ).toEqual({
      mcpServers: {
        docs: { type: 'http', url: 'https://mcp.example', tools: ['*'], headers: { Authorization: 'Bearer s' } },
        fs: { type: 'local', command: 'mcp-fs', args: ['.'], tools: ['*'], env: { LOG: '1' } },
      },
    });
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
