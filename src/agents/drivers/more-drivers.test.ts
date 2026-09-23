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
      '--trust',
      '--stream-partial-output',
      'go',
    ]);
  });

  // Trimmed from a cursor-agent 2026.09.18 run: read, edit and shell tool calls.
  const session = { session_id: 's-1' };
  const read = { args: { path: '/w/a.py' } };
  const edit = { args: { path: '/w/a.py', streamContent: 'x = 2' } };
  const shell = { args: { command: "python3 -c 'print(1)'", timeout: 30000 }, description: 'Run python' };
  const tool = (subtype: string, id: string, call: Record<string, unknown>) => ({
    type: 'tool_call',
    subtype,
    call_id: id,
    tool_call: call,
    model_call_id: 'mc-1',
    timestamp_ms: 1,
    ...session,
  });
  const assistant = (text: string, extra: Record<string, unknown> = {}) => ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...session,
    ...extra,
  });
  const result = {
    type: 'result',
    subtype: 'success',
    duration_ms: 13381,
    is_error: false,
    result: "I'll edit a.py.`a.py`: `x = 2`.",
    ...session,
    usage: { inputTokens: 31692, outputTokens: 423, cacheReadTokens: 27520, cacheWriteTokens: 0 },
  };
  const toolEvents = [
    tool('started', 'k1', { readToolCall: read }),
    tool('completed', 'k1', {
      readToolCall: { ...read, result: { success: { content: 'x = 1\n', path: '/w/a.py', totalLines: 2 } } },
    }),
    tool('started', 'k2', { editToolCall: edit }),
    tool('completed', 'k2', {
      editToolCall: { ...edit, result: { success: { path: '/w/a.py', linesAdded: 1, message: 'Updated.' } } },
    }),
    tool('started', 'k3', { shellToolCall: shell }),
    tool('completed', 'k3', {
      shellToolCall: { ...shell, result: { success: { exitCode: 0, stdout: '1\n', interleavedOutput: '1\n' } } },
    }),
  ];
  const decodedTools = [
    { type: 'tool-start', id: 'k1', name: 'read', input: read.args },
    { type: 'tool-end', id: 'k1', name: 'read', isError: false, output: 'x = 1\n' },
    { type: 'tool-start', id: 'k2', name: 'edit', input: edit.args },
    { type: 'tool-end', id: 'k2', name: 'edit', isError: false, output: 'Updated.' },
    { type: 'file-change', paths: ['/w/a.py'] },
    { type: 'tool-start', id: 'k3', name: 'shell', input: shell.args },
    { type: 'tool-end', id: 'k3', name: 'shell', isError: false, output: '1\n' },
  ];
  const usage = {
    type: 'usage',
    usage: { inputTokens: 31692, outputTokens: 423, cachedInputTokens: 27520, totalTokens: 32115 },
  };

  it('decodes stream-json', () => {
    const parser = createCursorParser();
    const events = feed(parser, [
      { type: 'system', subtype: 'init', apiKeySource: 'login', model: 'Auto', permissionMode: 'default', ...session },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'go' }] }, ...session },
      { type: 'thinking', subtype: 'delta', text: 'The user wants', timestamp_ms: 1, ...session },
      { type: 'thinking', subtype: 'completed', timestamp_ms: 2, ...session },
      assistant("I'll edit a.py."),
      ...toolEvents,
      assistant('`a.py`: `x = 2`.'),
      result,
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 's-1', model: 'Auto' },
      { type: 'message', text: "I'll edit a.py." },
      ...decodedTools,
      { type: 'message', text: '`a.py`: `x = 2`.' },
      usage,
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('streams partial output as deltas and one message per segment', () => {
    const parser = createCursorParser({ partialOutput: true });
    const events = feed(parser, [
      assistant("I'll", { timestamp_ms: 1 }),
      assistant(' edit a.py.', { timestamp_ms: 2 }),
      assistant('', { timestamp_ms: 3 }),
      ...toolEvents.slice(2, 4),
      assistant('`a.py`: ', { timestamp_ms: 4 }),
      assistant('`x = 2`.', { timestamp_ms: 5 }),
      result,
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'text-delta', text: "I'll" },
      { type: 'text-delta', text: ' edit a.py.' },
      { type: 'message', text: "I'll edit a.py." },
      ...decodedTools.slice(2, 5),
      { type: 'text-delta', text: '`a.py`: ' },
      { type: 'text-delta', text: '`x = 2`.' },
      { type: 'message', text: '`a.py`: `x = 2`.' },
      usage,
    ]);
  });

  it('reports a failed shell command and function tool calls', () => {
    const parser = createCursorParser();
    const events = feed(parser, [
      tool('completed', 'k4', {
        shellToolCall: { ...shell, result: { success: { exitCode: 2, stdout: '', interleavedOutput: 'boom\n' } } },
      }),
      tool('started', 'f1', { function: { name: 'grep', arguments: '{"pattern":"x"}' } }),
      tool('completed', 'f1', { function: { name: 'grep', arguments: '{"pattern":"x"}' } }),
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'tool-end', id: 'k4', name: 'shell', isError: true, output: 'boom\n' },
      { type: 'tool-start', id: 'f1', name: 'grep', input: { pattern: 'x' } },
      { type: 'tool-end', id: 'f1', name: 'grep', isError: false },
    ]);
  });

  it('keeps the result text when no assistant message came through', () => {
    const parser = createCursorParser();
    expect(feed(parser, [{ ...result, usage: undefined }])).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'message', text: result.result },
    ]);
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
