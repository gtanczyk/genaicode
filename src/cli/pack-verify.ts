import { constants } from 'node:fs';
import { access, mkdtemp, open, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { runCheckProcess, type CheckResult } from './check-process.js';

// macOS resolves each file access against this policy, including the targets of symlinks.
const macProfile = [
  '(version 1)',
  '(deny default)',
  '(import "dyld-support.sb")',
  '(allow syscall* mach-bootstrap)',
  '(allow process-fork process-exec)',
  '(allow signal (target same-sandbox))',
  '(allow sysctl-read (sysctl-name-prefix "hw.") (sysctl-name "kern.hostname" "kern.osrelease" "kern.ostype" "kern.osrevision" "kern.osversion" "kern.osproductversion" "kern.version" "kern.argmax" "kern.usrstack64"))',
  '(allow file-read-metadata)',
  '(allow file-map-executable (subpath "/System/Library") (subpath "/usr/lib") (subpath "/usr/bin") (subpath "/bin") (literal (param "NODE")) (subpath (param "DEPS")) (subpath (param "SCRATCH")))',
  '(allow file-read* (subpath "/System/Library") (subpath "/bin") (subpath "/sbin") (subpath "/usr/bin") (subpath "/usr/lib") (subpath "/usr/libexec") (subpath "/usr/share") (subpath "/Library/Developer/CommandLineTools") (subpath "/private/var/db/dyld") (literal "/dev/urandom") (literal "/dev/random"))',
  '(allow file-read* (subpath (param "WORK")) (literal (param "NODE")) (subpath (param "NPM")) (subpath (param "DEPS")))',
  '(allow file-read* file-write* (subpath (param "SCRATCH")) (literal "/dev/null"))',
].join('\n');

// Copy inside the sandbox. Test caches and generated files can be written freely in the
// private copy. Links from the worker cannot grant access to anything else on the host.
const runInCopy =
  'set -e; exec 3<&-; /bin/mkdir "$2/project"; /bin/cp -RP "$1/." "$2/project"; cd "$2/project/$3"; exec /bin/sh -c "$4"';

const unavailable = (detail: string): CheckResult => ({
  exitCode: null,
  output: 'Isolated test runner unavailable. ' + detail,
});

/** The host chooses the runner and its environment. The worker controls only files inside the worktree. */
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
    return unavailable('The task directory has moved outside its original worktree.');
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'genaicode-test-')));
  try {
    const node = await realpath(process.execPath);
    const npm = await realpath(join(dirname(node), 'npm')).catch(() => undefined);
    const npmRoot =
      npm && basename(npm) === 'npm-cli.js' && basename(dirname(dirname(npm))) === 'npm'
        ? dirname(dirname(npm))
        : undefined;
    const dependencies = join(project, 'node_modules');
    const deps = (await realpath(dependencies).catch(() => undefined)) === dependencies ? dependencies : undefined;
    const env = { PATH: [dirname(node), '/usr/bin', '/bin'].join(':'), HOME: scratch, TMPDIR: scratch, LANG: 'C' };
    if (platform === 'darwin') {
      if (deps) await symlink(deps, join(scratch, 'node_modules'));
      const params = { WORK: root, SCRATCH: scratch, NODE: node, NPM: npmRoot ?? scratch, DEPS: deps ?? scratch };
      const args = Object.entries(params).flatMap(([key, path]) => ['-D', key + '=' + path]);
      return await runCheckProcess(
        runner,
        [...args, '-p', macProfile, '/bin/sh', '-c', runInCopy, 'verify', root, scratch, nested, command],
        scratch,
        env,
        signal,
      );
    }
    // Pin the source directory before bubblewrap resolves its mounts. A link or rename in
    // the worker's files cannot substitute a different host directory for /work.
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
      if (deps) args.push('--ro-bind', deps, '/node_modules');
      args.push(
        '--ro-bind',
        '/proc/self/fd/3',
        '/work',
        '--chdir',
        '/tmp',
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
        runInCopy,
        'verify',
        '/work',
        '/tmp',
        nested,
        command,
      );
      return await runCheckProcess(runner, args, scratch, env, signal, false, directory.fd);
    } finally {
      await directory.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
