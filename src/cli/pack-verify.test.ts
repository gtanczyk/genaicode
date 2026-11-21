import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { snapshotTree, withSnapshot } from '../agents/pack-git.js';
import { runCheckProcess } from './check-process.js';
import { packTestLimits } from './check-limits.js';
import { worktreeCheck } from './pack-verify.js';

it.skipIf(process.platform === 'win32')('ends a sleeping check at its wall-clock deadline', async () => {
  const result = await runCheckProcess(
    '/bin/sh',
    ['-c', 'sleep 5'],
    tmpdir(),
    { PATH: '/bin:/usr/bin' },
    undefined,
    false,
    undefined,
    { ...packTestLimits, timeoutMs: 75 },
  );
  expect(result).toMatchObject({ exitCode: null, output: expect.stringContaining('time limit') });
});

it('checks a private workspace using the worker’s linked packages and read-only installed dependencies', async () => {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    const result = await worktreeCheck('npm test', '.', '.', '.', new AbortController().signal);
    expect(result).toMatchObject({ exitCode: null, output: expect.stringContaining('unavailable') });
    return;
  }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'genaicode-isolation-')));
  const work = join(dir, 'worker');
  const nested = join(work, 'package');
  const lead = join(dir, 'lead');
  const external = join(lead, 'node_modules', 'external', 'index.js');
  mkdirSync(nested, { recursive: true });
  execFileSync('git', ['init', '-q', work]);
  writeFileSync(join(work, '.gitignore'), 'ignored-note.cache\nnode_modules/\n');
  writeFileSync(join(work, 'ignored-note.cache'), 'local scratch note');
  mkdirSync(join(lead, 'package'), { recursive: true });
  execFileSync('git', ['init', '-q', lead]);
  for (const [tree, value] of [
    [lead, 'original'],
    [work, 'worker'],
  ] as const) {
    const pkg = join(tree, 'packages', 'a');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'index.json'), JSON.stringify(value));
  }
  mkdirSync(join(lead, 'node_modules', '@fixture'), { recursive: true });
  symlinkSync('../../packages/a', join(lead, 'node_modules', '@fixture', 'a'), 'dir');
  mkdirSync(join(lead, 'node_modules', 'external'), { recursive: true });
  const installedCode = "module.exports = require('@fixture/a');";
  writeFileSync(external, installedCode);
  mkdirSync(join(lead, 'node_modules', '.cache'));
  writeFileSync(join(lead, 'node_modules', '.cache', 'old'), 'prior test');
  writeFileSync(join(work, 'input'), 'worker data');
  const outside = join(dir, 'outside-fixture');
  writeFileSync(outside, 'scope marker');
  writeFileSync(join(nested, 'scope.json'), JSON.stringify({ outside }));
  writeFileSync(join(nested, 'package.json'), JSON.stringify({ scripts: { test: 'node test.cjs' } }));
  writeFileSync(
    join(nested, 'test.cjs'),
    [
      "const fs = require('node:fs');",
      "const assert = require('node:assert/strict');",
      "const { execFileSync } = require('node:child_process');",
      "assert.ok(Number(execFileSync('/bin/bash', ['-c', 'ulimit -t'])) <= 180);",
      'assert.equal(process.env.GENAICODE_TEST_HOST_MARKER, undefined);',
      "assert.equal(require('@fixture/a'), 'worker');",
      "assert.equal(require('external'), 'worker');",
      "assert.throws(() => fs.writeFileSync(require.resolve('external'), 'changed'));",
      "for (const name of ['.cache', '.vite-temp']) {",
      "  const cache = '../node_modules/' + name; fs.mkdirSync(cache, { recursive: true });",
      "  assert.equal(fs.existsSync(cache + '/old'), false); fs.writeFileSync(cache + '/bundle.mjs', 'fixture');",
      '}',
      "assert.equal(fs.readFileSync('../input', 'utf8'), 'worker data');",
      "assert.equal(fs.existsSync('../ignored-note.cache'), false);",
      "assert.equal(fs.existsSync('../.git'), false);",
      "const { outside } = JSON.parse(fs.readFileSync('scope.json', 'utf8'));",
      'assert.throws(() => fs.readFileSync(outside));',
      "fs.writeFileSync('../input', 'test output');",
      "console.log('isolated fixture passed');",
    ].join('\n'),
  );
  vi.stubEnv('GENAICODE_TEST_HOST_MARKER', 'fixture');
  try {
    const revision = await snapshotTree(work);
    writeFileSync(join(work, 'input'), 'edit made after the check was requested');
    const result = await withSnapshot(work, revision, (copy) =>
      worktreeCheck(
        'npm --prefix . test',
        join(copy, 'package'),
        copy,
        join(lead, 'package'),
        new AbortController().signal,
      ),
    );
    if (
      process.getuid?.() !== 0 &&
      (process.platform === 'darwin' ||
        (process.platform === 'linux' && existsSync('/usr/bin/bwrap') && !result.output.startsWith('bwrap:')))
    ) {
      expect(result, result.output).toMatchObject({ exitCode: 0 });
      expect(result.output).toContain('isolated fixture passed');
    } else {
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toMatch(/Isolated test runner unavailable|bwrap:.*(?:namespace|permitted)/i);
    }
    expect(readFileSync(join(work, 'input'), 'utf8')).toBe('edit made after the check was requested');
    expect(readFileSync(external, 'utf8')).toBe(installedCode);
    expect(readFileSync(join(lead, 'node_modules', '.cache', 'old'), 'utf8')).toBe('prior test');
    expect(existsSync(join(lead, 'node_modules', '.vite-temp'))).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
