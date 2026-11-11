import type { TokenUsage } from '../core/types.js';

/**
 * One unit of work handed to a coding agent: a prompt and the directory it may edit.
 *
 * The agent runs as a child process with the caller's `env`. GenAIcode does not pick a
 * model or retry it; those stay application decisions. `permissions` selects the agent's own
 * approval and sandbox options; without it each driver keeps its documented defaults.
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
  /**
   * Continue an earlier agent session instead of starting a new one: the `sessionId` of a
   * previous result (`capabilities.resume`). The agent keeps its own history of that session.
   */
  resume?: string;
  /** Extra CLI arguments, inserted before the prompt. */
  extraArgs?: readonly string[];
  /** MCP servers to attach for this task (`capabilities.mcp`). */
  mcpServers?: readonly McpServer[];
  /**
   * Answer the agent's permission prompts (`capabilities.approvals`). Without it every
   * request is declined, and so is a request whose handler throws.
   *
   * `signal` aborts when the answer is no longer wanted: the agent withdrew the request,
   * its turn ended, the process exited or the task was stopped. Close the question then;
   * whatever the handler returns afterwards counts as `deny`. Every genaicode driver passes
   * `signal`; it is optional only so that custom drivers written for 2.x keep compiling.
   */
  onApproval?: ApprovalHandler;
  /**
   * Approval and sandbox policy, translated by the driver into the agent's own options
   * (`capabilities.permissions` lists what it supports). An omitted field keeps the driver's
   * default. A value or combination the agent cannot honor fails the run with an error
   * instead of starting it in another mode. `'yolo'` is `{ approval: 'auto-approve',
   * sandbox: 'unrestricted' }`.
   */
  permissions?: AgentPermissions | 'yolo';
  /**
   * Token and cost caps for this run. Past `warnAt` of a cap the run emits `budget-warning`;
   * past the cap itself genaicode stops the agent and the run fails with a budget error.
   * Checked against the agent's usage reports (`capabilities.usage`), so an agent that reports
   * usage only at the end can overshoot. Drivers with a native cap pass it on as well.
   */
  budget?: AgentBudget;
}

export interface AgentBudget {
  /** Most tokens the run may use: `totalTokens`, else input + output. */
  maxTokens?: number;
  /** Most US dollars the run may cost, as the agent reports it. */
  maxCostUsd?: number;
  /** Fraction of a cap at which `budget-warning` fires. Default 0.8. */
  warnAt?: number;
}

/**
 * A plan or account limit the agent reported (Claude's subscription windows, Codex rate
 * limits), or an error that said a quota ran out.
 */
export interface RateLimit {
  /** Which limit: `5h`, `7d`, `7d-opus`, `overage`..., or `quota` when only an error said so. */
  window: string;
  /** `warning`: the vendor flagged it, or 80% or more is used. `exceeded`: requests are refused. */
  status: 'ok' | 'warning' | 'exceeded';
  /** Share of the limit used, 0-100. */
  usedPercent?: number;
  /** When the limit resets, in epoch milliseconds. */
  resetsAt?: number;
  /** The vendor's name for the limit, when it gave one (e.g. a per-model Codex limit). */
  name?: string;
}

/** A run crossed `warnAt` of one of its `AgentTask.budget` caps. */
export interface BudgetWarning {
  kind: 'tokens' | 'cost';
  used: number;
  limit: number;
}

/**
 * - `ask`: permission prompts go to `task.onApproval`, which is then required.
 * - `auto-approve`: every prompt is approved without asking, for exactly the scope the agent
 *   asked for. Where genaicode sees the prompt, it still emits `approval-request` and
 *   `approval-resolved` (with `automatic: true`); agents that approve on their own report nothing.
 * - `deny`: nothing that needs a prompt runs; `onApproval` is not called.
 */
export type ApprovalPolicy = 'ask' | 'auto-approve' | 'deny';

/**
 * - `workspace-write`: the agent's sandbox limits writes to `cwd` (network rules are the vendor's).
 * - `read-only`: the agent's read-only mode; nothing is written.
 * - `unrestricted`: no sandbox, even when the agent's own settings enable one.
 *
 * The sandbox bounds approvals too: `ask` and `auto-approve` never grant a step outside it.
 */
export type SandboxPolicy = 'workspace-write' | 'read-only' | 'unrestricted';

export interface AgentPermissions {
  approval?: ApprovalPolicy;
  sandbox?: SandboxPolicy;
}

export type ApprovalHandler = (
  request: ApprovalRequest,
  signal?: AbortSignal,
) => ApprovalDecision | Promise<ApprovalDecision>;

/** An MCP server the agent should connect to. `name` must match /^[A-Za-z0-9_-]+$/. */
export type McpServer =
  | { name: string; url: string; headers?: Readonly<Record<string, string>> }
  | {
      name: string;
      command: string;
      args?: readonly string[];
      env?: Readonly<Record<string, string>>;
    };

/**
 * Something an agent published for the user to look at (`publish_artifact`): a page, an image,
 * a document. The content stays in the `ArtifactStore`; this is what travels in session state.
 */
export interface Artifact {
  /** Unguessable, and the address of the content. Stays the same when the artifact is published again. */
  id: string;
  /** The agent's own name for it. Publishing the same name again replaces the content. */
  name: string;
  title: string;
  /** How to show it: `html` and `text` in a sandboxed frame, `image` as a picture, `file` as a download. */
  kind: 'html' | 'image' | 'text' | 'file';
  /** Chosen by genaicode from the file extension or format, never taken from the agent. */
  mimeType: string;
  bytes: number;
  /** 1 on the first publish, one more each time the content is replaced. */
  version: number;
  /** The source file, relative to the working directory, when it was published from a file. */
  path?: string;
}

export interface ApprovalRequest {
  id: string;
  /** `command`: run a shell command; `file-change`: apply edits; `other`: anything else. */
  kind: 'command' | 'file-change' | 'other';
  /** Human-readable summary (the command, the paths, or the vendor's reason). */
  summary?: string;
  /** The vendor's request payload, unchanged: the full command, tool arguments or permissions. */
  detail?: unknown;
  /**
   * What `approve` grants. `once` (also when absent): this one invocation. `turn`: the
   * permissions in `detail`, until the agent's current turn ends.
   */
  scope?: ApprovalScope;
}

export type ApprovalScope = 'once' | 'turn';

export type ApprovalDecision = 'approve' | 'deny';

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
  | { type: 'approval-request'; request: ApprovalRequest }
  /** `automatic`: decided by `permissions.approval`, without asking anyone. */
  | { type: 'approval-resolved'; id: string; decision: ApprovalDecision; automatic?: boolean }
  | { type: 'usage'; usage: TokenUsage; costUsd?: number }
  | { type: 'rate-limit'; limit: RateLimit }
  | { type: 'budget-warning'; warning: BudgetWarning }
  /** `withFallback()` moved the task from `from` to `to` after `failure`. */
  | { type: 'failover'; from: string; to: string; failure: AgentFailure }
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
  /** What kind of failure this was, when the driver could tell. Absent for an ordinary `failed`. */
  failure?: AgentFailure;
}

/**
 * Why a run failed, when it was the agent's fault rather than the task's:
 * - `quota`: a plan, account or API limit ran out (`resetsAt` when the vendor said).
 * - `auth`: the CLI is not signed in, or its key was refused.
 * - `unavailable`: the CLI is not installed or could not start.
 * - `crash`: the CLI ended without reporting a result, was killed, or broke its own protocol.
 * - `budget`: the run went over its `AgentTask.budget`.
 */
export interface AgentFailure {
  kind: 'quota' | 'auth' | 'unavailable' | 'crash' | 'budget';
  /** When the limit resets, in epoch milliseconds (`quota` only). */
  resetsAt?: number;
}

export interface AgentCapabilities {
  /** Effort values the agent CLI accepts. Empty or absent: effort is not configurable. */
  effort?: readonly string[];
  /** Honors `AgentTask.maxTurns`. */
  maxTurns?: boolean;
  /** Reports token usage. */
  usage?: boolean;
  /** Reports plan or account limits (`rate-limit` events) before they run out. */
  rateLimits?: boolean;
  /** `AgentRun.steer` can add input to a running task. */
  steer?: boolean;
  /** Permission prompts reach `AgentTask.onApproval`. */
  approvals?: boolean;
  /** Honors `AgentTask.mcpServers`. */
  mcp?: boolean;
  /** Honors `AgentTask.resume`. */
  resume?: boolean;
  /** `AgentTask.permissions` values the driver can translate. Absent: none. */
  permissions?: {
    approval?: readonly ApprovalPolicy[];
    sandbox?: readonly SandboxPolicy[];
  };
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
  /**
   * Send more input to the task while it runs (`capabilities.steer`). Rejects once
   * the task has ended, or when the agent did not acknowledge the input.
   */
  steer?(text: string): Promise<void>;
}

export interface CodingAgent {
  readonly name: string;
  /** Executable looked up on PATH (or an absolute path). */
  readonly command: string;
  readonly capabilities: AgentCapabilities;
  run(task: AgentTask): AgentRun;
}
