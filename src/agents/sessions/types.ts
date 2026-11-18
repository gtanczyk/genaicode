import type { TokenUsage } from '../../core/types.js';

/**
 * - `active`: written to in the last couple of minutes; an agent is probably working in it.
 * - `waiting`: the agent had the last word; the next move is the user's.
 * - `unfinished`: it stops at the user's message or in the middle of the agent's work.
 */
export type SessionActivity = 'active' | 'waiting' | 'unfinished';

/** One conversation with a coding agent, wherever the agent keeps it. */
export interface SessionInfo {
  /** The `SessionSource` that found it. */
  source: string;
  /** The `genaicode/agents` driver name that can continue it (`claude`, `codex`...). */
  agent: string;
  /** The agent's own session id: what `AgentTask.resume` takes. */
  id: string;
  where: 'local' | 'cloud';
  /** Directory the session works in (local), or the repository it works on (cloud). */
  cwd?: string;
  repository?: string;
  branch?: string;
  /** The agent's or the user's name for it, when there is one. */
  title?: string;
  /** The first and the latest thing the user asked. */
  firstPrompt?: string;
  lastPrompt?: string;
  /** The end of the agent's latest message. */
  lastReply?: string;
  startedAt?: number;
  /** Last activity, epoch milliseconds. */
  updatedAt: number;
  state?: SessionActivity;
  model?: string;
  usage?: TokenUsage;
  costUsd?: number;
  /** The file holding it (local). */
  path?: string;
  /** Where to open it in a browser (cloud). */
  url?: string;
}

export interface SessionQuery {
  /** Only sessions active at or after this time, epoch milliseconds. */
  since?: number;
  /** Only sessions in this directory or below it. */
  cwd?: string;
  /** At most this many, newest first. */
  limit?: number;
  signal?: AbortSignal;
}

/** A place sessions are kept: an agent's local store, or a vendor's cloud. */
export interface SessionSource {
  name: string;
  where: 'local' | 'cloud';
  /** Newest first. Rejects when the store cannot be read at all; a missing store is an empty list. */
  list(query?: SessionQuery): Promise<SessionInfo[]>;
}
