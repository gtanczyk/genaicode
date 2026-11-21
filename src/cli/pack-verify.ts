import { constants } from 'node:fs';
import { access, lstat, mkdtemp, open, readdir, readlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../agents/pack-git.js';
import { runPackCheck, type CheckResult } from './check-process.js';

const packageCaches = ['.cache', '.vite', '.vite-temp', '.vitest'];

// macOS resolves each file access against this policy, including the targets of symlinks.
const macProfile = [
  '(version 1)',
  '(deny default)',
  '(import "dyld-support.sb")',
  '(allow syscall* mach-bootstrap)',
  // Keep every descendant in the check's OS process group. Darwin's spawn API can also set a new group.
  '(deny syscall-unix (syscall-number SYS_setsid SYS_setpgid SYS_posix_spawn) (with errno EPERM))',
  '(allow process-fork process-exec)',
  '(allow signal (target same-sandbox))',
  '(allow sysctl-read (sysctl-name-prefix "hw.") (sysctl-name "kern.hostname" "kern.osrelease" "kern.ostype" "kern.osrevision" "kern.osversion" "kern.osproductversion" "kern.version" "kern.argmax" "kern.usrstack64"))',
  '(allow file-read-metadata)',
  '(allow file-map-executable (subpath "/System/Library") (subpath "/usr/lib") (subpath "/usr/bin") (subpath "/bin") (literal (param "NODE")) (subpath (param "WORK")) (subpath (param "SCRATCH")))',
  '(allow file-read* (subpath "/System/Library") (subpath "/bin") (subpath "/sbin") (subpath "/usr/bin") (subpath "/usr/lib") (subpath "/usr/libexec") (subpath "/usr/share") (subpath "/Library/Developer/CommandLineTools") (subpath "/private/var/db/dyld") (literal "/dev/urandom") (literal "/dev/random"))',
  '(allow file-read* (literal (param "NODE")) (subpath (param "NPM")))',
  '(allow file-read* (literal (param "NODE_FORK")))',
  '(allow file-read* (literal "/private/etc/hosts"))',
  '(allow file-read* file-write* (subpath (param "WORK")) (subpath (param "SCRATCH")) (literal "/dev/null"))',
].join('\n');

/** Keep installed packages at their original depth so workspace links resolve into the worker's tree. */
async function dependencyDirectories(project: string, nested: string, worktree: string) {
  const root = (nested && (await repoRoot(project))) || project;
  const installed: { source: string; path: string }[] = [];
  let directory = project;
  let location = nested;
  for (;;) {
    const source = join(directory, 'node_modules');
    const path = join(location, 'node_modules');
    if (
      (await realpath(source).catch(() => undefined)) === source &&
      !(await lstat(join(worktree, path)).catch(() => undefined))
    )
      installed.push({ source, path });
    if (!location || directory === root || dirname(directory) === directory) return installed;
    directory = dirname(directory);
    location = dirname(location);
    if (location === '.') location = '';
  }
}

const unavailable = (detail: string): CheckResult => ({
  exitCode: null,
  output: 'Isolated test runner unavailable. ' + detail,
});

/** Run the host's command in the disposable checkout supplied by the pack. */
export async function worktreeCheck(
  command: string,
  cwd: string,
  root: string,
  project: string,
  signal: AbortSignal,
): Promise<CheckResult> {
  const platform = process.platform;
  if (platform !== 'linux' && platform !== 'darwin')
    return unavailable('The built-in runner supports macOS Seatbelt and Linux bubblewrap.');
  const runner = platform === 'darwin' ? '/usr/bin/sandbox-exec' : '/usr/bin/bwrap';
  try {
    await access(runner, constants.X_OK);
  } catch {
    return unavailable('Install or enable ' + runner + ' to run this check.');
  }

  const work = await realpath(cwd);
  const nested = relative(root, work);
  if ((await realpath(root)) !== root || nested === '..' || nested.startsWith('..' + sep) || isAbsolute(nested))
    return unavailable('The test directory is outside the recorded Git tree.');
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'genaicode-test-')));
  try {
    const node = await realpath(process.execPath);
    const npm = await realpath(join(dirname(node), 'npm')).catch(() => undefined);
    const npmRoot =
      npm && basename(npm) === 'npm-cli.js' && basename(dirname(dirname(npm))) === 'npm'
        ? dirname(dirname(npm))
        : undefined;
    const dependencies = await dependencyDirectories(project, nested, root);
    const env = { PATH: [dirname(node), '/usr/bin', '/bin'].join(':'), HOME: scratch, TMPDIR: scratch, LANG: 'C' };
    if (platform === 'darwin') {
      const nodeFork = await realpath(fileURLToPath(new URL('./mac-fork.cjs', import.meta.url)));
      const params: Record<string, string> = {
        SCRATCH: scratch,
        NODE: node,
        NODE_FORK: nodeFork,
        NPM: npmRoot ?? scratch,
        WORK: root,
      };
      let prepareProfile = macProfile;
      let testProfile = macProfile;
      const copies: string[] = [];
      for (const [i, dep] of dependencies.entries()) {
        const dest = join(root, dep.path);
        params['SOURCE' + i] = dep.source;
        params['COPY' + i] = dest;
        prepareProfile += '\n(allow file-read* (subpath (param "SOURCE' + i + '")))';
        testProfile += '\n(deny file-write* (subpath (param "COPY' + i + '")))';
        for (const [j, cache] of packageCaches.entries()) {
          const key = 'CACHE' + i + '_' + j;
          params[key] = join(dest, cache);
          testProfile += '\n(allow file-write* (subpath (param "' + key + '")))';
        }
        copies.push(dep.source, dest);
      }
      const args = Object.entries(params).flatMap(([key, path]) => ['-D', key + '=' + path]);
      // APFS clones preserve relative links and share unchanged file data with the installation.
      // Only the fixed preparation command gets read access to the original dependency trees.
      if (copies.length) {
        const prepare = [
          'set -e; while [ "$#" -gt 0 ]; do /bin/cp -cRP "$1" "$2";',
          'for cache in ' + packageCaches.join(' ') + '; do /bin/rm -rf "$2/$cache"; /bin/mkdir "$2/$cache"; done;',
          'shift 2; done',
        ].join(' ');
        const prepared = await runPackCheck(
          runner,
          [...args, '-p', prepareProfile, '/bin/sh', '-c', prepare, 'copy', ...copies],
          scratch,
          env,
          signal,
        );
        if (prepared.exitCode !== 0) return prepared;
      }
      return await runPackCheck(
        runner,
        [...args, '-p', testProfile, '/bin/sh', '-c', command],
        work,
        { ...env, NODE_OPTIONS: '--require ' + JSON.stringify(nodeFork) },
        signal,
      );
    }
    // Bind only the disposable checkout and mount dependencies read-only inside it.
    const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if ((await realpath('/proc/self/fd/' + directory.fd)) !== root) return unavailable('The worktree moved.');
      const args = [
        '--unshare-all',
        '--new-session',
        '--die-with-parent',
        '--cap-drop',
        'ALL',
        '--clearenv',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--dir',
        '/tools',
      ];
      for (const path of [
        '/usr/bin',
        '/usr/lib',
        '/usr/lib64',
        '/usr/libexec',
        '/usr/share',
        '/bin',
        '/lib',
        '/lib64',
        '/etc/ld.so.cache',
      ])
        args.push('--ro-bind-try', path, path);
      if (!node.startsWith('/usr/bin/') && !node.startsWith('/bin/')) args.push('--ro-bind', node, node);
      args.push('--symlink', node, '/tools/node');
      if (npmRoot && npm) {
        if (!npmRoot.startsWith('/usr/share/')) args.push('--ro-bind', npmRoot, npmRoot);
        args.push('--symlink', npm, '/tools/npm');
      }
      args.push('--bind', '/proc/self/fd/3', '/work');
      // A writable parent lets bundlers create caches even when the host has never run them.
      // Mount each installed entry read-only and recreate local workspace links at the same depth.
      for (const dep of dependencies) {
        const dest = join('/work', dep.path);
        args.push('--dir', dest);
        for (const entry of await readdir(dep.source, { withFileTypes: true })) {
          if (packageCaches.includes(entry.name)) continue;
          const origin = join(dep.source, entry.name);
          const target = join(dest, entry.name);
          if (entry.isSymbolicLink()) args.push('--symlink', await readlink(origin), target);
          else if (entry.isFile() || entry.isDirectory()) args.push('--ro-bind', origin, target);
        }
      }
      args.push(
        '--chdir',
        join('/work', nested),
        '--setenv',
        'PATH',
        '/tools:/usr/bin:/bin',
        '--setenv',
        'HOME',
        '/tmp',
        '--setenv',
        'TMPDIR',
        '/tmp',
        '--setenv',
        'LANG',
        'C',
        '--',
        '/bin/sh',
        '-c',
        'exec 3<&-; exec /bin/sh -c "$1"',
        'verify',
        command,
      );
      return await runPackCheck(runner, args, scratch, env, signal, directory.fd);
    } finally {
      await directory.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
