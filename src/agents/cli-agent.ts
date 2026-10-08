import { planSpawnAsync, type PrepareContext, type PreparedRun, type SpawnPlan } from './prepare.js';
import { startProcess, type ProcessHandle } from './process.js';
import { invalidCwd, RunRecorder, type AgentOutcome } from './runtime.js';
import type { AgentCapabilities, AgentEvent, AgentRun, AgentTask, CodingAgent } from './types.js';

export type { AgentOutcome } from './runtime.js';

/** Per-run decoder for one vendor's JSON event stream. */
export interface AgentOutputParser {
  /** Map one parsed stdout JSON value to zero or more events. */
  event(value: unknown): AgentEvent[];
  /** The terminal verdict the agent itself reported, if it reported one. */
  outcome?(): AgentOutcome | undefined;
}

export interface CliAgentDefinition {
  name: string;
  command: string;
  capabilities?: AgentCapabilities;
  /** Full argument list for a task, prompt included. */
  args(task: AgentTask): string[];
  /**
   * Replaces `args` when a task needs setup: extra env, temp files to clean up, a local
   * server to start first. The process starts once it resolves.
   */
  prepare?(task: AgentTask, context: PrepareContext): PreparedRun | Promise<PreparedRun>;
  createParser(): AgentOutputParser;
  /** Adjust the child environment (the caller's `task.env` or `process.env`). */
  env?(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
}

/**
 * Build a `CodingAgent` from a headless CLI: spawn, decode its JSON lines, and
 * fold them into an `AgentResult`. Drivers such as `claude()` are thin definitions.
 */
export function cliAgent(definition: CliAgentDefinition): CodingAgent {
  return {
    name: definition.name,
    command: definition.command,
    capabilities: definition.capabilities ?? {},
    run: (task) => runCliAgent(definition, task),
  };
}

function runCliAgent(definition: CliAgentDefinition, task: AgentTask): AgentRun {
  const recorder = new RunRecorder(definition.name, definition.command);
  const iterate = () => recorder.events.iterate();
  const lifetime = new AbortController();
  if (task.signal?.aborted) lifetime.abort();
  else task.signal?.addEventListener('abort', () => lifetime.abort(), { once: true });
  let handle: ProcessHandle | undefined;
  let stopped = false;

  const context: PrepareContext = { emit: (event) => recorder.emit(event), signal: lifetime.signal };
  const start = (plan: Extract<SpawnPlan, { ok: true }>) => {
    const parser = definition.createParser();
    const started = startProcess({
      command: definition.command,
      args: plan.args,
      cwd: task.cwd,
      env: plan.env,
      timeoutMs: task.timeoutMs,
      signal: task.signal,
      onLine(line) {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          recorder.emit({ type: 'raw', line });
          return;
        }
        for (const event of parser.event(value)) recorder.emit(event);
      },
      onStderr: (text) => recorder.emit({ type: 'stderr', text }),
    });
    handle = started;
    // A consumer that falls behind pauses the agent instead of buffering its output without bound.
    recorder.events.onPressure = (paused) => (paused ? started.pause() : started.resume());
    return started.exit.then((exit) => {
      lifetime.abort();
      plan.cleanup();
      return recorder.finish(exit, parser.outcome?.());
    });
  };

  const result = planSpawnAsync(definition, task, invalidCwd(task.cwd), context).then((plan) => {
    if (!plan.ok) {
      lifetime.abort();
      return recorder.finish(
        { exitCode: null, signal: null, reason: 'spawn-error', error: new Error(plan.error) },
        undefined,
      );
    }
    // Stopped while `prepare` was still running.
    if (stopped || task.signal?.aborted) {
      lifetime.abort();
      plan.cleanup();
      return recorder.finish({ exitCode: null, signal: null, reason: 'aborted' }, undefined);
    }
    return start(plan);
  });

  return {
    result,
    abort() {
      stopped = true;
      lifetime.abort();
      handle?.kill();
    },
    [Symbol.asyncIterator]: iterate,
  };
}
