import { spawn } from 'node:child_process';
import { limitedCommand, packTestLimits, watchCheck, type CheckLimits } from './check-limits.js';

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
  limits?: CheckLimits,
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
    let limitReason: string | undefined;
    let finishWatch: (() => Promise<void>) | undefined;
    let cleanup: Promise<void> | undefined;
    const finish = () => (cleanup ??= finishWatch?.() ?? Promise.resolve());
    if (limits && child.pid)
      finishWatch = watchCheck(child.pid, limits, (reason) => {
        limitReason = reason;
        stop('SIGKILL');
        void finish();
      });
    const abort = () => {
      stop('SIGTERM');
      if (limits) void finish();
      escalation = setTimeout(() => stop('SIGKILL'), 1000).unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-CHECK_OUTPUT_LIMIT);
    };
    child.stdout!.on('data', collect);
    child.stderr!.on('data', collect);
    child.on('error', (error) => done({ exitCode: null, output: `${output}\n${error.message}`.trim() }));
    child.on('close', async (code) => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(escalation);
      // A runner may ignore SIGTERM and close its output before its shell exits.
      if (signal?.aborted || limits) stop('SIGKILL');
      await finish();
      done({
        exitCode: signal?.aborted || limitReason ? null : code,
        output: limitReason ? (output + '\n' + limitReason).trim() : output,
      });
    });
  });
}

/** Pack commands execute worker code and always use the bounded runner. */
export async function runPackCheck(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  directoryFd?: number,
): Promise<CheckResult> {
  try {
    const limited = await limitedCommand(command, args);
    return await runCheckProcess('/bin/bash', limited, cwd, env, signal, false, directoryFd, packTestLimits);
  } catch (error) {
    return {
      exitCode: null,
      output: 'Isolated test runner unavailable. ' + (error instanceof Error ? error.message : String(error)),
    };
  }
}
