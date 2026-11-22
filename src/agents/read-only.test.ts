import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isReadOnlyApproval, isReadOnlyCommand } from './read-only.js';

const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'genaicode-ro-repo-')));
execFileSync('git', ['init', '-q', cwd]);
mkdirSync(join(cwd, 'games', 'knights'), { recursive: true });
afterAll(() => rmSync(cwd, { recursive: true, force: true }));
const ro = (command: string | string[]) => isReadOnlyCommand(command, cwd);

describe('isReadOnlyCommand', () => {
  it('passes commands that only read the project', () => {
    for (const command of [
      'ls -la',
      'cat games/knights/PLAN.md',
      'rg -n "useState" src',
      "grep -rn 'foo$' src | head -20",
      'git log --oneline -20',
      'git -C . diff HEAD~1 -- src',
      'git status && git branch -a',
      'find . -name "*.ts" -type f',
      "sed -n '10,40p' src/a.ts",
      'wc -l src/a.ts 2>/dev/null',
      'cd games/knights && ls',
      `cat ${cwd}/README.md`,
    ])
      expect(ro(command), command).toBe(true);
    expect(ro(['/bin/zsh', '-lc', 'git status'])).toBe(true);
    expect(ro("bash -lc 'ls src | head'")).toBe(true);
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
      'sort a',
      'git diff --out=x',
      'git log --ext',
      'grep --derefer foo .',
      'rg --pre ./run foo',
      'ls & rm x',
      'npm test',
      'node -e 1',
      'bash -c "rm x"',
      './tools/cat a.txt',
      "sed -n '1p' *",
      'cat [ab].txt',
      './bash -c ls',
      '/tmp/x/cat a',
      'uniq in.txt out.txt',
      'find -L . -name x',
      'rg -L foo',
      'grep -R foo .',
      'tree -ao out.txt .',
      'rg --hostname-bin ./helper --hyperlink-format default needle a',
      'rg --hostname-bin=./helper needle a',
      'cd -- && cat secret.txt',
      'cd - && ls',
      'cd && ls',
      'git grep -nO./helper needle',
      'git log --help',
      'diff -r a b',
      'ls -RL .',
      'ls --dereference -R',
      'du -L .',
      'rg -f/tmp/patterns input',
      'grep -f../x foo',
      '',
    ])
      expect(ro(command), command).toBe(false);
  });
});

describe('git helpers', () => {
  it('asks for git reads where the config names a program they would run', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'genaicode-ro-helper-')));
    try {
      execFileSync('git', ['init', '-q', repo]);
      expect(isReadOnlyCommand('git show', repo)).toBe(true);
      execFileSync('git', ['config', 'diff.evil.textconv', 'touch pwned'], { cwd: repo });
      expect(isReadOnlyCommand('git show', repo)).toBe(false);
      expect(isReadOnlyCommand('ls', repo)).toBe(true);
      expect(isReadOnlyCommand('git log', cwd, { GIT_EXTERNAL_DIFF: 'touch x' })).toBe(false);
      const config = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'diff.external', GIT_CONFIG_VALUE_0: 'touch x' };
      expect(isReadOnlyCommand('git log', cwd, { ...process.env, ...config })).toBe(false);
      execFileSync('git', ['config', '--unset', 'diff.evil.textconv'], { cwd: repo });
      expect(isReadOnlyCommand('git show', repo)).toBe(true);
      execFileSync('git', ['config', 'pretty.short', '%h %s'], { cwd: repo });
      expect(isReadOnlyCommand('git show', repo)).toBe(true);
      execFileSync('git', ['config', 'pretty.sig', '%h %G?'], { cwd: repo });
      expect(isReadOnlyCommand('git show', repo)).toBe(false);
      execFileSync('git', ['config', '--unset', 'pretty.sig'], { cwd: repo });
      execFileSync('git', ['config', 'log.showSignature', 'true'], { cwd: repo });
      expect(isReadOnlyCommand('git log', repo)).toBe(false);
      expect(isReadOnlyCommand('git log --show-signature -1', cwd)).toBe(false);
      expect(isReadOnlyCommand('du -a --files0-from=list', cwd)).toBe(false);
      expect(isReadOnlyCommand('wc --files0-from list', cwd)).toBe(false);
      expect(isReadOnlyCommand("git log --format='%h %G?'", cwd)).toBe(false);
      expect(isReadOnlyCommand('rg foo', cwd, { RIPGREP_CONFIG_PATH: '/tmp/rc' })).toBe(false);
      expect(isReadOnlyCommand('rg --no-config foo', cwd, { RIPGREP_CONFIG_PATH: '/tmp/rc' })).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
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

describe('paths through symlinks and the command directory', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'genaicode-ro-')));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const project = join(dir, 'project');
  const secret = join(dir, 'secret');
  mkdirSync(join(project, 'src'), { recursive: true });
  mkdirSync(secret);
  writeFileSync(join(secret, 'key.txt'), 'x');
  writeFileSync(join(project, 'src', 'a.ts'), 'x');
  symlinkSync(secret, join(project, 'linked'));

  it('refuses a read through a symlink out of the project', () => {
    expect(isReadOnlyCommand('cat src/a.ts', project)).toBe(true);
    expect(isReadOnlyCommand('ls src/*.ts', project)).toBe(false);
    expect(isReadOnlyCommand('cat linked/key.txt', project)).toBe(false);
    expect(isReadOnlyCommand('cat linked/*', project)).toBe(false);
    expect(isReadOnlyCommand('cd linked && cat key.txt', project)).toBe(false);
    expect(isReadOnlyCommand('cd src && cat a.ts', project)).toBe(true);
    expect(isReadOnlyCommand('cd src && cat a.ts', project, { CDPATH: secret })).toBe(false);
    expect(isReadOnlyCommand('cd src && cat ../../secret/key.txt', project)).toBe(false);
    expect(isReadOnlyCommand('cd missing || cat ../secret/key.txt', project)).toBe(false);
    expect(isReadOnlyCommand('cd missing && cat ../secret/key.txt', project)).toBe(false);
    expect(isReadOnlyCommand('cd src | cat ../a.ts', project)).toBe(false);
    expect(isReadOnlyCommand('ls || cd src && cat a.ts', project)).toBe(false);
  });

  it('checks the directory the request says the command runs in', () => {
    const request = (cwd?: string) => ({
      id: 'x',
      kind: 'command' as const,
      detail: { command: ['cat', 'key.txt'], ...(cwd !== undefined ? { cwd } : {}) },
    });
    expect(isReadOnlyApproval(request(secret), project)).toBe(false);
    expect(isReadOnlyApproval(request(join(project, 'linked')), project)).toBe(false);
    expect(isReadOnlyApproval(request(join(project, 'src')), project)).toBe(true);
    expect(isReadOnlyApproval(request(), project)).toBe(true);
  });
});
