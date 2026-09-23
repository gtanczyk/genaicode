import { spawn } from 'node:child_process';

const MAX_LINE_BYTES = 16 * 1024 * 1024;
/** After the agent exits, how long a background child that inherited its pipes may keep them open. */
const EXIT_DRAIN_MS = 500;

export interface ProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Time between SIGTERM and SIGKILL. */
  killGraceMs?: number;
  /** Keep stdin open for `write()` (JSON-RPC agents). Default: stdin is closed. */
  stdin?: boolean;
  onLine(line: string): void;
  onStderr(text: string): void;
}

export interface ProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** `closed`: the caller ended a long-lived agent with `close()` after its work was done. */
  reason: 'exit' | 'closed' | 'aborted' | 'timeout' | 'spawn-error' | 'overflow';
  error?: Error;
}

export interface ProcessHandle {
  exit: Promise<ProcessExit>;
  /** Stop the process as aborted. */
  kill(): void;
  /** Stop the process as finished on purpose. */
  close(): void;
  /** Write one line to stdin. Requires `stdin: true`. */
  write(line: string): void;
}

/**
 * Spawn a child in its own process group and deliver stdout line by line.
 * Stopping signals the whole group, so tools the agent started die with it.
 */
export function startProcess(options: ProcessOptions): ProcessHandle {
  const groupKill = process.platform !== 'win32';
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    detached: groupKill,
  });

  let reason: ProcessExit['reason'] = 'exit';
  let spawnError: Error | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const signal = (name: NodeJS.Signals) => {
    try {
      if (groupKill && child.pid) process.kill(-child.pid, name);
      else child.kill(name);
    } catch {
      child.kill(name);
    }
  };
  let closed = false;
  // Stops still apply after the agent exits: a leftover child in its group can hold the pipes open.
  const stop = (why: ProcessExit['reason']) => {
    if (closed || reason !== 'exit') return;
    reason = why;
    signal('SIGTERM');
    escalation = setTimeout(() => signal('SIGKILL'), options.killGraceMs ?? 2_000);
    escalation.unref?.();
  };
  const onAbort = () => stop('aborted');

  let buffered = '';
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffered += chunk;
    let end = buffered.indexOf('\n');
    while (end >= 0) {
      const line = buffered.slice(0, end).replace(/\r$/, '');
      buffered = buffered.slice(end + 1);
      if (line.trim()) options.onLine(line);
      end = buffered.indexOf('\n');
    }
    if (buffered.length > MAX_LINE_BYTES) {
      buffered = '';
      stop('overflow');
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => options.onStderr(chunk));

  const exit = new Promise<ProcessExit>((resolve) => {
    child.once('error', (error) => {
      spawnError = error;
      reason = 'spawn-error';
    });
    child.once('exit', () => {
      // `close` waits for every holder of stdout/stderr. Stop waiting for the agent's leftovers.
      const drain = setTimeout(() => {
        child.stdout!.destroy();
        child.stderr!.destroy();
      }, EXIT_DRAIN_MS);
      drain.unref?.();
      child.once('close', () => clearTimeout(drain));
    });
    child.once('close', (exitCode, exitSignal) => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      options.signal?.removeEventListener('abort', onAbort);
      if (buffered.trim()) options.onLine(buffered.replace(/\r$/, ''));
      buffered = '';
      resolve({ exitCode, signal: exitSignal, reason, error: spawnError });
    });
  });

  if (options.timeoutMs !== undefined) timer = setTimeout(() => stop('timeout'), options.timeoutMs);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  child.stdin?.on('error', () => {
    // The agent exited mid-write; its exit status reports why.
  });

  return {
    exit,
    kill: () => stop('aborted'),
    close: () => stop('closed'),
    write(line) {
      if (!child.stdin || child.stdin.destroyed) throw new Error(`${options.command} is not accepting input.`);
      child.stdin.write(line.endsWith('\n') ? line : `${line}\n`);
    },
  };
}
