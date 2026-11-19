import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type CliEnvironment } from './main.js';
import {
  autoUpdate,
  CHECK_INTERVAL_MS,
  compareVersions,
  findInstall,
  readState,
  releaseNotes,
  selfInstall,
  stableCliPath,
  updateInstall,
  type UpdateDeps,
} from './update.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Writes what `npm install genaicode@<version>` leaves in a prefix. */
function writePackage(prefix: string, version: string, changelog = ''): string {
  const root = join(prefix, 'node_modules', 'genaicode');
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'genaicode', version }));
  writeFileSync(join(root, 'dist', 'cli.js'), '');
  writeFileSync(join(root, 'docs', 'CHANGELOG.md'), changelog);
  return root;
}

const CHANGELOG = `# Changelog

## Unreleased

## 2.36.0 — 2026-11-20

### Added

- \`genaicode update\` (#201)

## 2.35.1 — 2026-11-19

### Fixed

- A fix (#199)

## 2.35.0 — 2026-11-18

### Added

- Older
`;

/** An install as scripts/install.sh leaves it, running `version`. */
function installed(version = '2.35.0') {
  const base = mkdtempSync(join(tmpdir(), 'genaicode-update-'));
  dirs.push(base);
  const home = join(base, '.genaicode');
  const root = writePackage(join(home, 'versions', version), version);
  const binDir = join(base, 'bin');
  selfInstall({ packageRoot: root, binDir, env: { HOME: base, PATH: '' } });
  const spawned: string[] = [];
  const npm: string[] = [];
  const deps: UpdateDeps = {
    packageRoot: root,
    env: {},
    now: () => 1_000_000_000_000,
    resolveVersion: async (tag) => (tag === 'latest' ? '2.36.0' : tag),
    npmInstall: async (prefix, spec) => {
      npm.push(spec);
      writePackage(prefix, spec.split('@')[1], CHANGELOG);
    },
    spawnBackground: (cli) => spawned.push(cli),
  };
  return { base, home, root, binDir, deps, spawned, npm };
}

describe('compareVersions', () => {
  it('orders releases and pre-releases', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
    expect(compareVersions('2.9.0', '2.9.0')).toBe(0);
    expect(compareVersions('2.9.0-rc.1', '2.9.0')).toBe(-1);
    expect(compareVersions('v3.0.0', '2.99.0')).toBe(1);
  });
});

describe('releaseNotes', () => {
  it('takes the sections after the old version up to the new one, newest first', () => {
    const notes = releaseNotes(CHANGELOG, '2.35.0', '2.36.0');
    expect(notes).toContain('## 2.36.0');
    expect(notes).toContain('## 2.35.1');
    expect(notes).not.toContain('## 2.35.0');
    expect(notes).not.toContain('Unreleased');
    expect(notes.indexOf('2.36.0')).toBeLessThan(notes.indexOf('2.35.1'));
  });
});

describe('selfInstall', () => {
  it('links current, writes the shim and the config', () => {
    const { home, binDir, root } = installed();
    expect(readlinkSync(join(home, 'current'))).toBe(join('versions', '2.35.0'));
    const shim = readFileSync(join(binDir, 'genaicode'), 'utf8');
    expect(shim).toContain(`exec node '${join(home, 'current', 'node_modules', 'genaicode', 'dist', 'cli.js')}'`);
    expect(statSync(join(binDir, 'genaicode')).mode & 0o111).toBeTruthy();
    expect(JSON.parse(readFileSync(join(home, 'install.json'), 'utf8'))).toEqual({ binDir });
    expect(readState(home).checkedAt).toBeTypeOf('number');
    expect(findInstall(root)).toEqual({ home, version: '2.35.0' });
  });

  it('leaves a genaicode it did not write alone', () => {
    const { root, binDir, base } = installed();
    writeFileSync(join(binDir, 'genaicode'), '#!/bin/sh\necho mine\n');
    expect(() => selfInstall({ packageRoot: root, binDir, env: { HOME: base } })).toThrow(/not the genaicode shim/);
    selfInstall({ packageRoot: root, binDir, env: { HOME: base }, force: true });
    expect(readFileSync(join(binDir, 'genaicode'), 'utf8')).toContain('genaicode shim');
  });

  it('replaces a symlinked genaicode instead of writing through it', () => {
    const { root, binDir, base } = installed();
    const target = join(base, 'npm-cli.js');
    writeFileSync(target, 'original');
    rmSync(join(binDir, 'genaicode'));
    symlinkSync(target, join(binDir, 'genaicode'));
    selfInstall({ packageRoot: root, binDir, env: { HOME: base }, force: true });
    expect(readFileSync(target, 'utf8')).toBe('original');
    expect(lstatSync(join(binDir, 'genaicode')).isSymbolicLink()).toBe(false);
  });

  it('gives hooks a cli.js path under current', () => {
    const { root, home } = installed();
    expect(stableCliPath(root)).toBe(join(home, 'current', 'node_modules', 'genaicode', 'dist', 'cli.js'));
    expect(stableCliPath('/repo')).toBe(join('/repo', 'dist', 'cli.js'));
  });

  it('refuses outside an install layout', () => {
    const base = mkdtempSync(join(tmpdir(), 'genaicode-update-'));
    dirs.push(base);
    const root = writePackage(base, '1.0.0');
    expect(() => selfInstall({ packageRoot: root, env: {} })).toThrow(/self-install runs from/);
    expect(findInstall(root)).toBeUndefined();
  });
});

describe('updateInstall', () => {
  it('installs beside the old version, swaps current and reports the notes', async () => {
    const { home, deps, npm } = installed();
    const outcome = await updateInstall(findInstall(deps.packageRoot)!, deps);
    expect(npm).toEqual(['genaicode@2.36.0']);
    expect(outcome).toMatchObject({ kind: 'updated', from: '2.35.0', to: '2.36.0' });
    expect(outcome.kind === 'updated' && outcome.notes).toContain('## 2.35.1');
    expect(readlinkSync(join(home, 'current'))).toBe(join('versions', '2.36.0'));
    expect(existsSync(join(home, 'versions', '2.35.0'))).toBe(true);
    expect(readState(home).updated).toMatchObject({ from: '2.35.0', to: '2.36.0' });
  });

  it('only checks with check, and says when it is current', async () => {
    const { home, deps, npm } = installed();
    const install = findInstall(deps.packageRoot)!;
    expect(await updateInstall(install, deps, { check: true })).toEqual({
      kind: 'available',
      from: '2.35.0',
      to: '2.36.0',
    });
    expect(await updateInstall(install, deps, { tag: '2.35.0' })).toEqual({ kind: 'current', version: '2.35.0' });
    expect(npm).toEqual([]);
    expect(readlinkSync(join(home, 'current'))).toBe(join('versions', '2.35.0'));
  });

  it('keeps current where it was when npm fails', async () => {
    const { home, deps } = installed();
    deps.npmInstall = async () => {
      throw new Error('E404');
    };
    await expect(updateInstall(findInstall(deps.packageRoot)!, deps)).rejects.toThrow('E404');
    expect(readlinkSync(join(home, 'current'))).toBe(join('versions', '2.35.0'));
    expect(existsSync(join(home, 'update.lock'))).toBe(false);
  });

  it('removes versions other than the new, the previous and the running one', async () => {
    const { home, deps } = installed();
    writePackage(join(home, 'versions', '2.30.0'), '2.30.0');
    await updateInstall(findInstall(deps.packageRoot)!, deps);
    expect(existsSync(join(home, 'versions', '2.30.0'))).toBe(false);
    expect(existsSync(join(home, 'versions', '2.35.0'))).toBe(true);
  });

  it('steps aside while another update holds the lock', async () => {
    const { home, deps } = installed();
    mkdirSync(join(home, 'update.lock'));
    expect(await updateInstall(findInstall(deps.packageRoot)!, deps)).toEqual({ kind: 'busy' });
  });
});

describe('autoUpdate', () => {
  it('starts a background update once a day', () => {
    const { deps, spawned, root, home } = installed();
    let now = Date.now();
    deps.now = () => now;
    autoUpdate(deps, () => {});
    expect(spawned).toEqual([]); // just installed
    now += CHECK_INTERVAL_MS + 1;
    autoUpdate(deps, () => {});
    autoUpdate(deps, () => {});
    expect(spawned).toEqual([join(root, 'dist', 'cli.js')]);
    expect(readState(home).checkedAt).toBe(now);
  });

  it('does nothing when turned off, in CI, or outside an install', () => {
    const { deps, spawned, home } = installed();
    deps.now = () => Date.now() + 2 * CHECK_INTERVAL_MS;
    autoUpdate({ ...deps, env: { GENAICODE_NO_AUTO_UPDATE: '1' } }, () => {});
    autoUpdate({ ...deps, env: { CI: 'true' } }, () => {});
    writeFileSync(join(home, 'install.json'), JSON.stringify({ autoUpdate: false }));
    autoUpdate(deps, () => {});
    autoUpdate({ ...deps, packageRoot: process.cwd() }, () => {});
    expect(spawned).toEqual([]);
  });

  it('reports a background update once', async () => {
    const { deps } = installed();
    await updateInstall(findInstall(deps.packageRoot)!, deps);
    const lines: string[] = [];
    autoUpdate(deps, (line) => lines.push(line));
    autoUpdate(deps, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('genaicode updated 2.35.0 → 2.36.0');
    expect(lines[0]).toContain('Restart to use it');
  });
});

describe('genaicode update', () => {
  function run(argv: string[], updater: Partial<UpdateDeps>) {
    let stdout = '';
    let stderr = '';
    const cli: CliEnvironment = {
      argv,
      env: {},
      cwd: '/work',
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
      readStdin: async () => undefined,
      agents: [],
      updater,
    };
    return main(cli).then((code) => ({ code, stdout, stderr }));
  }

  it('updates the installed command and prints what changed', async () => {
    const { deps } = installed();
    const result = await run(['update'], deps);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Updated genaicode 2.35.0 → 2.36.0.');
    expect(result.stdout).toContain('`genaicode update`');
  });

  it('turns automatic updates off and on', async () => {
    const { deps, home } = installed();
    expect((await run(['update', '--auto', 'off'], deps)).stdout).toBe('Automatic updates off.\n');
    expect(JSON.parse(readFileSync(join(home, 'install.json'), 'utf8')).autoUpdate).toBe(false);
    expect((await run(['update', '--auto', 'maybe'], deps)).code).toBe(2);
  });

  it('points npx and npm installs at npm and the installer', async () => {
    const result = await run(['update'], { packageRoot: process.cwd() });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('npm install -g genaicode@latest');
    expect(result.stderr).toContain('scripts/install.sh | sh');
  });
});
