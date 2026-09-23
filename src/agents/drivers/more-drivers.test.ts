import { describe, expect, it } from 'vitest';
import type { AgentOutputParser } from '../cli-agent.js';
import { createCursorParser, cursorArgs } from './cursor.js';
import { createGeminiParser, geminiArgs } from './gemini.js';
import { createOpencodeParser, opencodeArgs } from './opencode.js';

function feed(parser: AgentOutputParser, values: unknown[]) {
  return values.flatMap((value) => parser.event(value));
}

describe('gemini driver', () => {
  it('maps task options to headless flags', () => {
    expect(geminiArgs({ prompt: '-go', cwd: '.', model: 'gemini-x' })).toEqual([
      '--output-format',
      'stream-json',
      '--approval-mode',
      'auto_edit',
      '--skip-trust',
      '--model',
      'gemini-x',
      '--prompt=-go',
    ]);
  });

  it('decodes stream-json', () => {
    const parser = createGeminiParser();
    const events = feed(parser, [
      { type: 'init', session_id: 'g-1', model: 'gemini-x' },
      { type: 'message', role: 'user', content: 'go' },
      { type: 'message', role: 'assistant', content: 'Fixing ', delta: true },
      { type: 'tool_use', tool_name: 'replace', tool_id: 't1', parameters: { file_path: 'a.ts' } },
      { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' },
      { type: 'message', role: 'assistant', content: 'done.', delta: true },
      { type: 'result', status: 'success', stats: { total_tokens: 9, input_tokens: 6, output_tokens: 3, cached: 2 } },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 'g-1', model: 'gemini-x' },
      { type: 'text-delta', text: 'Fixing ' },
      { type: 'tool-start', id: 't1', name: 'replace', input: { file_path: 'a.ts' } },
      { type: 'file-change', paths: ['a.ts'] },
      { type: 'tool-end', id: 't1', name: 'replace', isError: false, output: 'ok' },
      { type: 'text-delta', text: 'done.' },
      { type: 'message', text: 'Fixing done.' },
      { type: 'usage', usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9, cachedInputTokens: 2 } },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('reports an error result', () => {
    const parser = createGeminiParser();
    feed(parser, [{ type: 'result', status: 'error', error: { type: 'X', message: 'quota' } }]);
    expect(parser.outcome?.()).toEqual({ ok: false, error: 'quota' });
  });
});

describe('cursor driver', () => {
  it('maps task options to print-mode flags', () => {
    expect(cursorArgs({ prompt: 'go', cwd: '.', model: 'm' })).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--force',
      '--approve-mcps',
      '--model',
      'm',
      'go',
    ]);
    expect(cursorArgs({ prompt: 'go', cwd: '.' }, { force: false, approveMcps: false, partialOutput: true })).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      'go',
    ]);
  });

  it('decodes function tool calls', () => {
    const parser = createCursorParser();
    const events = feed(parser, [
      {
        type: 'tool_call',
        subtype: 'started',
        call_id: 'f1',
        tool_call: { function: { name: 'grep', arguments: '{"pattern":"x"}' } },
      },
      {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'f1',
        tool_call: { function: { name: 'grep', arguments: '{"pattern":"x"}' } },
      },
    ]);
    expect(events).toEqual([
      { type: 'tool-start', id: 'f1', name: 'grep', input: { pattern: 'x' } },
      { type: 'tool-end', id: 'f1', name: 'grep', isError: false },
    ]);
  });

  it('streams partial output and skips flushes that repeat it', () => {
    const parser = createCursorParser({ partialOutput: true });
    const text = (value: string) => ({ role: 'assistant', content: [{ type: 'text', text: value }] });
    const events = feed(parser, [
      { type: 'assistant', message: text('Hel'), timestamp_ms: 1 },
      { type: 'assistant', message: text('lo'), timestamp_ms: 2 },
      { type: 'assistant', message: text('Hello'), timestamp_ms: 3, model_call_id: 'mc1' },
      { type: 'assistant', message: text('Hello') },
      { type: 'result', subtype: 'success', is_error: false, result: 'Hello' },
    ]);
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'message', text: 'Hello' },
    ]);
  });

  it('decodes stream-json', () => {
    const parser = createCursorParser();
    const events = feed(parser, [
      { type: 'system', subtype: 'init', session_id: 'c-1', model: 'auto' },
      { type: 'assistant', session_id: 'c-1', message: { content: [{ type: 'text', text: 'Editing' }] } },
      {
        type: 'tool_call',
        subtype: 'started',
        call_id: 'k1',
        tool_call: { writeToolCall: { args: { path: 'b.ts' } } },
      },
      {
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'k1',
        tool_call: { writeToolCall: { args: { path: 'b.ts' }, result: { success: {} } } },
      },
      { type: 'result', subtype: 'success', is_error: false, result: 'All done' },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 'c-1', model: 'auto' },
      { type: 'message', text: 'Editing' },
      { type: 'tool-start', id: 'k1', name: 'write', input: { path: 'b.ts' } },
      { type: 'tool-end', id: 'k1', name: 'write', isError: false },
      { type: 'file-change', paths: ['b.ts'] },
      { type: 'message', text: 'All done' },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });
});

describe('opencode driver', () => {
  it('maps task options to run flags', () => {
    expect(opencodeArgs({ prompt: 'go', cwd: '.', model: 'anthropic/x', effort: 'high' }, { agent: 'build' })).toEqual([
      'run',
      '--format',
      'json',
      '--agent',
      'build',
      '--model',
      'anthropic/x',
      '--variant',
      'high',
      '--',
      'go',
    ]);
  });

  it('decodes json events and sums usage across steps', () => {
    const parser = createOpencodeParser();
    const events = feed(parser, [
      { type: 'step_start', sessionID: 'o-1', part: {} },
      {
        type: 'tool_use',
        sessionID: 'o-1',
        part: { tool: 'edit', callID: 'x1', state: { status: 'completed', input: { filePath: 'c.ts' }, output: 'ok' } },
      },
      {
        type: 'step_finish',
        sessionID: 'o-1',
        part: { tokens: { input: 4, output: 1, cache: { read: 1 } }, cost: 0.1 },
      },
      { type: 'text', sessionID: 'o-1', part: { text: ' Done. ' } },
      { type: 'step_finish', sessionID: 'o-1', part: { tokens: { input: 2, output: 2 }, cost: 0.05 } },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 'o-1' },
      { type: 'tool-end', id: 'x1', name: 'edit', isError: false, output: 'ok' },
      { type: 'file-change', paths: ['c.ts'] },
      {
        type: 'usage',
        usage: { inputTokens: 4, outputTokens: 1, cachedInputTokens: 1, totalTokens: 5 },
        costUsd: 0.1,
      },
      { type: 'message', text: 'Done.' },
      {
        type: 'usage',
        usage: { inputTokens: 6, outputTokens: 3, cachedInputTokens: 1, totalTokens: 9 },
        costUsd: expect.closeTo(0.15),
      },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('fails on a session error', () => {
    const parser = createOpencodeParser();
    feed(parser, [{ type: 'error', sessionID: 'o-1', error: { name: 'APIError', data: { message: 'bad key' } } }]);
    expect(parser.outcome?.()).toEqual({ ok: false, error: 'bad key' });
  });
});
