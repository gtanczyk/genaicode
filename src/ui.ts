import { createRequire } from 'node:module';
import { defaultAgents } from './agents/defaults.js';
import type { AgentSession, SessionState } from './agents/session.js';
import type { AgentTask, ApprovalDecision, CodingAgent } from './agents/types.js';

/**
 * `genaicode/ui`: the `genaicode ui` chat served on 127.0.0.1 for a host that shows it in its
 * own page (an iframe) and wants a say in the session: MCP servers, env, a prompt prefix.
 *
 * The UI itself (React, Ink) is bundled in `dist/ui/` and loaded only when
 * `startEmbeddedWeb` runs, so importing this module pulls no UI code. For a chat drawn by the
 * host's own React tree, use `genaicode/react` instead.
 */

export interface EmbeddedWebOptions {
  /** Directory the agent works in. */
  cwd: string;
  /** Agents to offer. Default: the same headless drivers as `genaicode ui`. */
  agents?: readonly CodingAgent[];
  /** Agent to start with. Default: the first installed one. */
  agent?: string;
  model?: string;
  effort?: string;
  /** Continue this agent session on the first turn. */
  resume?: string;
  /** Environment for the agent CLIs. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Task fields for every turn: `mcpServers`, `timeoutMs`, `maxTurns`, `extraArgs`. */
  task?: Omit<AgentTask, 'prompt' | 'cwd' | 'model' | 'effort' | 'resume' | 'signal' | 'onApproval' | 'env'>;
  /** Rewrites each prompt before it reaches the agent; the transcript shows what was typed. */
  transformPrompt?(prompt: string): string;
  /** Approve every permission request without asking. */
  approveAll?: boolean;
  /** Bark when the agent needs the user or finishes, while the tab is hidden. Default true. */
  bark?: boolean;
  /** Origins of the pages that show the UI in a frame. Read per request. Default: none. */
  frameAncestors?: () => readonly string[];
  /** Port on 127.0.0.1. Default: a free port. */
  port?: number;
  /** Shown in the page header. Default: this package's version. */
  version?: string;
}

/** The session behind an embedded UI, for the host to drive alongside the user. */
export interface EmbeddedChatController {
  /** Send a prompt (or a slash command) as if typed in the UI. */
  submit(text: string): 'ok' | 'quit';
  stop(): void;
  approve(id: string, decision: ApprovalDecision): boolean;
  /** Show a line from the host in the transcript. */
  note(text: string, tone?: 'info' | 'error'): void;
  get(): { session: SessionState };
  subscribe(listener: (view: { session: SessionState }) => void): () => void;
  readonly session: AgentSession;
}

export interface EmbeddedWeb {
  /** The UI with its access token: the iframe's `src`. Keep it out of logs and other pages. */
  url: string;
  controller: EmbeddedChatController;
  close(): Promise<void>;
}

/** What `startEmbeddedWeb` in the bundle (src/ui/index.tsx) takes, after defaults. */
export type EmbeddedWebBundleOptions = EmbeddedWebOptions & {
  agents: readonly CodingAgent[];
  version: string;
  frameAncestors: () => readonly string[];
};

interface UiBundle {
  startEmbeddedWeb(options: EmbeddedWebBundleOptions): Promise<EmbeddedWeb>;
}

/**
 * Start the chat UI on 127.0.0.1 for the host's page. Rejects with an error named
 * `NoAgentError` when no agent CLI is installed (or `agent` is unknown).
 */
export async function startEmbeddedWeb(options: EmbeddedWebOptions): Promise<EmbeddedWeb> {
  const ui = await loadBundledUi();
  return ui.startEmbeddedWeb({
    ...options,
    agents: options.agents ?? defaultAgents(),
    version: options.version ?? packageVersion(),
    frameAncestors: options.frameAncestors ?? (() => []),
  });
}

/** The front ends are bundled into dist/ui by scripts/build-ui.mjs; the path is kept opaque to tsc. */
function loadBundledUi(): Promise<UiBundle> {
  const bundle: string = new URL('./ui/index.js', import.meta.url).href;
  return import(bundle) as Promise<UiBundle>;
}

function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require('../package.json') as { version: string }).version;
}
