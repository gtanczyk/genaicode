import type { AgentFailure, ApprovalDecision, ApprovalRequest } from '../agents/types.js';
import type { ImageMediaType, TokenUsage } from '../core/types.js';

// The wire format between `remote()` in a page and `createAgentBackend()` on a server.
// Shared by both sides; nothing here imports Node.

/** A page tool as the server sees it: what the model may call, never how it runs. */
export interface PageToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments (an object schema). */
  inputSchema?: Record<string, unknown>;
  /** The page asks the user before it runs. */
  write?: boolean;
}

/** `POST <base>/turn`. Exactly one of `prompt` (with `images`), or answers to a waiting step. */
export interface TurnRequest {
  /** The token from the last `turn-end`. Absent: a new conversation. */
  state?: string;
  prompt?: string;
  images?: { mediaType: ImageMediaType; data: string; name?: string }[];
  /** The page's tools, when the backend takes them from the page (`pageTools: 'from-client'`). */
  tools?: PageToolSpec[];
  /** What the page tools of the waiting step returned. */
  results?: { id: string; output: string; isError?: boolean }[];
  /** The user's answers to the waiting step's server-tool approvals. */
  approvals?: { id: string; decision: ApprovalDecision }[];
}

/** A tool call the page has to run before the turn can go on. */
export interface PageCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** The server's list marks this tool `write`: the page asks first even if its own copy does not. */
  write?: boolean;
}

/**
 * The last line of every `POST /turn` stream. `waiting`: the turn goes on once the page sends
 * the results of `calls` and the user's answers to `approvals` with `state`.
 */
export interface TurnEnd {
  type: 'turn-end';
  state?: string;
  status: 'completed' | 'waiting' | 'failed';
  calls?: PageCall[];
  approvals?: ApprovalRequest[];
  /** The model's answer, when `completed`. */
  text?: string;
  /** Tokens this request used. */
  usage?: TokenUsage;
  model?: string;
  error?: string;
  failure?: AgentFailure;
}

/** Lines before `turn-end`. */
export type TurnLine =
  | { type: 'text-delta'; text: string }
  | { type: 'message'; text: string }
  | { type: 'tool-start'; id: string; name: string; input?: unknown }
  | { type: 'tool-end'; id: string; name: string; output?: string; isError?: boolean }
  | { type: 'error'; message: string }
  | TurnEnd;

/** `GET <base>/info`. */
export interface BackendInfo {
  name: string;
  model?: string;
  /** What a prompt may carry besides text. */
  inputs: 'image'[];
  /** False while this user's or the site's allowance is spent. */
  available: boolean;
  resetsAt?: number;
}

/** The body of a refused request (4xx, 5xx) before any stream starts. */
export interface BackendRefusal {
  error: string;
  failure?: AgentFailure;
}
