import { existsSync, statSync } from 'node:fs';
import { approximateSize, EventQueue } from './event-queue.js';
import { startProcess, type ProcessExit } from './process.js';
import type { AgentCapabilities, AgentEvent, AgentResult, AgentRun, AgentTask, CodingAgent } from './types.js';

const STDERR_TAIL_BYTES = 4 * 1024;

/** What a driver reports about the task's end, beyond the exit code. */
export interface AgentOutcome {
  ok: boolean;
  error?: string;
}

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
  const events = new EventQueue<AgentEvent>(approximateSize);
  const parser = definition.createParser();
  const state: { sessionId?: string; text?: string; usage?: AgentResult['usage']; costUsd?: number; error?: string } =
    {};
  let stderrTail = '';

  const emit = (event: AgentEvent) => {
    if (event.type === 'session') state.sessionId = event.sessionId;
    if (event.type === 'message') state.text = event.text;
    if (event.type === 'usage') {
      state.usage = event.usage;
      if (event.costUsd !== undefined) state.costUsd = event.costUsd;
    }
    if (event.type === 'error') state.error = event.message;
    events.push(event);
  };

  const finish = (exit: ProcessExit) => {
    const result = buildResult(definition, exit, parser.outcome?.(), state, stderrTail.trim());
    events.push({ type: 'done', result });
    events.close();
    return result;
  };

  const invalid = invalidCwd(task.cwd);
  if (invalid) {
    const result = finish({ exitCode: null, signal: null, reason: 'spawn-error', error: new Error(invalid) });
    return { result: Promise.resolve(result), abort() {}, [Symbol.asyncIterator]: () => events.iterate() };
  }

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
        emit({ type: 'raw', line });
        return;
      }
      for (const event of parser.event(value)) emit(event);
    },
    onStderr(text) {
      stderrTail = (stderrTail + text).slice(-STDERR_TAIL_BYTES);
      emit({ type: 'stderr', text });
    },
  });

  // A consumer that falls behind pauses the agent instead of buffering its output without bound.
  events.onPressure = (paused) => (paused ? handle.pause() : handle.resume());

  return {
    result: handle.exit.then(finish),
    abort: handle.kill,
    [Symbol.asyncIterator]: () => events.iterate(),
  };
}

function invalidCwd(cwd: string): string | undefined {
  if (!existsSync(cwd)) return `Working directory does not exist: ${cwd}`;
  if (!statSync(cwd).isDirectory()) return `Working directory is not a directory: ${cwd}`;
  return undefined;
}

function buildResult(
  definition: CliAgentDefinition,
  exit: ProcessExit,
  outcome: AgentOutcome | undefined,
  state: { sessionId?: string; text?: string; usage?: AgentResult['usage']; costUsd?: number; error?: string },
  stderr: string,
): AgentResult {
  const status: AgentResult['status'] =
    exit.reason === 'aborted'
      ? 'aborted'
      : exit.reason === 'timeout'
        ? 'timeout'
        : exit.reason === 'exit' && exit.exitCode === 0 && outcome?.ok !== false
          ? 'completed'
          : 'failed';

  let error: string | undefined;
  if (status === 'aborted') error = `${definition.name} was stopped.`;
  else if (status === 'timeout') error = `${definition.name} timed out.`;
  else if (exit.reason === 'overflow') error = `${definition.name} wrote a stdout line over 16 MiB.`;
  else if (exit.reason === 'spawn-error') error = spawnMessage(definition, exit.error);
  else if (status === 'failed')
    error =
      (outcome?.ok === false ? outcome.error : undefined) ??
      state.error ??
      (stderr || `${definition.name} exited with code ${exit.exitCode ?? 'unknown'}.`);

  return {
    status,
    ok: status === 'completed',
    exitCode: exit.exitCode,
    signal: exit.signal,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(state.text !== undefined ? { text: state.text } : {}),
    ...(state.usage ? { usage: state.usage } : {}),
    ...(state.costUsd !== undefined ? { costUsd: state.costUsd } : {}),
    ...(error ? { error } : {}),
  };
}

function spawnMessage(definition: CliAgentDefinition, error: Error | undefined): string {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')
    return `${definition.command} was not found. Install ${definition.name} or pass its path as \`command\`.`;
  return error?.message ?? `${definition.name} could not start.`;
}
