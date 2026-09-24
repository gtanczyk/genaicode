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

  const invalid = invalidCwd(task.cwd);
  if (invalid) {
    const result = recorder.finish(
      { exitCode: null, signal: null, reason: 'spawn-error', error: new Error(invalid) },
      undefined,
    );
    return { result: Promise.resolve(result), abort() {}, [Symbol.asyncIterator]: iterate };
  }

  const parser = definition.createParser();
  const baseEnv = task.env ?? process.env;
  const handle = startProcess({
    command: definition.command,
    args: definition.args(task),
    cwd: task.cwd,
    env: definition.env ? definition.env(baseEnv) : baseEnv,
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

  // A consumer that falls behind pauses the agent instead of buffering its output without bound.
  recorder.events.onPressure = (paused) => (paused ? handle.pause() : handle.resume());

  return {
    result: handle.exit.then((exit) => recorder.finish(exit, parser.outcome?.())),
    abort: handle.kill,
    [Symbol.asyncIterator]: iterate,
  };
}
