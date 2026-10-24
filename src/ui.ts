import { createRequire } from 'node:module';
import { defaultAgents } from './agents/defaults.js';
import type { AgentSession, SessionState } from './agents/session.js';
import type { AgentTask, ApprovalDecision, CodingAgent } from './agents/types.js';
import { createOverlay, type Overlay, type OverlayLog } from './overlay/server.js';

/**
 * `genaicode/ui`: the `genaicode ui` chat served on 127.0.0.1 for a host that shows it in its
 * own page (an iframe) and wants a say in the session: MCP servers, env, a prompt prefix.
 *
 * The UI itself (React, Ink) is bundled in `dist/ui/` and loaded only when
 * `startEmbeddedWeb` runs, so importing this module pulls no UI code. For a chat drawn by the
 * host's own React tree, use `genaicode/react` instead.
 *
 * `createDevOverlay` puts the same chat into any Node dev server the way `genaicode/vite` does
 * for Vite: the genaicode wolf in the page's corner, with the page's errors in its badge.
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

export interface DevOverlayOptions extends Omit<EmbeddedWebOptions, 'cwd' | 'frameAncestors'> {
  /** Directory the agent works in. Default: `process.cwd()`. */
  cwd?: string;
  /** Collect the page's errors and offer to send them to the agent. Default true. */
  captureErrors?: boolean;
  /** Where the overlay says it started, or why not. Default: `console`. */
  log?: OverlayLog;
}

/** The genaicode overlay for a dev server: its routes, and the tag that puts it in a page. */
export type DevOverlay = Overlay<EmbeddedWeb>;

/**
 * The genaicode overlay for a dev server other than Vite (Express, webpack-dev-server, a
 * script that serves static files...): the wolf in the corner opens the chat with the agent
 * working in `cwd`, its badge counts the page's errors, and "Fix N errors" sends them to the
 * agent. Development only.
 *
 * ```js
 * const overlay = createDevOverlay();
 * app.use(overlay.middleware); // Express, before the app's routes
 * // ...and overlay.script in the dev HTML, or overlay.injectHtml(html) where HTML is served.
 * ```
 *
 * The chat starts in the background on 127.0.0.1. Its token goes only to the app's own pages
 * (same-origin), on this machine, opened at a loopback name (localhost, *.localhost,
 * 127.0.0.1, [::1]). Without an agent CLI the overlay stays off and the app runs on.
 */
export function createDevOverlay(options: DevOverlayOptions = {}): DevOverlay {
  const { captureErrors = true, log = console, ...web } = options;
  return createOverlay(
    (frameAncestors) => startEmbeddedWeb({ ...web, cwd: web.cwd ?? process.cwd(), frameAncestors }),
    { captureErrors, log },
  );
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
