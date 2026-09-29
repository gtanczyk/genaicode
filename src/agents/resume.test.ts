import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { claude, claudeArgs } from './drivers/claude.js';
import { codexArgs } from './drivers/codex.js';
import { copilotArgs } from './drivers/copilot.js';
import { cursorArgs } from './drivers/cursor.js';
import { gemini } from './drivers/gemini.js';
import { muse } from './drivers/muse.js';
import { opencodeArgs } from './drivers/opencode.js';

const task = { prompt: 'and now the tests', cwd: '.', resume: 'sess-1' };

describe('task.resume', () => {
  it('continues the session with each driver’s own flag', () => {
    expect(claudeArgs(task).slice(-3)).toEqual(['--resume', 'sess-1', 'and now the tests']);
    expect(cursorArgs(task).slice(-2)).toEqual(['--resume=sess-1', 'and now the tests']);
    expect(copilotArgs(task).slice(-2)).toEqual(['--resume=sess-1', '--prompt=and now the tests']);
    expect(opencodeArgs(task).slice(-4)).toEqual(['--session', 'sess-1', '--', 'and now the tests']);
  });

  it('switches codex to `exec resume` with exec flags before the subcommand', () => {
    expect(codexArgs({ ...task, model: 'gpt', extraArgs: ['--foo'] })).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '--model',
      'gpt',
      '--foo',
      'resume',
      'sess-1',
      'and now the tests',
    ]);
    expect(codexArgs({ ...task, prompt: '-x' }).slice(-4)).toEqual(['resume', 'sess-1', '--', '-x']);
  });

  it('leaves the arguments alone without it', () => {
    expect(claudeArgs({ prompt: 'p', cwd: '.' })).not.toContain('--resume');
    expect(codexArgs({ prompt: 'p', cwd: '.' })).not.toContain('resume');
  });

  it('refuses drivers that cannot resume, and empty ids, before spawning', async () => {
    const cwd = tmpdir();
    for (const agent of [muse({ command: 'genaicode-missing-bin' }), gemini({ command: 'genaicode-missing-bin' })]) {
      expect(agent.capabilities.resume).toBeFalsy();
      const result = await agent.run({ prompt: 'p', cwd, resume: 'sess-1' }).result;
      expect(result).toMatchObject({ status: 'failed', exitCode: null });
      expect(result.error).toMatch(/cannot resume a session/);
    }
    const empty = await claude({ command: 'genaicode-missing-bin' }).run({ prompt: 'p', cwd, resume: ' ' }).result;
    expect(empty.error).toMatch(/Empty session id/);
  });
});
