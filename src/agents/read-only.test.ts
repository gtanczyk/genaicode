import { describe, expect, it } from 'vitest';
import { isReadOnlyApproval, isReadOnlyCommand } from './read-only.js';

const cwd = '/work/game';
const ro = (command: string | string[]) => isReadOnlyCommand(command, cwd);

describe('isReadOnlyCommand', () => {
  it('passes commands that only read the project', () => {
    for (const command of [
      'ls -la',
      'cat games/knights/PLAN.md',
      'rg -n "useState" src',
      "grep -rn 'foo$' src | head -20",
      'git log --oneline -20',
      'git -C sub diff HEAD~1 -- src',
      'git status && git branch -a',
      'find . -name "*.ts" -type f',
      "sed -n '10,40p' src/a.ts",
      'wc -l src/*.ts 2>/dev/null',
      'cd games/knights && ls',
      `cat ${cwd}/README.md`,
    ])
      expect(ro(command), command).toBe(true);
    expect(ro(['/bin/zsh', '-lc', 'git status'])).toBe(true);
    expect(ro("bash -lc 'ls src | sort'")).toBe(true);
  });

  it('refuses writes, expansion, redirection and paths outside the project', () => {
    for (const command of [
      'rm -rf x',
      'ls > out.txt',
      'cat a; rm b',
      'echo $(whoami)',
      'cat "$HOME/.ssh/id_rsa"',
      'cat ~/.ssh/id_rsa',
      'cat /etc/passwd',
      'cat ../../secret',
      'cd .. && ls',
      'find . -delete',
      'find . -exec rm {} ;',
      "sed -i 's/a/b/' x",
      "sed -n 'w out' x",
      'git commit -m x',
      'git push',
      'git branch -D main',
      'git -c core.pager=sh log',
      'git diff --output=x',
      'sort -o x y',
      'rg --pre ./run foo',
      'ls & rm x',
      'npm test',
      'node -e 1',
      'bash -c "rm x"',
      '',
    ])
      expect(ro(command), command).toBe(false);
  });
});

describe('isReadOnlyApproval', () => {
  it('reads the command of Antigravity, Claude and Codex requests', () => {
    const agy = {
      id: 'c1',
      kind: 'command' as const,
      summary: 'ls -la && git status',
      detail: { toolCall: { kind: 'execute', rawInput: { CommandLine: 'ls -la && git status' } } },
    };
    expect(isReadOnlyApproval(agy, cwd)).toBe(true);
    expect(
      isReadOnlyApproval(
        { ...agy, detail: { toolCall: { rawInput: { CommandLine: 'ls', BypassSandbox: true } } } },
        cwd,
      ),
    ).toBe(false);
    expect(isReadOnlyApproval({ id: 'c2', kind: 'command', detail: { input: { command: 'git diff' } } }, cwd)).toBe(
      true,
    );
    expect(
      isReadOnlyApproval({ id: 'c3', kind: 'command', detail: { command: ['/bin/bash', '-lc', 'rm x'] } }, cwd),
    ).toBe(false);
    expect(isReadOnlyApproval({ id: 'c4', kind: 'file-change', detail: { command: 'ls' } }, cwd)).toBe(false);
    expect(isReadOnlyApproval({ id: 'c5', kind: 'command', summary: 'ls' }, cwd)).toBe(false);
  });
});
