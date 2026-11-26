import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type CliEnvironment } from './main.js';
import {
  autoUpdate,
  CHECK_INTERVAL_MS,
  compareVersions,
  defaultUpdateDeps,
  durableCliPath,
  findInstall,
  installCommand,
  npmInstallArgs,
  shadowingCommand,
  readState,
  readVersion,
  registerRun,
  writeState,
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
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'genaicode-update-')));
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
    expect(compareVersions('2.36.0-rc.10', '2.36.0-rc.9')).toBe(1);
    expect(compareVersions('2.36.0-rc.1', '2.36.0-rc')).toBe(1);
    expect(compareVersions('2.36.0-1', '2.36.0-alpha')).toBe(-1);
    expect(compareVersions('2.36.0-rc.1', '2.36.0-rc.1')).toBe(0);
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

  it('gives npx runs the installed command, or says there is none', () => {
    const { home, base } = installed();
    const npx = writePackage(join(base, '.npm', '_npx', '164c8f5e'), '3.5.0');
    const current = join(home, 'current', 'node_modules', 'genaicode', 'dist', 'cli.js');
    expect(durableCliPath(npx, { HOME: base })).toEqual({ path: current, installed: true, transient: false });
    const checkout = () => writePackage(join(base, 'src'), '3.5.0');
    const elsewhere = join(base, 'nowhere');
    expect(durableCliPath(npx, { HOME: base, GENAICODE_HOME: elsewhere })).toEqual({
      path: join(npx, 'dist', 'cli.js'),
      installed: false,
      transient: true,
    });
    // An AppImage's mount moves on every start, installed command or not.
    expect(durableCliPath(checkout(), { HOME: base, APPDIR: base })).toMatchObject({
      installed: false,
      transient: true,
    });
    // A checkout or `npm -g` keeps its own cli.js, installed command or not.
    expect(durableCliPath(checkout(), { HOME: base })).toEqual({
      path: join(checkout(), 'dist', 'cli.js'),
      installed: false,
      transient: false,
    });
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

  it('keeps versions that live processes still run', async () => {
    const { home, deps } = installed();
    writePackage(join(home, 'versions', '2.30.0'), '2.30.0');
    writePackage(join(home, 'versions', '2.31.0'), '2.31.0');
    const dead = spawnSync(process.execPath, ['-e', '']).pid!;
    mkdirSync(join(home, 'versions', `.staging-install-${process.pid}`));
    mkdirSync(join(home, 'versions', `.staging-install-${dead}`));
    mkdirSync(join(home, 'running'));
    writeFileSync(join(home, 'running', String(process.pid)), '2.30.0');
    writeFileSync(join(home, 'running', String(dead)), '2.31.0');
    await updateInstall(findInstall(deps.packageRoot)!, deps);
    expect(existsSync(join(home, 'versions', '2.30.0'))).toBe(true);
    expect(existsSync(join(home, 'versions', '2.31.0'))).toBe(false);
    expect(existsSync(join(home, 'running', String(dead)))).toBe(false);
    expect(existsSync(join(home, 'versions', `.staging-install-${process.pid}`))).toBe(true);
    expect(existsSync(join(home, 'versions', `.staging-install-${dead}`))).toBe(false);
  });

  it('records the version a process runs', () => {
    const { home, root } = installed();
    const unregister = registerRun(root);
    expect(readFileSync(join(home, 'running', String(process.pid)), 'utf8')).toBe('2.35.0');
    unregister();
    expect(existsSync(join(home, 'running', String(process.pid)))).toBe(false);
  });

  it('does not move a newer version back to latest unless asked', async () => {
    const { deps, npm } = installed('2.37.0-rc.1');
    const install = findInstall(deps.packageRoot)!;
    expect(await updateInstall(install, deps)).toEqual({ kind: 'current', version: '2.37.0-rc.1' });
    expect(await updateInstall(install, deps, { tag: '2.36.0' })).toMatchObject({ kind: 'updated', to: '2.36.0' });
    expect(npm).toEqual(['genaicode@2.36.0']);
  });

  it('refuses a target that is not a version', async () => {
    const { deps } = installed();
    deps.resolveVersion = async () => '1.0.0/../../x';
    await expect(updateInstall(findInstall(deps.packageRoot)!, deps)).rejects.toThrow(/not a version/);
  });

  it('does not repeat a manual update at the next start', async () => {
    const { deps } = installed();
    await updateInstall(findInstall(deps.packageRoot)!, deps);
    const lines: string[] = [];
    autoUpdate(deps, (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it('steps aside while a live process holds the lock, however long', async () => {
    const { home, deps } = installed();
    mkdirSync(join(home, 'update.lock'));
    writeFileSync(join(home, 'update.lock', 'pid'), String(process.pid));
    deps.now = () => Date.now() + 60 * 60 * 1000;
    expect(await updateInstall(findInstall(deps.packageRoot)!, deps)).toEqual({ kind: 'busy' });
  });

  it('takes over a lock whose owner is gone', async () => {
    const { home, deps } = installed();
    mkdirSync(join(home, 'update.lock'));
    writeFileSync(join(home, 'update.lock', 'pid'), String(spawnSync(process.execPath, ['-e', '']).pid));
    expect(await updateInstall(findInstall(deps.packageRoot)!, deps)).toMatchObject({ kind: 'updated' });
    expect(existsSync(join(home, 'update.lock'))).toBe(false);
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
    autoUpdate({ ...deps, env: { CI: 'false', GENAICODE_NO_AUTO_UPDATE: '0' } }, () => {});
    expect(spawned).toHaveLength(1);
    spawned.length = 0;
    writeState(home, {});
    writeFileSync(join(home, 'install.json'), JSON.stringify({ autoUpdate: false }));
    autoUpdate(deps, () => {});
    autoUpdate({ ...deps, packageRoot: process.cwd() }, () => {});
    expect(spawned).toEqual([]);
  });

  it('reports a background update once', async () => {
    const { deps } = installed();
    await updateInstall(findInstall(deps.packageRoot)!, deps, { background: true });
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

  it('prints only the running release on demand, without checking for updates', async () => {
    const { root, deps, spawned } = installed('2.35.1');
    const file = join(root, 'docs', 'CHANGELOG.md');
    writeFileSync(file, CHANGELOG.replace('A fix (#199)', 'A fix (#199)\n\n### Internal\n\n- Build tooling'));
    const notes = await run(['whats-new'], deps);
    expect(notes).toEqual({ code: 0, stdout: '## 2.35.1 — 2026-11-19\n\n### Fixed\n\n- A fix (#199)\n', stderr: '' });
    rmSync(file);
    expect((await run(['whats-new'], deps)).stdout).toContain('/releases/tag/v2.35.1');
    expect(spawned).toEqual([]);
  });

  it('turns automatic updates off and on', async () => {
    const { deps, home } = installed();
    expect((await run(['update', '--auto', 'off'], deps)).stdout).toBe('Automatic updates off.\n');
    expect(JSON.parse(readFileSync(join(home, 'install.json'), 'utf8')).autoUpdate).toBe(false);
    expect((await run(['update', '--auto', 'maybe'], deps)).code).toBe(2);
  });

  it('checks for updates on commands, not on --json, --version or help', async () => {
    const { deps, spawned, home } = installed();
    deps.now = () => Date.now() + 2 * CHECK_INTERVAL_MS;
    await run(['agents', '--json'], deps);
    await run(['--version'], deps);
    await run(['help'], deps);
    expect(spawned).toEqual([]);
    await run(['agents'], deps);
    expect(spawned).toHaveLength(1);
    expect(existsSync(join(home, 'running', String(process.pid)))).toBe(false);
  });

  it('points npx and npm installs at npm and the installer', async () => {
    const result = await run(['update'], { packageRoot: process.cwd() });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('npm install -g genaicode@latest');
    expect(result.stderr).toContain('npx genaicode install');
  });
});

describe('genaicode install', () => {
  function npxDeps(base: string, version = '2.36.0') {
    const root = writePackage(join(base, 'npx-cache'), version);
    const npm: string[] = [];
    const deps: UpdateDeps = {
      packageRoot: root,
      env: { HOME: base, PATH: '' },
      now: () => Date.now(),
      resolveVersion: async (tag) => tag.replace(/^v/, ''),
      npmInstall: async (prefix, spec) => {
        npm.push(spec);
        writePackage(prefix, spec.split('@')[1]);
      },
      spawnBackground: () => {},
    };
    return { deps, npm };
  }

  it('installs the running version from npm and sets up the command', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'genaicode-install-')));
    dirs.push(base);
    const { deps, npm } = npxDeps(base);
    const result = await installCommand(deps, {});
    const home = realpathSync(join(base, '.genaicode'));
    expect(npm).toEqual(['genaicode@2.36.0']);
    expect(result).toMatchObject({ home, version: '2.36.0', shim: join(base, '.local', 'bin', 'genaicode') });
    expect(readlinkSync(join(home, 'current'))).toBe(join('versions', '2.36.0'));
    expect(readdirSync(join(home, 'versions'))).toEqual(['2.36.0']);
    expect(findInstall(join(home, 'versions', '2.36.0', 'node_modules', 'genaicode'))).toEqual({
      home,
      version: '2.36.0',
    });
  });

  it('takes --version, GENAICODE_HOME and reuses a version already there', async () => {
    const base = mkdtempSync(join(tmpdir(), 'genaicode-install-'));
    dirs.push(base);
    const { deps, npm } = npxDeps(base);
    deps.env.GENAICODE_HOME = join(base, 'gc');
    await installCommand(deps, { version: 'v2.35.1', binDir: join(base, 'bin') });
    await installCommand(deps, { version: '2.35.1', binDir: join(base, 'bin') });
    expect(npm).toEqual(['genaicode@2.35.1']);
    expect(readlinkSync(join(base, 'gc', 'current'))).toBe(join('versions', '2.35.1'));
    expect(existsSync(join(base, 'bin', 'genaicode'))).toBe(true);
  });

  it('keeps a version another installer finished while npm ran', async () => {
    const base = mkdtempSync(join(tmpdir(), 'genaicode-install-'));
    dirs.push(base);
    const { deps } = npxDeps(base);
    const theirs = join(base, '.genaicode', 'versions', '2.36.0');
    deps.npmInstall = async (prefix, spec) => {
      writePackage(theirs, '2.36.0');
      writeFileSync(join(theirs, 'marker'), 'theirs');
      writePackage(prefix, spec.split('@')[1]);
    };
    await installCommand(deps, {});
    expect(readFileSync(join(theirs, 'marker'), 'utf8')).toBe('theirs');
    expect(readdirSync(join(base, '.genaicode', 'versions'))).toEqual(['2.36.0']);
  });

  it('reports a failed npm install and leaves nothing behind', async () => {
    const base = mkdtempSync(join(tmpdir(), 'genaicode-install-'));
    dirs.push(base);
    const { deps } = npxDeps(base);
    deps.npmInstall = async () => {
      throw new Error('E404');
    };
    await expect(installCommand(deps, {})).rejects.toThrow('E404');
    expect(readdirSync(join(base, '.genaicode', 'versions'))).toEqual([]);
  });

  it("finds a genaicode that comes before the shim on PATH, but not npx's own", () => {
    const base = mkdtempSync(join(tmpdir(), 'genaicode-install-'));
    dirs.push(base);
    const global = join(base, 'global', 'bin');
    const npx = join(base, '.npm', '_npx', 'abc', 'node_modules', '.bin');
    const bin = join(base, '.local', 'bin');
    for (const dir of [global, npx, bin]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'genaicode'), '');
    }
    expect(shadowingCommand({ PATH: [npx, global, bin].join(delimiter) }, bin)).toBe(join(global, 'genaicode'));
    expect(shadowingCommand({ PATH: [npx, bin, global].join(delimiter) }, bin)).toBeUndefined();
  });
});

/** Builds a minimal `.tgz` package tarball for mock npm registry tests. */
function makeTarball(version: string): Buffer {
  const entry = (name: string, content: string): Buffer => {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i];
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    const pad = (512 - (data.length % 512)) % 512;
    return Buffer.concat([header, data, Buffer.alloc(pad)]);
  };
  return gzipSync(
    Buffer.concat([
      entry('package/package.json', JSON.stringify({ name: 'genaicode', version })),
      entry('package/dist/cli.js', '// cli\n'),
      Buffer.alloc(1024),
    ]),
  );
}

describe('npmInstall', () => {
  it('forces online packument revalidation in update and install.sh', () => {
    const args = npmInstallArgs('/tmp/staging', 'genaicode@2.41.0');
    expect(args).toContain('--prefer-online');
    expect(args).toContain('--no-prefer-offline');

    const installScript = readFileSync(join(process.cwd(), 'scripts', 'install.sh'), 'utf8');
    expect(installScript).toMatch(/npm install[^\n]*--prefer-online[^\n]*--no-prefer-offline/);
  });

  it('revalidates a fresh cached packument so a newly published version does not ETARGET', async () => {
    const base = mkdtempSync(join(tmpdir(), 'genaicode-npm-cache-'));
    dirs.push(base);
    const cache = join(base, 'cache');
    const userconfig = join(base, 'empty.npmrc');
    writeFileSync(userconfig, '');

    const published = ['2.40.0'];
    let etag = '"v1"';
    const packumentIfNoneMatch: Array<string | undefined> = [];

    const server = createServer((req, res) => {
      const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      if (req.url === '/genaicode') {
        packumentIfNoneMatch.push(req.headers['if-none-match']);
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { 'cache-control': 'public, max-age=300', etag });
          res.end();
          return;
        }
        const versions = Object.fromEntries(
          published.map((v) => [
            v,
            { name: 'genaicode', version: v, dist: { tarball: `${host}/genaicode/-/${v}.tgz` } },
          ]),
        );
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', etag });
        res.end(JSON.stringify({ name: 'genaicode', 'dist-tags': { latest: published.at(-1) }, versions }));
        return;
      }
      const match = /^\/genaicode\/-\/([^/]+)\.tgz$/.exec(req.url ?? '');
      if (match) {
        res.writeHead(200, { 'content-type': 'application/gzip' });
        res.end(makeTarball(match[1]));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
        delete cleanEnv[key];
      }
      const env: NodeJS.ProcessEnv = {
        ...cleanEnv,
        npm_config_cache: cache,
        npm_config_registry: registry,
        npm_config_userconfig: userconfig,
      };

      const first = join(base, 'v2.40.0');
      mkdirSync(first, { recursive: true });
      await defaultUpdateDeps(env).npmInstall(first, 'genaicode@2.40.0');
      expect(readVersion(join(first, 'node_modules', 'genaicode'))).toBe('2.40.0');

      // Publish 2.41.0 well inside the cached packument's max-age=300 window.
      published.push('2.41.0');
      etag = '"v2"';

      const second = join(base, 'v2.41.0');
      mkdirSync(second, { recursive: true });
      await defaultUpdateDeps({ ...env, npm_config_prefer_offline: 'true' }).npmInstall(second, 'genaicode@2.41.0');
      expect(readVersion(join(second, 'node_modules', 'genaicode'))).toBe('2.41.0');
      expect(packumentIfNoneMatch).toEqual([undefined, '"v1"']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
