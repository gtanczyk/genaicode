import type { TokenUsage } from '../../core/types.js';
import type { SessionTurn } from '../session.js';
import type { AgentMode } from '../types.js';

/**
 * - `active`: written to in the last couple of minutes; an agent is probably working in it.
 * - `waiting`: the agent had the last word; the next move is the user's.
 * - `unfinished`: it stops at the user's message or in the middle of the agent's work.
 */
export type SessionActivity = 'active' | 'waiting' | 'unfinished';

export type ReplyEnding = 'question' | 'request' | 'command' | 'offer' | 'unreported';

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
  /**
   * The latest report of the session's hooks, epoch milliseconds, when later than `updatedAt`: one
   * that changed nothing shown (another tool finishing while a question waits) still counts as news.
   */
  heardAt?: number;
  state?: SessionActivity;
  /** The agent explicitly reports a running turn, which may be paused for input or approval. */
  turnInProgress?: true;
  /**
   * What a `waiting` session waits for, where the agent's hooks report it (`genaicode hooks
   * install`): `approval` when it asked whether it may use a tool, `reply` when its turn is over.
   */
  waitingFor?: 'approval' | 'reply';
  /** The tool it asks to use, while `waitingFor` is `approval`. */
  waitingTool?: string;
  /** Short read-only previews of shell commands currently asking for approval. */
  waitingCommands?: Array<{ tool: string; command: string }>;
  model?: string;
  /** Collaboration mode of the last turn, when the session store records it (e.g. Codex Plan mode). */
  mode?: AgentMode;
  usage?: TokenUsage;
  costUsd?: number;
  /** The file holding it (local). */
  path?: string;
  /** Where to open it in a browser (cloud). */
  url?: string;
  /**
   * The claude.ai project the session's messages were relayed from (Remote Control), read from the
   * first of them: its id, and its name where the message's context gives it.
   */
  project?: { id: string; name?: string };
  /**
   * Nobody typed into it, as far as the agent's store says: a scheduled task, a notification, a
   * headless `codex exec`. Listings leave these out unless asked (`SessionQuery.automated`).
   */
  automated?: true;
  /**
   * What the end of the agent's latest message asks of the user, read from `lastReply` of a
   * `waiting` session (`replyEnding()`): a `question`, a `request` put as a statement, a `command`
   * to run, an `offer` to go on, or `unreported` when it says it could not report back to whoever
   * sent it. None: it just ended.
   */
  ending?: ReplyEnding;
  /** Put away with `genaicode sessions archive` and nothing happened in it since. */
  archived?: true;
}

export interface SessionQuery {
  /** Only sessions active at or after this time, epoch milliseconds. */
  since?: number;
  /** Only sessions in this directory or below it. */
  cwd?: string;
  /** At most this many, newest first. */
  limit?: number;
  /** Environment that says where the stores are (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `HOME`). Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** `false`: leave out what the agents' hooks reported (`listSessions()` adds it by default). */
  live?: boolean;
  /** `true`: also the sessions nobody typed into (`SessionInfo.automated`), left out by default. */
  automated?: boolean;
  /** Leave expired hook reports on disk when listing, as the read-only session tools do. */
  readOnly?: boolean;
  signal?: AbortSignal;
}

/** A place sessions are kept: an agent's local store, or a vendor's cloud. */
export interface SessionSource {
  name: string;
  where: 'local' | 'cloud';
  /**
   * The version of the agent's CLI whose store this source was last checked against. A newer CLI
   * may keep its sessions differently: `checkSessions()` says whether the source still reads them.
   */
  verified?: string;
  /**
   * The same sessions asked of the agent itself, where it can be asked (Codex's app server):
   * `checkSessions({ reference: true })` compares them with what `list()` reads. Undefined when
   * the agent is not installed or does not answer.
   */
  reference?(query?: SessionQuery): Promise<SessionInfo[] | undefined>;
  /** Newest first. Rejects when the store cannot be read at all; a missing store is an empty list. */
  list(query?: SessionQuery): Promise<SessionInfo[]>;
  /**
   * Sessions whose id is `id` or starts with it, for stores where that is quicker than listing
   * everything (`findSession()` uses it when present).
   */
  find?(id: string, query?: SessionQuery): Promise<SessionInfo[]>;
  /**
   * What was said in a session this source listed, as turns `AgentSession.adopt()` takes: prompts,
   * the agent's messages and tool calls, oldest first. Only the end of a very long one is read.
   * Absent where the store's conversations cannot be read (yet).
   */
  read?(session: SessionInfo, options?: SessionReadOptions): Promise<SessionTurn[]>;
}

export interface SessionReadOptions {
  /** Include bounded, inline raster previews when the store contains the original bytes. */
  imagePreviews?: boolean;
  /** At most this many turns, the latest ones. Default 100. */
  maxTurns?: number;
  /** Tool output longer than this is cut. Default 4000 characters. */
  maxToolOutput?: number;
  /** Called when earlier turns or file bytes were omitted due to `maxTurns` or the tail-size cap. */
  onTruncated?(reason: 'max-turns' | 'tail-bytes'): void;
}
