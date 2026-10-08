import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { antigravity, antigravityArgs } from './drivers/antigravity.js';
import { claude, claudeArgs } from './drivers/claude.js';
import { claudeApprovalTool, claudeSandboxRefuses } from './drivers/claude-approvals.js';
import { codexArgs } from './drivers/codex.js';
import { copilot, copilotArgs } from './drivers/copilot.js';
import { cursorArgs } from './drivers/cursor.js';
import { gemini, geminiArgs } from './drivers/gemini.js';
import { opencodeArgs } from './drivers/opencode.js';
import { applyPermissionArgs } from './drivers/permission-args.js';
import { vibeArgs } from './drivers/vibe.js';
import { decideApproval, reportApproval } from './live-agent.js';
import { linkAbort } from './runtime.js';
import { mergePermissionFlags, resolvePermissions, unsupportedPermissions } from './permissions.js';
import type { AgentEvent, AgentPermissions, AgentTask, ApprovalHandler, ApprovalRequest } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-permissions-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const task = (permissions: AgentTask['permissions']): AgentTask => ({ prompt: 'go', cwd: dir, permissions });
const request: ApprovalRequest = { id: 'r1', kind: 'command', summary: 'ls' };

describe('resolvePermissions', () => {
  it('expands yolo and rejects unknown values', () => {
    expect(resolvePermissions(undefined)).toEqual({});
    expect(resolvePermissions('yolo')).toEqual({ approval: 'auto-approve', sandbox: 'unrestricted' });
    expect(resolvePermissions({ sandbox: 'read-only' })).toEqual({ sandbox: 'read-only' });
    expect(() => resolvePermissions('full' as never)).toThrow('Invalid task.permissions: "full".');
    expect(() => resolvePermissions(['yolo'] as never)).toThrow('Invalid task.permissions');
    expect(() => resolvePermissions({ sandbbox: 'read-only' } as never)).toThrow(
      'Unknown task.permissions field: sandbbox.',
    );
    expect(() => resolvePermissions({ approval: 'always' as never })).toThrow(
      'Unknown permissions.approval: "always".',
    );
  });

  it('checks values against the capabilities, and ask against onApproval', () => {
    const capabilities = { permissions: { approval: ['ask', 'deny'] as const, sandbox: ['unrestricted'] as const } };
    expect(unsupportedPermissions('x', capabilities, { permissions: { approval: 'deny' } })).toBeUndefined();
    expect(unsupportedPermissions('x', capabilities, { permissions: 'yolo' })).toBe(
      "x cannot run with permissions.approval 'auto-approve' (supported: ask, deny).",
    );
    expect(unsupportedPermissions('x', {}, { permissions: { sandbox: 'read-only' } })).toBe(
      "x cannot run with permissions.sandbox 'read-only' (supported: none).",
    );
    expect(unsupportedPermissions('x', capabilities, { permissions: { approval: 'ask' } })).toBe(
      "permissions.approval 'ask' needs task.onApproval.",
    );
  });
});

describe('decideApproval', () => {
  it('answers deny and auto-approve without asking', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    const signal = new AbortController().signal;
    expect(await decideApproval({ onApproval, permissions: { approval: 'deny' } }, request, signal)).toEqual({
      decision: 'deny',
      automatic: true,
    });
    expect(await decideApproval({ permissions: 'yolo' }, request, signal)).toEqual({
      decision: 'approve',
      automatic: true,
    });
    expect(onApproval).not.toHaveBeenCalled();
    expect(await decideApproval({ onApproval, permissions: { approval: 'ask' } }, request, signal)).toEqual({
      decision: 'approve',
      automatic: false,
    });
  });

  it('never auto-approves a withdrawn request', async () => {
    const gone = new AbortController();
    gone.abort();
    expect(await decideApproval({ permissions: 'yolo' }, request, gone.signal)).toMatchObject({ decision: 'deny' });
  });
});

describe('reportApproval', () => {
  it('reports a withdrawn question at once, and only once', async () => {
    const events: AgentEvent[] = [];
    const gone = new AbortController();
    let finish: (value: { decision: 'approve'; automatic: boolean }) => void = () => {};
    const pending = reportApproval(
      (event) => events.push(event),
      request,
      gone.signal,
      () => new Promise((resolve) => (finish = resolve)),
    );
    gone.abort();
    // Synchronous: a run that closes its stream right after aborting still has the event.
    expect(events.map((event) => event.type)).toEqual(['approval-request', 'approval-resolved']);
    finish({ decision: 'approve', automatic: false });
    expect(await pending).toBe('deny');
    expect(events).toHaveLength(2);
  });
});

describe('linkAbort', () => {
  it('drops its listener once the target is done', () => {
    const source = new AbortController();
    const remove = vi.spyOn(source.signal, 'removeEventListener');
    const target = new AbortController();
    linkAbort(source.signal, target);
    target.abort();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    const linked = new AbortController();
    linkAbort(source.signal, linked);
    source.abort();
    expect(linked.signal.aborted).toBe(true);
  });
});

describe('headless translations', () => {
  it('Claude: plan mode, its sandbox, or no sandbox', () => {
    const tail = (permissions: AgentTask['permissions']) => claudeArgs(task(permissions)).slice(2, -1);
    expect(tail({ sandbox: 'read-only' })).toEqual([
      '--output-format',
      'stream-json',
      '--permission-mode',
      'plan',
      '--settings',
      '{"sandbox":{"enabled":false}}',
    ]);
    const sandboxed = tail({ approval: 'deny', sandbox: 'workspace-write' });
    expect(sandboxed.slice(2, 4)).toEqual(['--permission-mode', 'acceptEdits']);
    expect(JSON.parse(sandboxed[5]!)).toEqual({
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
      },
    });
    expect(tail('yolo')).not.toContain('bypassPermissions');
    expect(() => claudeArgs(task('yolo'), { permissionMode: 'plan' })).toThrow(
      'claude: set either the permissionMode option or task.permissions.approval/sandbox, not both.',
    );
  });

  it('Codex exec: approval policy never and the matching sandbox', () => {
    expect(codexArgs(task('yolo'))).toEqual([
      'exec',
      '--json',
      '-c',
      'approval_policy="never"',
      '--sandbox',
      'danger-full-access',
      '--skip-git-repo-check',
      'go',
    ]);
    expect(codexArgs(task({ sandbox: 'read-only' })).slice(0, 4)).toEqual(['exec', '--json', '--sandbox', 'read-only']);
    expect(() => codexArgs(task({ approval: 'ask' }))).toThrow('use codexLive()');
  });

  it('Gemini: approval mode, plan for read-only, sandbox flag and env', async () => {
    expect(geminiArgs(task({ approval: 'auto-approve', sandbox: 'workspace-write' })).slice(0, 5)).toEqual([
      '--output-format',
      'stream-json',
      '--approval-mode',
      'yolo',
      '--sandbox',
    ]);
    expect(geminiArgs(task({ sandbox: 'read-only' })).slice(2, 4)).toEqual(['--approval-mode', 'plan']);
    expect(geminiArgs(task({ sandbox: 'unrestricted' })).slice(2, 5)).toEqual([
      '--approval-mode',
      'auto_edit',
      '--no-sandbox',
    ]);
    const refused = await gemini({ command: 'gemini-not-run' }).run(
      task({ approval: 'auto-approve', sandbox: 'read-only' }),
    ).result;
    expect(refused).toMatchObject({ status: 'failed', error: expect.stringContaining('plan') });
  });

  it('Cursor: --force only without a sandbox', () => {
    expect(cursorArgs(task('yolo')).slice(3, 7)).toEqual(['--force', '--sandbox', 'disabled', '--approve-mcps']);
    expect(cursorArgs(task({ sandbox: 'workspace-write' })).slice(3, 6)).toEqual(['--trust', '--sandbox', 'enabled']);
    expect(cursorArgs(task({ approval: 'deny', sandbox: 'read-only' })).slice(3, 6)).toEqual([
      '--trust',
      '--mode',
      'ask',
    ]);
    expect(() => cursorArgs(task({ approval: 'auto-approve', sandbox: 'workspace-write' }))).toThrow(
      'outside its sandbox',
    );
    expect(() => cursorArgs(task({ sandbox: 'workspace-write' }), { force: true })).toThrow('outside its sandbox');
  });

  it('Copilot, opencode, Vibe and Antigravity', async () => {
    expect(copilotArgs(task('yolo')).slice(2, 5)).toEqual([
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
    ]);
    expect((await copilot({ command: 'copilot-not-run' }).run(task({ approval: 'deny' })).result).error).toBe(
      "copilot cannot run with permissions.approval 'deny' (supported: auto-approve).",
    );
    expect(opencodeArgs(task('yolo'))).toContain('--auto');
    expect(opencodeArgs(task({ approval: 'deny' }))).not.toContain('--auto');
    expect(vibeArgs(task('yolo')).slice(2, 5)).toEqual(['--agent', 'accept-edits', '--auto-approve']);
    expect(vibeArgs(task({ approval: 'deny', sandbox: 'read-only' })).slice(2, 4)).toEqual(['--agent', 'plan']);
    expect(antigravityArgs(task({ sandbox: 'unrestricted' }))).not.toContain('--sandbox');
    expect(antigravityArgs(task({ sandbox: 'workspace-write' }))).toContain('--sandbox');
    expect((await antigravity({ command: 'agy-not-run' }).run(task('yolo')).result).error).toBe(
      "antigravity cannot run with permissions.approval 'auto-approve' (supported: none).",
    );
    expect(claude().capabilities.permissions?.sandbox).toEqual(['workspace-write', 'read-only', 'unrestricted']);
  });
});

describe('applyPermissionArgs', () => {
  it("rewrites an app's own flag lists, keeping a trailing prompt flag last", () => {
    const claudeSpec = ['-p', '--verbose', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json'];
    expect(applyPermissionArgs('claude', claudeSpec, { sandbox: 'read-only' }).args).toEqual([
      '--permission-mode',
      'plan',
      '--settings',
      '{"sandbox":{"enabled":false}}',
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
    ]);
    const codexSpec = ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
    expect(applyPermissionArgs('codex', codexSpec, 'yolo').args).toEqual([
      'exec',
      '-c',
      'approval_policy="never"',
      '--sandbox',
      'danger-full-access',
      '--json',
      '--skip-git-repo-check',
    ]);
    const geminiSpec = ['--output-format', 'stream-json', '--approval-mode=auto_edit', '-p'];
    expect(applyPermissionArgs('gemini', geminiSpec, { approval: 'auto-approve', sandbox: 'workspace-write' })).toEqual(
      {
        args: ['--approval-mode', 'yolo', '--sandbox', '--output-format', 'stream-json', '-p'],
        env: { GEMINI_SANDBOX: 'true' },
      },
    );
    expect(applyPermissionArgs('cursor', ['--print', '--force'], undefined).args).toEqual(['--print', '--force']);
    expect(() => applyPermissionArgs('cursor', ['--print', '--force'], { approval: 'ask' })).toThrow();
    expect(() => applyPermissionArgs('other', [], 'yolo')).toThrow('No permission translation for agent "other".');
  });

  it('leaves everything after -- alone', () => {
    const flags = { args: ['--a'], replaces: { '--x': 'value' as const } };
    expect(mergePermissionFlags(['--x', '1', '--', '--x', '2'], flags)).toEqual(['--a', '--', '--x', '2']);
  });
});

describe('Claude sandbox boundary', () => {
  const ws = join(dir, 'ws');
  mkdirSync(ws, { recursive: true });
  symlinkSync(tmpdir(), join(ws, 'escape'));
  const call = (tool_name: string, input: Record<string, unknown>) => ({ tool_name, input });

  it('read-only grants reading tools only', () => {
    expect(claudeSandboxRefuses(call('Read', { file_path: '/etc/hosts' }), 'read-only', ws)).toBe(false);
    expect(claudeSandboxRefuses(call('ExitPlanMode', { plan: 'x' }), 'read-only', ws)).toBe(true);
    expect(claudeSandboxRefuses(call('Bash', { command: 'ls' }), 'read-only', ws)).toBe(true);
  });

  it('workspace-write grants edits inside cwd and no unsandboxed Bash', () => {
    expect(claudeSandboxRefuses(call('Write', { file_path: 'src/a.ts' }), 'workspace-write', ws)).toBe(false);
    expect(claudeSandboxRefuses(call('Edit', { file_path: join(ws, 'a.ts') }), 'workspace-write', ws)).toBe(false);
    expect(claudeSandboxRefuses(call('Write', { file_path: '../a.ts' }), 'workspace-write', ws)).toBe(true);
    expect(claudeSandboxRefuses(call('Write', { file_path: 'escape/a.ts' }), 'workspace-write', ws)).toBe(true);
    expect(claudeSandboxRefuses(call('Bash', { command: 'ls' }), 'workspace-write', ws)).toBe(true);
    expect(claudeSandboxRefuses(call('mcp__docs__search', { q: 'x' }), 'workspace-write', ws)).toBe(false);
    expect(claudeSandboxRefuses(call('Bash', { command: 'ls' }), 'unrestricted', ws)).toBe(false);
  });

  it('denies a request outside the sandbox without asking', async () => {
    const onApproval = vi.fn<ApprovalHandler>(() => 'approve');
    const tool = claudeApprovalTool(onApproval, { sandbox: 'workspace-write', cwd: ws });
    const result = await tool.call(call('Write', { file_path: '/etc/passwd', content: 'x' }));
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ behavior: 'deny' });
    expect(onApproval).not.toHaveBeenCalled();
    const inside = await tool.call(call('Write', { file_path: 'a.ts', content: 'x' }));
    expect(JSON.parse(inside.content[0]!.text)).toMatchObject({ behavior: 'allow' });
    expect(() => claudeApprovalTool(onApproval, { sandbox: 'read-only' })).toThrow('needs cwd');
  });
});

// Every permission value is either translated or refused by name: none is ignored.
describe('no silent fallbacks', () => {
  const all: AgentPermissions[] = [];
  for (const approval of [undefined, 'ask', 'auto-approve', 'deny'] as const)
    for (const sandbox of [undefined, 'workspace-write', 'read-only', 'unrestricted'] as const)
      all.push({ ...(approval ? { approval } : {}), ...(sandbox ? { sandbox } : {}) });

  it.each(['claude', 'codex', 'gemini', 'cursor', 'copilot', 'opencode', 'vibe', 'antigravity'])(
    '%s changes its arguments for each accepted value',
    (agent) => {
      for (const permissions of all) {
        if (!permissions.approval && !permissions.sandbox) continue;
        let result: string[] | undefined;
        try {
          result = applyPermissionArgs(agent, ['--placeholder'], permissions).args;
        } catch (error) {
          expect((error as Error).message).toMatch(/cannot|no sandbox|needs/);
          continue;
        }
        // `deny` for opencode/vibe is their default (no flag); anything else adds a flag.
        if (!(permissions.approval === 'deny' && !permissions.sandbox) && permissions.sandbox !== 'unrestricted')
          expect(result.length, JSON.stringify(permissions)).toBeGreaterThan(1);
      }
    },
  );
});
