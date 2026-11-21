import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { worktreeCheck } from './pack-verify.js';

it('verifies the worker files in a private copy with a clean environment', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'genaicode-isolation-')));
  const work = join(dir, 'worker');
  const nested = join(work, 'package');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(work, 'input'), 'worker data');
  const outside = join(dir, 'outside-fixture');
  writeFileSync(outside, 'scope marker');
  writeFileSync(join(nested, 'package.json'), JSON.stringify({ scripts: { test: 'node test.cjs' } }));
  writeFileSync(
    join(nested, 'test.cjs'),
    [
      "const fs = require('node:fs');",
      "const assert = require('node:assert/strict');",
      'assert.equal(process.env.GENAICODE_TEST_HOST_MARKER, undefined);',
      "assert.equal(fs.readFileSync('../input', 'utf8'), 'worker data');",
      `assert.throws(() => fs.readFileSync(${JSON.stringify(outside)}));`,
      "fs.writeFileSync('../input', 'test output');",
      "console.log('isolated fixture passed');",
    ].join('\n'),
  );
  vi.stubEnv('GENAICODE_TEST_HOST_MARKER', 'fixture');
  try {
    const result = await worktreeCheck('npm --prefix . test', nested, work, dir, new AbortController().signal);
    if (
      process.platform === 'darwin' ||
      (process.platform === 'linux' && existsSync('/usr/bin/bwrap') && !result.output.startsWith('bwrap:'))
    ) {
      expect(result, result.output).toMatchObject({ exitCode: 0 });
      expect(result.output).toContain('isolated fixture passed');
    } else {
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toMatch(/Isolated test runner unavailable|bwrap:.*(?:namespace|permitted)/i);
    }
    expect(readFileSync(join(work, 'input'), 'utf8')).toBe('worker data');
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
