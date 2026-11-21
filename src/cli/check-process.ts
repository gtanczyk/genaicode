import { spawn } from 'node:child_process';

export interface CheckResult {
  exitCode: number | null;
  output: string;
}

/** Keep the tail of the check's output: that is where test runners put the failures. */
const CHECK_OUTPUT_LIMIT = 16_000;

export function runCheckProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  shell = false,
  directoryFd?: number,
): Promise<CheckResult> {
  return new Promise((done) => {
    let output = '';
    if (signal?.aborted) return done({ exitCode: null, output: 'Check stopped.' });
    const group = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd,
      env,
      shell,
      detached: group,
      stdio: directoryFd === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', directoryFd],
    });
    let escalation: NodeJS.Timeout | undefined;
    const stop = (how: NodeJS.Signals) => {
      try {
        if (group && child.pid) process.kill(-child.pid, how);
        else child.kill(how);
      } catch {
        // The test command has already exited.
      }
    };
    const abort = () => {
      stop('SIGTERM');
      escalation = setTimeout(() => stop('SIGKILL'), 1000).unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-CHECK_OUTPUT_LIMIT);
    };
    child.stdout!.on('data', collect);
    child.stderr!.on('data', collect);
    child.on('error', (error) => done({ exitCode: null, output: `${output}\n${error.message}`.trim() }));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(escalation);
      // A runner may ignore SIGTERM and close its output before its shell exits.
      if (signal?.aborted) stop('SIGKILL');
      done({ exitCode: signal?.aborted ? null : code, output });
    });
  });
}
