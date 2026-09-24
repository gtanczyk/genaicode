import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectAgents, findExecutable } from './discovery.js';
import { claude } from './drivers/claude.js';
import { codex } from './drivers/codex.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-discovery-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(process.platform === 'win32')('agent discovery', () => {
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(dir, 'codex'), 'not executable', { mode: 0o644 });

  it('finds executables on PATH only', () => {
    const env = { PATH: dir };
    expect(findExecutable('claude', env)).toBe(join(dir, 'claude'));
    expect(findExecutable('codex', env)).toBeNull();
    expect(findExecutable(join(dir, 'claude'), {})).toBe(join(dir, 'claude'));
  });

  it('reports which agents are installed', () => {
    const found = detectAgents([claude(), codex()], { PATH: dir });
    expect(found.map(({ agent, path }) => [agent.name, path])).toEqual([
      ['claude', join(dir, 'claude')],
      ['codex', null],
    ]);
  });
});
