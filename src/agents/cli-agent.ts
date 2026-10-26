import { planSpawnAsync, type PrepareContext, type PreparedRun, type SpawnPlan } from './prepare.js';
import { startProcess, type ProcessHandle } from './process.js';
import { invalidCwd, linkAbort, RunRecorder, type AgentOutcome } from './runtime.js';
import type { AgentCapabilities, AgentEvent, AgentRun, AgentTask, CodingAgent } from './types.js';

export type { AgentOutcome } from './runtime.js';

/** Per-run decoder for one vendor's JSON event stream. */
export interface AgentOutputParser {
  /** Map one parsed stdout JSON value to zero or more events. */
  event(value: unknown): AgentEvent[];
  /** The terminal verdict the agent itself reported, if it reported one. */
  outcome?(): AgentOutcome | undefined;
  /**
   * With `CliAgentDefinition.input`: `taken` when the value echoes an input line the agent
   * started on, `idle` when it finished its work and waits for more input.
   */
  input?(value: unknown): 'taken' | 'idle' | undefined;
}

/**
 * An agent that reads its prompt from stdin and accepts more input while it works
 * (`capabilities.steer`). Stdin ends once the agent is idle with every line taken.
 */
export interface CliAgentInput {
  /** The lines written as the process starts: the prompt. */
  start(task: AgentTask): string[];
  /** One stdin line carrying steering text. */
  steer(text: string): string;
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
  /** Write the prompt to stdin and allow `AgentRun.steer`. */
  input?: CliAgentInput;
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
  linkAbort(task.signal, lifetime);
  let handle: ProcessHandle | undefined;
  let stopped = false;

  const context: PrepareContext = { emit: (event) => recorder.emit(event), signal: lifetime.signal };
  const input = definition.input ? stdinInput(definition, definition.input, task) : undefined;
  const start = (plan: Extract<SpawnPlan, { ok: true }>) => {
    const parser = definition.createParser();
    let pressure = false;
    const flow = () => (pressure && !input?.waiting() ? started.pause() : started.resume());
    const started = startProcess({
      command: definition.command,
      args: plan.args,
      cwd: task.cwd,
      env: plan.env,
      timeoutMs: task.timeoutMs,
      signal: task.signal,
      stdin: !!input,
      onLine(line) {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          recorder.emit({ type: 'raw', line });
          return;
        }
        for (const event of parser.event(value)) recorder.emit(event);
        if (input) {
          const signal = parser.input?.(value);
          if (signal) input.observe(signal);
          flow();
        }
      },
      onStderr: (text) => recorder.emit({ type: 'stderr', text }),
    });
    handle = started;
    input?.attach(started);
    // A consumer that falls behind pauses the agent instead of buffering its output without bound.
    // A steer awaited from inside the loop needs its echo read, so output flows while one waits.
    recorder.events.onPressure = (paused) => {
      pressure = paused;
      flow();
    };
    return started.exit.then((exit) => {
      lifetime.abort();
      plan.cleanup();
      input?.fail();
      return recorder.finish(exit, parser.outcome?.());
    });
  };

  const result = planSpawnAsync(definition, task, invalidCwd(task.cwd), context).then((plan) => {
    if (!plan.ok) {
      lifetime.abort();
      input?.fail();
      return recorder.finish(
        { exitCode: null, signal: null, reason: 'spawn-error', error: new Error(plan.error) },
        undefined,
      );
    }
    // Stopped while `prepare` was still running.
    if (stopped || task.signal?.aborted) {
      lifetime.abort();
      plan.cleanup();
      input?.fail();
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
    ...(input ? { steer: input.steer } : {}),
    [Symbol.asyncIterator]: iterate,
  };
}

/**
 * Stdin for one run: the prompt lines, then steering lines. A steer resolves once the agent
 * echoes its line and rejects when the agent ends without taking it. Lines sent before the
 * process starts are written when it does.
 */
function stdinInput(definition: CliAgentDefinition, input: CliAgentInput, task: AgentTask) {
  const lines = input.start(task);
  const first = lines.length;
  let written = 0;
  let taken = 0;
  let ended = false;
  let child: ProcessHandle | undefined;
  const steers: { line: number; resolve(): void; reject(error: Error): void }[] = [];
  const settle = () => {
    while (steers.length && steers[0]!.line < taken) steers.shift()!.resolve();
  };
  const flush = () => {
    if (!child) return;
    try {
      for (; written < lines.length; written++) child.write(lines[written]!);
    } catch {
      fail();
    }
  };
  function fail() {
    ended = true;
    const error = new Error(`${definition.name} ended before it took the input.`);
    for (const steer of steers.splice(0)) steer.reject(error);
  }
  return {
    attach(started: ProcessHandle) {
      child = started;
      flush();
    },
    waiting: () => steers.length > 0,
    observe(signal: 'taken' | 'idle') {
      // The agent reads lines in order. Idle, it has taken at least the prompt.
      taken = Math.min(lines.length, signal === 'taken' ? taken + 1 : Math.max(taken, first));
      settle();
      if (signal !== 'idle' || taken < lines.length || ended) return;
      ended = true;
      child?.endInput();
    },
    fail,
    steer(text: string): Promise<void> {
      if (ended) return Promise.reject(new Error(`${definition.name} is not accepting input.`));
      const line = lines.length;
      lines.push(input.steer(text));
      const accepted = new Promise<void>((resolve, reject) => steers.push({ line, resolve, reject }));
      flush();
      return accepted;
    },
  };
}
