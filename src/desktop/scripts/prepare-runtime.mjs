#!/usr/bin/env node
// Puts what the desktop app ships beside its shell into src-tauri/:
//   binaries/node-<target triple>   the official Node.js binary, checked against node-runtime.json
//   runtime/bin/node                the same binary, on Linux, where the app runs it from
//   runtime/node_modules/genaicode  this repository, packed and installed with its runtime dependencies
//
//   node src/desktop/scripts/prepare-runtime.mjs [--target <triple>] [--package <npm spec>]
//
// --package installs that spec (a tarball, `genaicode@2.41.1`) instead of packing the working tree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktop, '../..');
const tauri = join(desktop, 'src-tauri');
const { values } = parseArgs({ options: { target: { type: 'string' }, package: { type: 'string' } } });

const NODE_PLATFORMS = {
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-x64',
  'aarch64-unknown-linux-gnu': 'linux-arm64',
  'x86_64-unknown-linux-gnu': 'linux-x64',
};

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const target = values.target ?? execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
const platform = NODE_PLATFORMS[target];
if (!platform)
  throw new Error(`No Node.js build is mapped to ${target}. Known: ${Object.keys(NODE_PLATFORMS).join(', ')}`);

async function node() {
  const pinned = JSON.parse(readFileSync(join(desktop, 'node-runtime.json'), 'utf8'));
  const expected = pinned.sha256[platform];
  if (!expected) throw new Error(`node-runtime.json has no checksum for ${platform}`);
  const name = `node-v${pinned.version}-${platform}`;
  const cache = join(tauri, 'target', 'node-cache');
  const archive = join(cache, `${name}.tar.gz`);
  mkdirSync(cache, { recursive: true });
  const sum = () => createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (!existsSync(archive) || sum() !== expected) {
    const url = `https://nodejs.org/dist/v${pinned.version}/${name}.tar.gz`;
    console.log(`Downloading ${url}`);
    // curl follows the proxy settings of the machine; Node's fetch does not.
    run('curl', ['-fsSL', '--retry', '3', '-o', archive, url]);
    const got = sum();
    if (got !== expected) {
      rmSync(archive);
      throw new Error(`${name}.tar.gz has sha256 ${got}, node-runtime.json expects ${expected}`);
    }
  }
  const out = join(tauri, 'binaries');
  mkdirSync(out, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'genaicode-node-'));
  try {
    run('tar', ['-xzf', archive, '-C', scratch, `${name}/bin/node`]);
    const binary = join(out, `node-${target}`);
    writeFileSync(binary, readFileSync(join(scratch, name, 'bin', 'node')));
    chmodSync(binary, 0o755);
    console.log(`Node.js ${pinned.version} (${platform}) -> ${binary}`);
    return binary;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function genaicode() {
  const runtime = join(tauri, 'runtime');
  rmSync(runtime, { recursive: true, force: true });
  mkdirSync(runtime, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'genaicode-pack-'));
  try {
    let spec = values.package;
    if (!spec) {
      // `npm pack` builds first (the package's prepare script), so this is the working tree as published.
      run(npm, ['pack', '--pack-destination', scratch], { cwd: root });
      const tarball = readdirSync(scratch).find((file) => file.endsWith('.tgz'));
      if (!tarball) throw new Error('npm pack wrote no tarball');
      spec = join(scratch, tarball);
    }
    writeFileSync(
      join(runtime, 'package.json'),
      `${JSON.stringify({ name: 'genaicode-desktop-runtime', private: true })}\n`,
    );
    run(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', spec], {
      cwd: runtime,
    });
    const installed = JSON.parse(readFileSync(join(runtime, 'node_modules', 'genaicode', 'package.json'), 'utf8'));
    console.log(`genaicode ${installed.version} -> ${runtime}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const binary = await node();
genaicode();
if (platform.startsWith('linux-')) {
  // A Linux package puts what stands beside the executable into /usr/bin, where a `node` of ours
  // would replace the system's: there Node.js goes into the runtime instead (tauri.linux.conf.json).
  const inside = join(tauri, 'runtime', 'bin', 'node');
  mkdirSync(dirname(inside), { recursive: true });
  writeFileSync(inside, readFileSync(binary));
  chmodSync(inside, 0o755);
  console.log(`Node.js -> ${inside}`);
}
