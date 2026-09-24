import { describe, expect, it } from 'vitest';
import type { AgentOutputParser } from '../cli-agent.js';
import { antigravityArgs, createAntigravityParser } from './antigravity.js';
import { createVibeParser, vibe, vibeArgs } from './vibe.js';

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
    expect(vibe().capabilities).toEqual({ maxTurns: true });
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
