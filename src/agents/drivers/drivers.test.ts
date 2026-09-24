import { describe, expect, it } from 'vitest';
import { claudeArgs, createClaudeParser } from './claude.js';
import { codexArgs, createCodexParser } from './codex.js';
import { createMuseParser, museArgs } from './muse.js';
import type { AgentOutputParser } from '../cli-agent.js';

function feed(parser: AgentOutputParser, values: unknown[]) {
  return values.flatMap((value) => parser.event(value));
}

describe('claude driver', () => {
  it('maps task options to print-mode flags', () => {
    expect(claudeArgs({ prompt: 'fix it', cwd: '.', model: 'm', effort: 'high', maxTurns: 5 })).toEqual([
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'm',
      '--effort',
      'high',
      '--max-turns',
      '5',
      'fix it',
    ]);
    expect(claudeArgs({ prompt: 'hi', cwd: '.' }, { permissionMode: 'plan', allowedTools: ['Read', 'Grep'] })).toEqual([
      '-p',
      '--verbose',
      '--allowedTools',
      'Read,Grep',
      '--output-format',
      'stream-json',
      '--permission-mode',
      'plan',
      'hi',
    ]);
    expect(claudeArgs({ prompt: '-x', cwd: '.' }).slice(-2)).toEqual(['--', '-x']);
  });

  it('decodes stream-json into agent events', () => {
    const parser = createClaudeParser();
    const events = feed(parser, [
      { type: 'system', subtype: 'init', session_id: 'abc', model: 'claude-x' },
      {
        type: 'assistant',
        session_id: 'abc',
        message: {
          content: [
            { type: 'text', text: 'Editing.' },
            { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/w/a.ts' } },
          ],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }] }] },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done.',
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4 },
      },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 'abc', model: 'claude-x' },
      { type: 'message', text: 'Editing.' },
      { type: 'tool-start', id: 't1', name: 'Edit', input: { file_path: '/w/a.ts' } },
      { type: 'file-change', paths: ['/w/a.ts'] },
      { type: 'tool-end', id: 't1', name: 'Edit', isError: false, output: 'ok' },
      { type: 'message', text: 'Done.' },
      {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, totalTokens: 15 },
        costUsd: 0.01,
      },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('reports an error result as a failed outcome', () => {
    const parser = createClaudeParser();
    const events = feed(parser, [{ type: 'result', subtype: 'error_max_turns', is_error: true }]);
    expect(parser.outcome?.()).toEqual({ ok: false, error: 'Claude stopped: error_max_turns.' });
    expect(events).toContainEqual({ type: 'error', message: 'Claude stopped: error_max_turns.' });
  });
});

describe('codex driver', () => {
  it('maps task options to exec flags', () => {
    expect(codexArgs({ prompt: 'go', cwd: '.', model: 'gpt', effort: 'high' })).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '--model',
      'gpt',
      '-c',
      'model_reasoning_effort="high"',
      'go',
    ]);
    expect(codexArgs({ prompt: 'go', cwd: '.' }, { sandbox: 'read-only', skipGitRepoCheck: false })).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      'go',
    ]);
  });

  it('decodes exec JSONL into agent events', () => {
    const parser = createCodexParser();
    const events = feed(parser, [
      { type: 'thread.started', thread_id: 'th-1' },
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'ls' } },
      { type: 'item.completed', item: { id: 'i1', type: 'command_execution', aggregated_output: 'a\n', exit_code: 0 } },
      { type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: 'a.ts', kind: 'update' }] } },
      { type: 'item.started', item: { id: 'i3', type: 'mcp_tool_call', server: 'docs', tool: 'search' } },
      {
        type: 'item.completed',
        item: {
          id: 'i3',
          type: 'mcp_tool_call',
          server: 'docs',
          tool: 'search',
          status: 'failed',
          error: { message: 'denied' },
        },
      },
      { type: 'item.completed', item: { id: 'i4', type: 'agent_message', text: 'All set.' } },
      { type: 'turn.completed', usage: { input_tokens: 7, cached_input_tokens: 2, output_tokens: 3 } },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 'th-1' },
      { type: 'tool-start', id: 'i1', name: 'shell', input: { command: 'ls' } },
      { type: 'tool-end', id: 'i1', name: 'shell', isError: false, output: 'a\n' },
      { type: 'file-change', paths: ['a.ts'] },
      { type: 'tool-start', id: 'i3', name: 'docs/search', input: undefined },
      { type: 'tool-end', id: 'i3', name: 'docs/search', isError: true, output: 'denied' },
      { type: 'message', text: 'All set.' },
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, cachedInputTokens: 2, totalTokens: 10 } },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('reports a failed turn', () => {
    const parser = createCodexParser();
    expect(feed(parser, [{ type: 'turn.failed', error: { message: 'quota' } }])).toEqual([
      { type: 'error', message: 'quota' },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: false, error: 'quota' });
  });
});

describe('muse driver', () => {
  it('maps task options to exec flags', () => {
    expect(museArgs({ prompt: 'go', cwd: '.', model: 'm', effort: 'low', maxTurns: 9 })).toEqual([
      'exec',
      '--json',
      '--trust-workspace',
      '--model',
      'm',
      '--reasoning-effort',
      'low',
      '--max-model-steps',
      '9',
      'go',
    ]);
  });

  it('decodes the run event stream', () => {
    const parser = createMuseParser();
    const events = feed(parser, [
      { stream: { kind: 'session', id: 'se-1' }, payload_type: 'run.lifecycle.started' },
      {
        stream: { kind: 'session', id: 'se-1' },
        payload_type: 'task.lifecycle.side_effect_intent',
        payload: { event: { operation: 'model.call' } },
      },
      { payload_type: 'task.lifecycle.side_effect_intent', payload: { event: { operation: 'fs.write' } } },
      { payload_type: 'run.output.delta', payload: { text: 'Hello ' } },
      { payload_type: 'run.output.delta', payload: { text: 'world' } },
      { payload_type: 'run.terminal.completed', payload: {} },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 'se-1' },
      { type: 'tool-start', name: 'fs.write' },
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'world' },
      { type: 'message', text: 'Hello world' },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('surfaces approvals and non-completed terminals', () => {
    const parser = createMuseParser();
    const events = feed(parser, [
      { payload_type: 'approval_wait.effect.started', payload: { tool: 'shell' } },
      { payload_type: 'run.terminal.cancelled', payload: { reason: 'user' } },
    ]);
    expect(events).toEqual([
      { type: 'approval-request', request: { id: 'approval', kind: 'other', detail: { tool: 'shell' } } },
      { type: 'error', message: 'Muse run cancelled: user' },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: false, error: 'Muse run cancelled: user' });
  });
});
