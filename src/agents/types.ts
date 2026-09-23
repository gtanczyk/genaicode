import type { TokenUsage } from '../core/types.js';

/**
 * One unit of work handed to a coding agent: a prompt and the directory it may edit.
 *
 * The agent runs as a child process with the caller's `env`. GenAIcode does not
 * sandbox it, pick a model, or retry it; those stay application decisions.
 */
export interface AgentTask {
  prompt: string;
  /** Working directory the agent runs in (and edits). Must exist. */
  cwd: string;
  /** Model id passed to the agent CLI. Omit to keep the tool's own default. */
  model?: string;
  /** Reasoning effort, in the agent's own vocabulary (see `capabilities.effort`). */
  effort?: string;
  /** Upper bound on agent turns / model steps, where the agent supports one. */
  maxTurns?: number;
  /** Child environment. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Kill the agent after this many milliseconds. No timeout by default. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Extra CLI arguments, inserted before the prompt. */
  extraArgs?: readonly string[];
}

/**
 * Agent-neutral event IR for a running task.
 *
 * Drivers map each vendor's JSON event stream onto these. Unknown vendor events
 * are dropped; non-JSON stdout lines arrive as `raw`.
 */
export type AgentEvent =
  | { type: 'session'; sessionId: string; model?: string }
  | { type: 'text-delta'; text: string }
  | { type: 'message'; text: string }
  | { type: 'tool-start'; id?: string; name: string; input?: unknown }
  | { type: 'tool-end'; id?: string; name?: string; isError?: boolean; output?: string }
  | { type: 'file-change'; paths: string[] }
  | { type: 'approval-request'; detail?: unknown }
  | { type: 'usage'; usage: TokenUsage; costUsd?: number }
  | { type: 'error'; message: string }
  | { type: 'stderr'; text: string }
  | { type: 'raw'; line: string }
  | { type: 'done'; result: AgentResult };

export type AgentStatus = 'completed' | 'failed' | 'aborted' | 'timeout';

export interface AgentResult {
  status: AgentStatus;
  /** `status === 'completed'`: the process exited 0 and the agent reported no failure. */
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  sessionId?: string;
  /** The agent's final message, when it reported one. */
  text?: string;
  usage?: TokenUsage;
  costUsd?: number;
  /** Why the task did not complete. */
  error?: string;
}

export interface AgentCapabilities {
  /** Effort values the agent CLI accepts. Empty or absent: effort is not configurable. */
  effort?: readonly string[];
  /** Honors `AgentTask.maxTurns`. */
  maxTurns?: boolean;
  /** Reports token usage. */
  usage?: boolean;
}

/**
 * A started task. Iterate it for events (once), or await `result` alone.
 * The process starts when `run()` is called, whether or not anyone iterates. Until
 * iteration starts, only the latest 1,000 events are kept.
 */
export interface AgentRun extends AsyncIterable<AgentEvent> {
  readonly result: Promise<AgentResult>;
  /** Stop the agent. `result` settles with status `aborted`. */
  abort(): void;
}

export interface CodingAgent {
  readonly name: string;
  /** Executable looked up on PATH (or an absolute path). */
  readonly command: string;
  readonly capabilities: AgentCapabilities;
  run(task: AgentTask): AgentRun;
}
