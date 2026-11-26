import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The installed command (scripts/install.sh) keeps one npm install per version:
 *
 *   ~/.genaicode/versions/<version>/node_modules/genaicode   one per installed version
 *   ~/.genaicode/current -> versions/<version>               what the command runs
 *   ~/.genaicode/install.json                                bin dir, auto-update switch
 *   ~/.genaicode/update.json                                 last check, last update
 *   ~/.local/bin/genaicode                                   shim: node current/.../dist/cli.js
 *
 * An update installs the new version beside the old one and swaps `current` in one rename,
 * so a running session keeps its files and the next start runs the new version.
 */

export const INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/gtanczyk/genaicode/master/scripts/install.sh';
export const PACKAGE_NAME = 'genaicode';
/** How often a start looks for a new version. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A lock older than this was left by an updater that died. */
const STALE_LOCK_MS = 10 * 60 * 1000;
/** A plain semver, safe as a directory name. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHIM_MARKER = '# genaicode shim (scripts/install.sh)';

export interface Install {
  /** `~/.genaicode`. */
  home: string;
  /** The version this process runs. */
  version: string;
}

export interface InstallConfig {
  binDir?: string;
  /** false: `genaicode update --auto off`. */
  autoUpdate?: boolean;
}

export interface UpdateState {
  checkedAt?: number;
  /** The last update the background updater made, until a start reports it. */
  updated?: { from: string; to: string; at: number; shown?: boolean };
  error?: string;
}

export interface UpdateDeps {
  /** The package root this process runs from. */
  packageRoot: string;
  env: NodeJS.ProcessEnv;
  now(): number;
  /** The newest published version (`dist-tags.latest`), or the version a tag names. */
  resolveVersion(tag: string): Promise<string>;
  /** `npm install` the given spec into `prefix`. Rejects on failure. */
  npmInstall(prefix: string, spec: string): Promise<void>;
  /** Starts `genaicode update --background` detached from this process. */
  spawnBackground(cliPath: string): void;
}

export function defaultUpdateDeps(env: NodeJS.ProcessEnv): UpdateDeps {
  return {
    packageRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
    env,
    now: () => Date.now(),
    resolveVersion: (tag) => registryVersion(tag, env),
    npmInstall: (prefix, spec) => npmInstall(prefix, spec, env),
    spawnBackground: (cliPath) => {
      const child = spawn(process.execPath, [cliPath, 'update', '--background'], {
        detached: true,
        stdio: 'ignore',
        env: { ...env, GENAICODE_NO_AUTO_UPDATE: '1' },
        windowsHide: true,
      });
      child.on('error', () => {});
      child.unref();
    },
  };
}

/** The installed command this process runs from, or undefined for npx, `npm -g` and project installs. */
export function findInstall(packageRoot: string): Install | undefined {
  let root: string;
  try {
    root = realpathSync(packageRoot);
  } catch {
    return undefined;
  }
  const modules = dirname(root);
  const versionDir = dirname(modules);
  const versions = dirname(versionDir);
  const home = dirname(versions);
  if (basename(modules) !== 'node_modules' || basename(versions) !== 'versions') return undefined;
  if (!existsSync(join(home, 'install.json'))) return undefined;
  return { home, version: readVersion(root) };
}

export function readVersion(packageRoot: string): string {
  return (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version;
}

export function readConfig(home: string): InstallConfig {
  return readJson<InstallConfig>(join(home, 'install.json')) ?? {};
}

export function readState(home: string): UpdateState {
  return readJson<UpdateState>(join(home, 'update.json')) ?? {};
}

export function writeState(home: string, state: UpdateState): void {
  writeJson(join(home, 'update.json'), state);
}

/**
 * The `cli.js` path that outlives updates: under `current`, for the installed command, so hooks
 * written into agents' settings keep working after older versions are removed.
 */
export function stableCliPath(packageRoot: string): string {
  const install = findInstall(packageRoot);
  return install
    ? join(install.home, 'current', 'node_modules', PACKAGE_NAME, 'dist', 'cli.js')
    : join(packageRoot, 'dist', 'cli.js');
}

/**
 * The `cli.js` that agents' own settings (MCP servers, hooks) should start, and whether it is
 * the installed command's. Run from npx, this package sits in npx's cache, which npm clears: the
 * installed command is used instead when there is one, and `transient` says there is none. In a
 * Linux AppImage it sits in a mount that moves on every start, and its Node with it: `transient`.
 */
export function durableCliPath(
  packageRoot: string,
  env: NodeJS.ProcessEnv,
): { path: string; installed: boolean; transient: boolean } {
  if (findInstall(packageRoot)) return { path: stableCliPath(packageRoot), installed: true, transient: false };
  const own = join(packageRoot, 'dist', 'cli.js');
  let real = packageRoot;
  try {
    real = realpathSync(packageRoot);
  } catch {
    // A path that is not there is not npx's either.
  }
  const appImage = (env.APPDIR && real.startsWith(env.APPDIR)) || real.startsWith('/tmp/.mount_');
  if (appImage) return { path: own, installed: false, transient: true };
  if (!real.split(/[\\/]/).includes('_npx')) return { path: own, installed: false, transient: false };
  const home = resolve(env.GENAICODE_HOME || join(env.HOME ?? homedir(), '.genaicode'));
  const current = join(home, 'current', 'node_modules', PACKAGE_NAME, 'dist', 'cli.js');
  if (existsSync(join(home, 'install.json')) && existsSync(current)) {
    return { path: current, installed: true, transient: false };
  }
  return { path: own, installed: false, transient: true };
}

/** -1, 0 or 1. Pre-release suffixes sort before the release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const plain = v.replace(/^v/, '').split('+')[0];
    const dash = plain.indexOf('-');
    const core = dash < 0 ? plain : plain.slice(0, dash);
    const pre = dash < 0 ? undefined : plain.slice(dash + 1);
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return comparePrerelease(x.pre, y.pre);
}

/** Semver precedence: dot-separated, numeric ids numerically and below alphanumeric ones. */
function comparePrerelease(a: string, b: string): number {
  const xs = a.split('.');
  const ys = b.split('.');
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d) return Math.sign(d);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** The changelog sections after `from` up to and including `to`, newest first. */
export function releaseNotes(changelog: string, from: string | undefined, to: string): string {
  const sections = changelog.split(/^(?=## )/m);
  const picked = sections.filter((section) => {
    const version = /^## v?(\d+\.\d+\.\d+\S*)/.exec(section)?.[1];
    if (version === undefined) return false;
    return from === undefined
      ? version === to
      : compareVersions(version, from) > 0 && compareVersions(version, to) <= 0;
  });
  return picked.map((section) => section.trim()).join('\n\n');
}

/** Public notes shipped with this package. The desktop also uses this offline after a restart. */
export function installedReleaseNotes(
  version: string,
  from?: string,
  packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
): string {
  const changelog = readText(join(packageRoot, 'docs', 'CHANGELOG.md'));
  if (!changelog) return '';
  return releaseNotes(changelog, from, version)
    .split(/^(?=#{2,3} )/m)
    .filter((block) => !/^### Internal\s*$/m.test(block))
    .join('')
    .trim();
}

/** Sets up the command for the version this process runs (`install.sh` runs it once per install). */
export function selfInstall(options: {
  packageRoot: string;
  binDir?: string;
  force?: boolean;
  env: NodeJS.ProcessEnv;
}): {
  home: string;
  version: string;
  shim: string;
  onPath: boolean;
} {
  const root = realpathSync(options.packageRoot);
  const versionDir = dirname(dirname(root));
  const versions = dirname(versionDir);
  if (basename(dirname(root)) !== 'node_modules' || basename(versions) !== 'versions') {
    throw new Error(`self-install runs from <home>/versions/<version>/node_modules/genaicode, not ${root}`);
  }
  const home = dirname(versions);
  const config = readConfig(home);
  const binDir = resolve(options.binDir ?? config.binDir ?? join(options.env.HOME ?? homedir(), '.local', 'bin'));
  const shim = join(binDir, 'genaicode');
  if (existsSync(shim) && !options.force && !readFileSync(shim, 'utf8').includes(SHIM_MARKER)) {
    throw new Error(`${shim} exists and is not the genaicode shim; move it away or set GENAICODE_FORCE=1`);
  }
  writeJson(join(home, 'install.json'), { ...config, binDir });
  pointCurrent(home, basename(versionDir));
  // Just installed: the first daily check is a day away.
  writeState(home, { checkedAt: Date.now() });
  mkdirSync(binDir, { recursive: true });
  const cli = join(home, 'current', 'node_modules', PACKAGE_NAME, 'dist', 'cli.js');
  // Write beside it and rename over: an existing symlink is replaced, not followed.
  const next = `${shim}.${process.pid}.tmp`;
  try {
    writeFileSync(next, `#!/bin/sh\n${SHIM_MARKER}\nexec node ${shellQuote(cli)} "$@"\n`);
    chmodSync(next, 0o755);
    renameSync(next, shim);
  } catch (error) {
    rmSync(next, { force: true });
    throw error;
  }
  const onPath = (options.env.PATH ?? '').split(delimiter).some((entry) => entry && resolve(entry) === binDir);
  return { home, version: readVersion(root), shim, onPath };
}

/**
 * `npx genaicode install`: installs `version` (default: the one running) into `<home>/versions`
 * the way scripts/install.sh does, then sets up `current` and the shim from it.
 */
export async function installCommand(
  deps: UpdateDeps,
  options: { version?: string; binDir?: string; force?: boolean },
): Promise<ReturnType<typeof selfInstall>> {
  if (process.platform === 'win32') {
    throw new Error('The installed command is for macOS and Linux; on Windows use "npm install -g genaicode".');
  }
  const version = options.version
    ? await deps.resolveVersion(options.version)
    : readVersion(realpathSync(deps.packageRoot));
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version`);
  const home = resolve(deps.env.GENAICODE_HOME || join(deps.env.HOME ?? homedir(), '.genaicode'));
  const versions = join(home, 'versions');
  const dir = join(versions, version);
  mkdirSync(versions, { recursive: true });
  if (!isComplete(dir, version)) {
    const staging = join(versions, `.staging-install-${process.pid}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    try {
      await deps.npmInstall(staging, `${PACKAGE_NAME}@${version}`);
      if (!isComplete(staging, version)) throw new Error(`npm did not install ${PACKAGE_NAME}@${version}`);
      // Another installer may have finished this version meanwhile: keep it, drop the copy.
      if (!isComplete(dir, version)) {
        rmSync(dir, { recursive: true, force: true });
        renameSync(staging, dir);
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  return selfInstall({
    packageRoot: join(dir, 'node_modules', PACKAGE_NAME),
    binDir: options.binDir,
    force: options.force,
    env: deps.env,
  });
}

/**
 * The `genaicode` that runs instead of the shim: the first one on PATH before `binDir`.
 * npx's own `.bin` directories are skipped, since they only exist while npx runs.
 */
export function shadowingCommand(env: NodeJS.ProcessEnv, binDir: string): string | undefined {
  for (const entry of (env.PATH ?? '').split(delimiter)) {
    if (!entry) continue;
    const dir = resolve(entry);
    if (dir === resolve(binDir)) return undefined;
    if (/[\\/](_npx|node_modules[\\/]\.bin)([\\/]|$)/.test(dir)) continue;
    const candidate = join(dir, 'genaicode');
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}

export type UpdateOutcome =
  | { kind: 'current'; version: string }
  | { kind: 'available'; from: string; to: string }
  | { kind: 'updated'; from: string; to: string; notes: string }
  | { kind: 'busy' };

/** Installs `tag` (default: latest) beside the running version and switches the command to it. */
export async function updateInstall(
  install: Install,
  deps: UpdateDeps,
  options: { tag?: string; check?: boolean; background?: boolean } = {},
): Promise<UpdateOutcome> {
  const target = await deps.resolveVersion(options.tag ?? 'latest');
  if (!VERSION.test(target)) throw new Error(`"${target}" is not a version`);
  const from = currentVersion(install);
  const state = readState(install.home);
  // `latest` never moves a pre-release or a newer pin back; an explicit --version may.
  const current = options.tag === undefined ? compareVersions(target, from) <= 0 : target === from;
  if (options.check || current) {
    writeState(install.home, { ...state, checkedAt: deps.now(), error: undefined });
    return current ? { kind: 'current', version: from } : { kind: 'available', from, to: target };
  }
  const unlock = lock(install.home, deps.now());
  if (!unlock) return { kind: 'busy' };
  try {
    const versions = join(install.home, 'versions');
    const dir = join(versions, target);
    if (!isComplete(dir, target)) {
      const staging = join(versions, `.staging-${target}-${process.pid}`);
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
      try {
        await deps.npmInstall(staging, `${PACKAGE_NAME}@${target}`);
        if (!isComplete(staging, target)) throw new Error(`npm did not install ${PACKAGE_NAME}@${target}`);
        // Another installer may have finished this version meanwhile: keep it, drop the copy.
        if (!isComplete(dir, target)) {
          rmSync(dir, { recursive: true, force: true });
          renameSync(staging, dir);
        }
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    }
    pointCurrent(install.home, target);
    prune(versions, [target, from, install.version]);
    writeState(install.home, {
      checkedAt: deps.now(),
      // A start reports a background update once; a manual one was reported just now.
      updated: { from, to: target, at: deps.now(), ...(options.background ? {} : { shown: true }) },
    });
    const changelog = readText(join(dir, 'node_modules', PACKAGE_NAME, 'docs', 'CHANGELOG.md'));
    return { kind: 'updated', from, to: target, notes: changelog ? releaseNotes(changelog, from, target) : '' };
  } finally {
    unlock();
  }
}

/**
 * Run at the start of a command: reports an update the background updater made since the last
 * start, and starts one when the last check is a day old. Never waits on the network.
 */
export function autoUpdate(deps: UpdateDeps, notice: (line: string) => void): void {
  const install = findInstall(deps.packageRoot);
  if (!install) return;
  try {
    const state = readState(install.home);
    if (state.updated && !state.updated.shown) {
      const { from, to } = state.updated;
      notice(
        `genaicode updated ${from} → ${to} (https://github.com/gtanczyk/genaicode/releases/tag/v${to}). ` +
          (install.version === to ? '' : 'Restart to use it. ') +
          'Turn off with "genaicode update --auto off".',
      );
      writeState(install.home, { ...state, updated: { ...state.updated, shown: true } });
    }
    if (!autoUpdateEnabled(install, deps.env)) return;
    const now = deps.now();
    if (state.checkedAt !== undefined && now - state.checkedAt < CHECK_INTERVAL_MS) return;
    // Mark the check first, so commands started meanwhile do not start more updaters.
    writeState(install.home, { ...readState(install.home), checkedAt: now });
    deps.spawnBackground(join(deps.packageRoot, 'dist', 'cli.js'));
  } catch {
    // An update problem never stops the command the user asked for.
  }
}

/**
 * Records that this process runs its version (`<home>/running/<pid>`), so an update started
 * elsewhere does not remove files a long chat still loads on demand. Dead entries go at pruning.
 */
export function registerRun(packageRoot: string): () => void {
  const install = findInstall(packageRoot);
  if (!install) return () => {};
  const file = join(install.home, 'running', String(process.pid));
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, install.version);
  } catch {
    // Without the record the version may be pruned early; the command still runs.
  }
  return () => rmSync(file, { force: true });
}

/** Versions that live processes run; removes the records of processes that are gone. */
function runningVersions(home: string): string[] {
  const dir = join(home, 'running');
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const versions: string[] = [];
  for (const entry of entries) {
    const pid = Number(entry);
    const file = join(dir, entry);
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
      const version = readText(file)?.trim();
      if (version) versions.push(version);
    } else {
      rmSync(file, { force: true });
    }
  }
  return versions;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function autoUpdateEnabled(install: Install, env: NodeJS.ProcessEnv): boolean {
  if (truthy(env.GENAICODE_NO_AUTO_UPDATE) || truthy(env.CI)) return false;
  return readConfig(install.home).autoUpdate !== false;
}

export function setAutoUpdate(install: Install, enabled: boolean): void {
  writeJson(join(install.home, 'install.json'), { ...readConfig(install.home), autoUpdate: enabled });
}

/** `genaicode update --background`: a quiet update that records what happened. */
export async function backgroundUpdate(deps: UpdateDeps): Promise<void> {
  const install = findInstall(deps.packageRoot);
  if (!install) return;
  try {
    await updateInstall(install, deps, { background: true });
  } catch (error) {
    writeState(install.home, {
      ...readState(install.home),
      checkedAt: deps.now(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The version `current` points at (it may be newer than this process after a background update). */
function currentVersion(install: Install): string {
  try {
    return readVersion(join(install.home, 'current', 'node_modules', PACKAGE_NAME));
  } catch {
    return install.version;
  }
}

function isComplete(dir: string, version: string): boolean {
  const root = join(dir, 'node_modules', PACKAGE_NAME);
  try {
    return readVersion(root) === version && existsSync(join(root, 'dist', 'cli.js'));
  } catch {
    return false;
  }
}

/** Points `<home>/current` at `versions/<version>` in one rename. */
function pointCurrent(home: string, version: string): void {
  const link = join(home, 'current');
  const next = join(home, `.current-${process.pid}`);
  rmSync(next, { force: true });
  symlinkSync(join('versions', version), next);
  renameSync(next, link);
}

/** Removes versions other than `keep` (and any staging left by a crashed update). */
function prune(versions: string, keep: readonly string[]): void {
  const inUse = new Set([...keep, ...runningVersions(dirname(versions))]);
  for (const entry of readdirSync(versions)) {
    if (inUse.has(entry)) continue;
    if (!/^\d+\.\d+\.\d+/.test(entry) && !entry.startsWith('.staging-')) continue;
    // A staging dir ends with its owner's pid (installer or updater); leave live ones alone.
    const owner = /^\.staging-.*-(\d+)$/.exec(entry)?.[1];
    if (owner && isAlive(Number(owner))) continue;
    rmSync(join(versions, entry), { recursive: true, force: true });
  }
}

function lock(home: string, now: number): (() => void) | undefined {
  const path = join(home, 'update.lock');
  const take = () => {
    mkdirSync(path);
    writeFileSync(join(path, 'pid'), String(process.pid));
  };
  try {
    take();
  } catch {
    try {
      // A lock is stale only when its owner is gone; a slow npm install keeps it as long as it runs.
      const owner = Number(readText(join(path, 'pid')));
      const stale =
        Number.isInteger(owner) && owner > 0 ? !isAlive(owner) : now - statSync(path).mtimeMs >= STALE_LOCK_MS;
      if (!stale) return undefined;
      rmSync(path, { recursive: true, force: true });
      take();
    } catch {
      return undefined;
    }
  }
  return () => rmSync(path, { recursive: true, force: true });
}

async function registryVersion(tag: string, env: NodeJS.ProcessEnv): Promise<string> {
  const pinned = tag.replace(/^v(?=\d)/, '');
  if (VERSION.test(pinned)) return pinned;
  if (!/^[A-Za-z][\w.-]*$/.test(tag)) throw new Error(`"${tag}" is neither a version nor a dist-tag`);
  const registry = (env.npm_config_registry || env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org').replace(
    /\/+$/,
    '',
  );
  const response = await fetch(`${registry}/${PACKAGE_NAME}/${encodeURIComponent(tag)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${registry} answered ${response.status} for ${PACKAGE_NAME}@${tag}`);
  const { version } = (await response.json()) as { version?: string };
  if (!version || !VERSION.test(version)) throw new Error(`${registry} has no ${PACKAGE_NAME}@${tag}`);
  return version;
}

/** Arguments passed to `npm` when staging a version. Revalidates cached packuments so fresh releases do not ETARGET. */
export function npmInstallArgs(prefix: string, spec: string): string[] {
  return [
    'install',
    '--prefix',
    prefix,
    '--omit=dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    '--update-notifier=false',
    '--prefer-online',
    '--no-prefer-offline',
    spec,
  ];
}

function npmInstall(prefix: string, spec: string, env: NodeJS.ProcessEnv): Promise<void> {
  const args = npmInstallArgs(prefix, spec);
  return new Promise((done, fail) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4000)));
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error(`npm install ${spec} failed (${code}): ${stderr.trim()}`)),
    );
  });
}

/** Set and not "0", "false" or "no". */
function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && !/^(0|false|no|off)$/i.test(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function readJson<T>(path: string): T | undefined {
  const text = readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}
