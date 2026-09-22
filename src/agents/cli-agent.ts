import { planSpawn, type PreparedRun } from './prepare.js';
import { startProcess } from './process.js';
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
  /** Replaces `args` when a task needs setup: extra env, temp files to clean up. */
  prepare?(task: AgentTask): PreparedRun;
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

  const plan = planSpawn(definition, task, invalidCwd(task.cwd));
  if (!plan.ok) {
    const result = recorder.finish(
      { exitCode: null, signal: null, reason: 'spawn-error', error: new Error(plan.error) },
      undefined,
    );
    return { result: Promise.resolve(result), abort() {}, [Symbol.asyncIterator]: iterate };
  }

  const parser = definition.createParser();
  const handle = startProcess({
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

  return {
    result: handle.exit.then((exit) => {
      plan.cleanup();
      return recorder.finish(exit, parser.outcome?.());
    }),
    abort: handle.kill,
    [Symbol.asyncIterator]: iterate,
  };
}
