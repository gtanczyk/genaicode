import { createRequire } from 'node:module';
import type { Plugin, ViteDevServer } from 'vite';
import { defaultAgents } from '../agents/defaults.js';
import type { CodingAgent } from '../agents/types.js';
import type { OverlayConfig } from '../overlay/client.js';
import { API, handleOverlayRequest, overlayModule, startOverlayUi, type OverlayUi } from '../overlay/server.js';

export { fixPrompt, isLoopback } from '../overlay/server.js';

export interface GenaicodeViteOptions {
  /** Agent to start with. Default: the first installed one. */
  agent?: string;
  model?: string;
  effort?: string;
  /** Approve every permission request without asking. */
  approveAll?: boolean;
  /** Agents to offer. Default: the same headless drivers as `genaicode ui`. */
  agents?: readonly CodingAgent[];
  /** Collect the page's errors and offer to send them to the agent. Default true. */
  captureErrors?: boolean;
  /** Port of the genaicode UI on 127.0.0.1. Default: a free port. */
  port?: number;
  /** Loads the bundled front ends. Defaults to `dist/ui/index.js`; tests pass the sources. */
  loadUi?(): Promise<EmbeddedUiModule>;
}

/** What the plugin needs from the bundled front ends (see `startEmbeddedWeb` in src/ui/index.tsx). */
export interface EmbeddedUiModule {
  NoAgentError: new (...args: never[]) => Error;
  startEmbeddedWeb(options: {
    agents: readonly CodingAgent[];
    agent?: string;
    cwd: string;
    model?: string;
    effort?: string;
    approveAll?: boolean;
    version: string;
    port?: number;
    frameAncestors: () => readonly string[];
  }): Promise<OverlayUi>;
}

const OVERLAY_ID = 'virtual:genaicode-overlay';

/**
 * `genaicode/vite`: the genaicode UI inside a Vite dev server. The page gets a wolf in the
 * corner that opens the chat with a coding agent working in the project, and its errors
 * (build errors, uncaught exceptions, console.error) go to the agent with one click.
 *
 * Only `vite dev`: builds are untouched. The UI runs on its own port on 127.0.0.1, so a dev
 * server started with `--host` does not expose the agent to the network.
 */
export function genaicode(options: GenaicodeViteOptions = {}): Plugin {
  let started: Promise<OverlayUi | undefined> | undefined;
  const overlay: OverlayConfig = { api: API, captureErrors: options.captureErrors ?? true };
  let base = '/';
  // Origins the app's pages were actually opened at (e.g. app.localhost), for frame-ancestors.
  const seen = new Set<string>();

  return {
    name: 'genaicode',
    apply: 'serve',

    configResolved(config) {
      base = config.base;
    },

    configureServer(server) {
      started = startOverlayUi(async () => {
        const ui = await (options.loadUi ?? loadBundledUi)();
        return ui.startEmbeddedWeb({
          agents: options.agents ?? defaultAgents(),
          agent: options.agent,
          cwd: server.config.root,
          model: options.model,
          effort: options.effort,
          approveAll: options.approveAll,
          version: packageVersion(),
          port: options.port,
          frameAncestors: () => pageOrigins(server, seen),
        });
      }, server.config.logger);

      server.middlewares.use((req, res, next) => {
        handleOverlayRequest(req, res, {
          ui: started,
          onPage: (origin) => seen.add(origin),
          overlay,
          https: !!server.config.server.https,
          // Vite checks the Host itself (server.allowedHosts).
          loopbackHosts: false,
        }).then((done) => done || next(), next);
      });
    },

    resolveId(id) {
      if (id === OVERLAY_ID) return `\0${OVERLAY_ID}`;
    },

    load(id) {
      if (id !== `\0${OVERLAY_ID}`) return;
      return overlayModule(overlay, 'import.meta.hot');
    },

    async transformIndexHtml() {
      if (!(await started)) return;
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: `${base}@id/__x00__${OVERLAY_ID}` },
          // First, so the app's own startup errors are caught too. Module scripts are deferred.
          injectTo: 'head-prepend',
        },
      ];
    },

    // Vite calls this when the dev server closes or restarts.
    async buildEnd() {
      const ui = await started;
      started = undefined;
      await ui?.close();
    },
  };
}

/** Where the app's pages come from, allowed to show the UI in a frame. */
function pageOrigins(server: ViteDevServer, seen: ReadonlySet<string>): string[] {
  const urls = [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])];
  const origins = new Set<string>(seen);
  for (const url of urls) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // Not a URL: skip it.
    }
  }
  if (origins.size === 0) {
    // Middleware mode, or not listening yet: any local port.
    for (const origin of ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*']) origins.add(origin);
  }
  return [...origins];
}

/** The front ends are bundled into dist/ui by scripts/build-ui.mjs; the path is kept opaque to tsc. */
function loadBundledUi(): Promise<EmbeddedUiModule> {
  const bundle: string = new URL('../ui/index.js', import.meta.url).href;
  return import(bundle) as Promise<EmbeddedUiModule>;
}

function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require('../../package.json') as { version: string }).version;
}
