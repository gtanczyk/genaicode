import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const extraProcesses = 64;
const memoryMiB = 1536;
export const packTestLimits = { timeoutMs: 5 * 60_000, memoryKiB: 2048 * 1024, processes: extraProcesses };
export type CheckLimits = typeof packTestLimits;

/** Apply inherited hard limits before the sandbox starts or any worker file is used. */
export async function limitedCommand(command: string, args: string[]) {
  const uid = process.getuid?.();
  if (!uid) throw new Error('Isolated tests need an unprivileged account to enforce the process limit.');
  const darwin = process.platform === 'darwin';
  // Linux counts threads against RLIMIT_NPROC. Existing user processes retain their own limits.
  const { stdout } = await exec('/bin/ps', ['-U', String(uid), ...(darwin ? [] : ['-L']), '-o', 'pid='], {
    timeout: 3000,
  });
  const baseline = stdout.trim().split(/\s+/).length;
  const wrapper = fileURLToPath(new URL('./limit-test.sh', import.meta.url));
  const memoryBytes = packTestLimits.memoryKiB * 1024;
  const scope = darwin
    ? []
    : [
        '--user',
        '--scope',
        '--quiet',
        '--collect',
        '--expand-environment=no',
        '--description=GenAIcode pack test',
        '--property=MemoryMax=' + memoryBytes,
        '--property=MemorySwapMax=0',
        '--property=TasksMax=' + extraProcesses,
        '--property=RuntimeMaxSec=' + packTestLimits.timeoutMs / 1000,
        '--',
        wrapper,
      ];
  return {
    executable: darwin ? wrapper : '/usr/bin/systemd-run',
    args: [
      ...scope,
      String(baseline + extraProcesses),
      darwin ? '0' : String(memoryMiB * 1024),
      String(memoryBytes),
      String(extraProcesses),
      ...(darwin ? ['/usr/sbin/taskpolicy', '-m', String(memoryMiB)] : []),
      command,
      ...args,
    ],
  };
}

/** Observe the complete process tree, including children that start a new process group. */
export function watchCheck(pid: number, limits: CheckLimits, stop: (why: string) => void) {
  let children = new Map<number, string>();
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => stop('Test time limit exceeded.'), limits.timeoutMs).unref();
  const sample = async () => {
    try {
      const { stdout } = await exec(
        '/bin/ps',
        ['-U', String(process.getuid?.()), '-o', 'pid=,ppid=,pgid=,rss=,lstart='],
        { timeout: 3000, maxBuffer: 8 * 1024 * 1024 },
      );
      if (closed) return;
      const byParent = new Map<number, number[]>();
      const stats = new Map<number, { rss: number; start: string }>();
      const visit = [pid];
      for (const row of stdout.trim().split('\n')) {
        const [pidText, parentText, group, rss, ...date] = row.trim().split(/\s+/);
        const id = Number(pidText),
          parent = Number(parentText),
          start = date.join(' ');
        if (!id || !start) continue;
        stats.set(id, { rss: Number(rss), start });
        if (Number(group) === pid || children.get(id) === start) visit.push(id);
        const siblings = byParent.get(parent);
        if (siblings) siblings.push(id);
        else byParent.set(parent, [id]);
      }
      children = new Map();
      let total = 0;
      for (const id of visit) {
        const stat = stats.get(id);
        if (children.has(id) || !stat) continue;
        children.set(id, stat.start);
        total += stat.rss;
        visit.push(...(byParent.get(id) ?? []));
      }
      if (total > limits.memoryKiB) return stop('Test memory limit exceeded.');
      if (children.size > limits.processes) return stop('Test process limit exceeded.');
      timer = setTimeout(sample, 250).unref();
    } catch {
      if (!closed) stop('Unable to monitor test resource limits.');
    }
  };
  void sample();
  return async () => {
    closed = true;
    clearTimeout(timer);
    clearTimeout(timeout);
    if (!children.size) return;
    // A PID may have been reused after a short-lived helper exited.
    try {
      const { stdout } = await exec('/bin/ps', ['-p', [...children.keys()].join(','), '-o', 'pid=,lstart='], {
        timeout: 3000,
      });
      for (const row of stdout.trim().split('\n')) {
        const [id, ...date] = row.trim().split(/\s+/);
        if (children.get(Number(id)) !== date.join(' ')) continue;
        try {
          process.kill(Number(id), 'SIGKILL');
        } catch {
          /* already exited */
        }
      }
    } catch {
      // ps also exits with status 1 when all requested processes have already ended.
    }
  };
}
