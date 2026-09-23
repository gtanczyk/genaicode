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
  onLine(line: string): void;
  onStderr(text: string): void;
}

export interface ProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reason: 'exit' | 'aborted' | 'timeout' | 'spawn-error' | 'overflow';
  error?: Error;
}

export interface ProcessHandle {
  exit: Promise<ProcessExit>;
  kill(): void;
  /** Stop reading stdout and stderr, so the agent blocks once the pipes fill. */
  pause(): void;
  /** Read again after `pause()`. */
  resume(): void;
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
    stdio: ['ignore', 'pipe', 'pipe'],
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
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
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
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => options.onStderr(chunk));

  // `close` waits for every holder of stdout/stderr. After the agent exits, stop waiting
  // for its leftovers, but never while paused: the output still in the pipes is the agent's.
  let exited = false;
  let paused = false;
  let drain: ReturnType<typeof setTimeout> | undefined;
  const armDrain = () => {
    clearTimeout(drain);
    if (!exited || paused || closed) return;
    drain = setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
    }, EXIT_DRAIN_MS);
    drain.unref?.();
  };

  const exit = new Promise<ProcessExit>((resolve) => {
    child.once('error', (error) => {
      spawnError = error;
      reason = 'spawn-error';
    });
    child.once('exit', () => {
      exited = true;
      armDrain();
    });
    child.once('close', (exitCode, exitSignal) => {
      closed = true;
      clearTimeout(drain);
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

  return {
    exit,
    kill: () => stop('aborted'),
    pause() {
      if (paused || closed) return;
      paused = true;
      clearTimeout(drain);
      child.stdout.pause();
      child.stderr.pause();
    },
    resume() {
      if (!paused) return;
      paused = false;
      child.stdout.resume();
      child.stderr.resume();
      armDrain();
    },
  };
}
