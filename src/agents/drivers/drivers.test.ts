import { describe, expect, it } from 'vitest';
import { claudeArgs, createClaudeParser } from './claude.js';
import { codexArgs, createCodexParser } from './codex.js';
import { codexChangesDiff, codexNotification } from './codex-live.js';
import { createMuseParser, museArgs } from './muse.js';
import { museNotification } from './muse-live.js';
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

  it('passes claude settings once, merged with the sandbox ones', () => {
    const settings = { disableAllHooks: true };
    const plain = claudeArgs({ prompt: 'hi', cwd: '.' }, { settings });
    expect(plain.slice(plain.indexOf('--settings'), plain.indexOf('--settings') + 2)).toEqual([
      '--settings',
      '{"disableAllHooks":true}',
    ]);
    const sandboxed = claudeArgs({ prompt: 'hi', cwd: '.', permissions: { sandbox: 'read-only' } }, { settings });
    expect(sandboxed.filter((arg) => arg === '--settings')).toHaveLength(1);
    expect(JSON.parse(sandboxed[sandboxed.indexOf('--settings') + 1]!)).toEqual({
      disableAllHooks: true,
      sandbox: { enabled: false },
    });
  });

  it('omits the fallback --permission-mode when settings or inheritPermissionMode provides defaultMode', () => {
    const inherited = claudeArgs({ prompt: 'hi', cwd: '.' }, {}, undefined, undefined, false, true);
    expect(inherited).not.toContain('--permission-mode');
    const viaSettings = claudeArgs({ prompt: 'hi', cwd: '.' }, { settings: { permissions: { defaultMode: 'auto' } } });
    expect(viaSettings).not.toContain('--permission-mode');
    const disabledAuto = claudeArgs(
      { prompt: 'hi', cwd: '.' },
      { settings: { permissions: { defaultMode: 'auto' }, disableAutoMode: 'disable' } },
    );
    expect(
      disabledAuto.slice(disabledAuto.indexOf('--permission-mode'), disabledAuto.indexOf('--permission-mode') + 2),
    ).toEqual(['--permission-mode', 'acceptEdits']);
    const nestedDisabledAuto = claudeArgs(
      { prompt: 'hi', cwd: '.' },
      { settings: { permissions: { defaultMode: 'auto', disableAutoMode: 'disable' } } },
    );
    expect(
      nestedDisabledAuto.slice(
        nestedDisabledAuto.indexOf('--permission-mode'),
        nestedDisabledAuto.indexOf('--permission-mode') + 2,
      ),
    ).toEqual(['--permission-mode', 'acceptEdits']);
    const explicit = claudeArgs(
      { prompt: 'hi', cwd: '.' },
      { permissionMode: 'plan', settings: { permissions: { defaultMode: 'auto' } } },
      undefined,
      undefined,
      false,
      true,
    );
    expect(explicit.slice(explicit.indexOf('--permission-mode'), explicit.indexOf('--permission-mode') + 2)).toEqual([
      '--permission-mode',
      'plan',
    ]);
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
    expect(codexArgs({ prompt: 'go', cwd: '.' }, { config: { 'features.shell_tool': false, x: 'y' } })).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '-c',
      'features.shell_tool=false',
      '-c',
      'x="y"',
      'go',
    ]);
    expect(codexArgs({ prompt: 'go', cwd: '.' }, { config: { 'a.roots': [] } })).toContain('a.roots=[]');
  });

  it('includes the result or error text of live MCP tool calls in the chat', () => {
    const item = { id: 'i1', type: 'mcpToolCall', server: 'pack', tool: 'agents' };
    const completed = (fields: Record<string, unknown>) =>
      codexNotification('item/completed', { item: { ...item, ...fields } });
    expect(completed({ status: 'failed', error: { message: 'Tool call declined' } })).toEqual([
      { type: 'tool-end', id: 'i1', name: 'pack/agents', isError: true, output: 'Tool call declined' },
    ]);
    expect(
      completed({ status: 'completed', error: null, result: { content: [{ type: 'text', text: 'codex' }] } }),
    ).toEqual([{ type: 'tool-end', id: 'i1', name: 'pack/agents', isError: false, output: 'codex' }]);
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
      { type: 'item.started', item: { id: 'i5', type: 'mcp_tool_call', server: 'docs', tool: 'read' } },
      {
        type: 'item.completed',
        item: {
          id: 'i5',
          type: 'mcp_tool_call',
          server: 'docs',
          tool: 'read',
          status: 'completed',
          error: null,
          result: {
            content: [
              { type: 'text', text: 'page one' },
              { type: 'text', text: 'page two' },
            ],
          },
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
      { type: 'tool-start', id: 'i5', name: 'docs/read', input: undefined },
      { type: 'tool-end', id: 'i5', name: 'docs/read', isError: false, output: 'page one\npage two' },
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

  it('turns the changes of a file-change item into one patch', () => {
    expect(
      codexChangesDiff([
        { path: '/w/a.txt', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-first\n+hello\n' },
        { path: '/w/new.txt', kind: { type: 'add' }, diff: 'one\ntwo\n' },
        { path: '/w/old.txt', kind: 'delete', diff: 'gone' },
        { path: '/w/none.txt', kind: { type: 'update' } },
      ]),
    ).toBe(
      [
        '--- /w/a.txt',
        '+++ /w/a.txt',
        '@@ -1 +1 @@',
        '-first',
        '+hello',
        '--- /dev/null',
        '+++ /w/new.txt',
        '@@ -0,0 +1,2 @@',
        '+one',
        '+two',
        '--- /w/old.txt',
        '+++ /dev/null',
        '@@ -1,1 +0,0 @@',
        '-gone',
      ].join('\n'),
    );
    expect(codexChangesDiff([{ path: '/w/a.txt' }])).toBeUndefined();
    // A new file whose text is a patch is still three added lines.
    expect(codexChangesDiff([{ path: '/w/f.patch', kind: { type: 'add' }, diff: '@@ -1 +1 @@\n-old\n+new\n' }])).toBe(
      ['--- /dev/null', '+++ /w/f.patch', '@@ -0,0 +1,3 @@', '+@@ -1 +1 @@', '+-old', '++new'].join('\n'),
    );
  });

  it('keeps a note about its own hook timeout out of the errors', () => {
    const note = 'clamping SessionEnd hook timeout to 3s in ~/.codex/hooks.json';
    expect(
      feed(createCodexParser(), [
        { type: 'error', message: note },
        { type: 'error', message: 'stream disconnected' },
      ]),
    ).toEqual([
      { type: 'stderr', text: note },
      { type: 'error', message: 'stream disconnected' },
    ]);
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
      { payload_type: 'task.lifecycle.side_effect_intent', payload: { event: { operation: 'reminder.child_run' } } },
      { payload_type: 'task.lifecycle.side_effect_intent', payload: { event: { operation: 'fs.write' } } },
      { payload_type: 'task.lifecycle.side_effect_intent', payload: { event: { operation: 'tool:bash' } } },
      { payload_type: 'run.output.delta', payload: { text: 'Hello ' } },
      { payload_type: 'run.output.delta', payload: { text: 'world' } },
      { payload_type: 'run.terminal.completed', payload: {} },
    ]);
    expect(events).toEqual([
      { type: 'session', sessionId: 'se-1' },
      { type: 'tool-start', name: 'fs.write' },
      { type: 'tool-start', name: 'bash' },
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'world' },
      { type: 'message', text: 'Hello world' },
    ]);
    expect(parser.outcome?.()).toEqual({ ok: true });
  });

  it('maps muse serve items as the server sends them', () => {
    const item = { itemId: 'i1', kind: 'toolCall', tool: 'bash', status: 'inProgress', args: '{}' };
    expect(museNotification('item/started', { item })).toEqual([{ type: 'tool-start', id: 'i1', name: 'bash' }]);
    expect(museNotification('item/completed', { item: { ...item, status: 'failed' } })).toEqual([
      { type: 'tool-end', id: 'i1', name: 'bash', isError: true },
    ]);
    expect(museNotification('item/started', { item: { itemId: 'r1', kind: 'reminderChild' } })).toEqual([]);
    expect(museNotification('item/completed', { item: { itemId: 'm1', kind: 'agentMessage', text: 'hi' } })).toEqual([
      { type: 'message', text: 'hi' },
    ]);
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
