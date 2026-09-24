import type { ProcessExit } from './process.js';
import { RunRecorder, type AgentOutcome } from './runtime.js';
import type { AgentCapabilities, AgentEvent, AgentRun, AgentTask, CodingAgent } from './types.js';

export type HostedTaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** What a hosted provider receives. `cwd` is the provider's workspace reference (a repo, a branch...). */
export type HostedTaskRequest = Omit<AgentTask, 'env' | 'signal' | 'onApproval' | 'timeoutMs'>;

export interface HostedPoll {
  state: HostedTaskState;
  /** Events since the previous poll. */
  events?: AgentEvent[];
  /** Opaque position handed back on the next poll. */
  cursor?: string;
  error?: string;
}

/**
 * A remote coding-agent service: tasks run on the vendor's machines and are polled.
 * Implement this for a hosted product and pass it to `hostedAgent()`.
 */
export interface HostedAgentProvider {
  readonly name: string;
  readonly capabilities?: AgentCapabilities;
  start(task: HostedTaskRequest, signal: AbortSignal): Promise<{ id: string }>;
  poll(id: string, cursor: string | undefined, signal: AbortSignal): Promise<HostedPoll>;
  /** Add input to a running task (backs `AgentRun.steer`). */
  send?(id: string, text: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface HostedAgentOptions {
  /** Delay between polls. Default 5 s. */
  pollIntervalMs?: number;
}

const TERMINAL = new Set<HostedTaskState>(['completed', 'failed', 'cancelled']);

/** Adapt a `HostedAgentProvider` to `CodingAgent`, so hosted and local agents share one API. */
export function hostedAgent(provider: HostedAgentProvider, options: HostedAgentOptions = {}): CodingAgent {
  return {
    name: provider.name,
    command: provider.name,
    capabilities: { ...provider.capabilities, steer: !!provider.send },
    run: (task) => runHosted(provider, task, options.pollIntervalMs ?? 5_000),
  };
}

function runHosted(provider: HostedAgentProvider, task: AgentTask, pollIntervalMs: number): AgentRun {
  const recorder = new RunRecorder(provider.name, provider.name);
  const controller = new AbortController();
  let stopReason: 'aborted' | 'timeout' | undefined;
  let taskId: string | undefined;

  const stop = (reason: 'aborted' | 'timeout') => {
    if (stopReason || controller.signal.aborted) return;
    stopReason = reason;
    controller.abort();
  };
  const onAbort = () => stop('aborted');
  task.signal?.addEventListener('abort', onAbort, { once: true });
  if (task.signal?.aborted) onAbort();
  const timer = task.timeoutMs !== undefined ? setTimeout(() => stop('timeout'), task.timeoutMs) : undefined;

  const exit = (reason: ProcessExit['reason'], error?: Error): ProcessExit => ({
    exitCode: null,
    signal: null,
    reason,
    ...(error ? { error } : {}),
  });

  const work = async (): Promise<{ exit: ProcessExit; outcome?: AgentOutcome }> => {
    // Local-only fields (process env, callbacks, timers) never reach the provider.
    const request: Partial<AgentTask> = { ...task };
    delete request.env;
    delete request.signal;
    delete request.onApproval;
    delete request.timeoutMs;
    try {
      taskId = (await provider.start(request as HostedTaskRequest, controller.signal)).id;
    } catch (error) {
      if (stopReason) return { exit: exit(stopReason) };
      return { exit: exit('spawn-error', error instanceof Error ? error : new Error(String(error))) };
    }
    recorder.emit({ type: 'session', sessionId: taskId });

    let cursor: string | undefined;
    while (!stopReason) {
      let poll: HostedPoll;
      try {
        poll = await provider.poll(taskId, cursor, controller.signal);
      } catch (error) {
        if (stopReason) break;
        // Do not leave a task running (and billing) that nobody watches any more.
        await provider.cancel(taskId).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        return { exit: exit('closed'), outcome: { ok: false, error: `Polling ${provider.name} failed: ${message}` } };
      }
      // Aborted while the poll was in flight: cancel, whatever state it reported.
      if (stopReason) break;
      for (const event of poll.events ?? []) recorder.emit(event);
      cursor = poll.cursor ?? cursor;
      if (TERMINAL.has(poll.state)) {
        if (poll.state === 'cancelled') return { exit: exit('aborted') };
        return {
          exit: exit('closed'),
          outcome:
            poll.state === 'completed'
              ? { ok: true }
              : { ok: false, error: poll.error ?? `${provider.name} task failed.` },
        };
      }
      // A consumer that falls behind holds the next poll instead of buffering without bound.
      await untilAborted(recorder.events.room(), controller.signal);
      await delay(pollIntervalMs, controller.signal);
    }
    await provider.cancel(taskId).catch(() => undefined);
    return { exit: exit(stopReason ?? 'aborted') };
  };

  const result = work().then(({ exit: ended, outcome }) => {
    clearTimeout(timer);
    task.signal?.removeEventListener('abort', onAbort);
    return recorder.finish(ended, outcome);
  });

  return {
    result,
    abort: () => stop('aborted'),
    ...(provider.send
      ? {
          steer: (text: string) =>
            taskId && !stopReason
              ? provider.send!(taskId, text)
              : Promise.reject(new Error(`${provider.name} is not accepting input.`)),
        }
      : {}),
    [Symbol.asyncIterator]: () => recorder.events.iterate(),
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

/** Resolve when `wait` does or `signal` aborts, whichever comes first. */
function untilAborted(wait: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
    void wait.then(done);
  });
}
