import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { render } from 'ink';
import type { CodingAgent } from '../agents/types.js';
import type { EmbeddedWeb as PublicEmbeddedWeb, EmbeddedWebBundleOptions } from '../ui.js';
import { createChatController, NoAgentError, type ChatController, type ChatOptions } from './controller.js';
import { ChatApp } from './tui/app.js';
import { startWebUi, type WebAsset } from './web/server.js';

export { NoAgentError };

/**
 * Interactive front ends for `genaicode chat` and `genaicode ui`.
 *
 * This module is bundled with Ink and React into `dist/ui/`, so the library itself keeps
 * no UI dependencies. The CLI loads it only for these two commands, and the Vite plugin
 * (`genaicode/vite`) for `startEmbeddedWeb`.
 */
export interface UiRunOptions extends ChatOptions {
  agents: readonly CodingAgent[];
  version: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadStream;
  signal?: AbortSignal;
}

export interface WebRunOptions extends UiRunOptions {
  host?: string;
  port?: number;
  open?: boolean;
  /** Browser bundle. Default: `web-client.js` next to this module. */
  clientScript?: string;
  /** Mascot and bark. Default: the `assets/` folder next to this module. */
  assets?: ReadonlyMap<string, WebAsset>;
}

const ASSET_TYPES: Record<string, string> = {
  'wolf-64.png': 'image/png',
  'wolf.webp': 'image/webp',
  'wolf-dark.webp': 'image/webp',
  'bark.mp3': 'audio/mpeg',
};

/** The web UI's static files; a missing one only means no picture or no sound. */
export function loadAssets(dir: URL): Map<string, WebAsset> {
  const assets = new Map<string, WebAsset>();
  for (const [name, type] of Object.entries(ASSET_TYPES)) {
    const file = new URL(name, dir);
    if (existsSync(file)) assets.set(name, { type, body: readFileSync(file) });
  }
  return assets;
}

export async function runChat(options: UiRunOptions): Promise<number> {
  let controller;
  try {
    controller = createChatController(options);
  } catch (error) {
    if (!(error instanceof NoAgentError)) throw error;
    options.stderr.write(`${error.message}\n`);
    return 2;
  }
  const app = render(<ChatApp controller={controller} cwd={options.cwd} version={options.version} />, {
    stdout: options.stdout,
    stdin: options.stdin,
    exitOnCtrlC: false,
  });
  const onAbort = () => app.unmount();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  await app.waitUntilExit();
  options.signal?.removeEventListener('abort', onAbort);
  controller.close();
  return 0;
}

export async function runWeb(options: WebRunOptions): Promise<number> {
  let controller;
  try {
    controller = createChatController(options);
  } catch (error) {
    if (!(error instanceof NoAgentError)) throw error;
    options.stderr.write(`${error.message}\n`);
    return 2;
  }
  const clientScript = options.clientScript ?? readFileSync(new URL('./web-client.js', import.meta.url), 'utf8');
  const ui = await startWebUi({
    controller,
    clientScript,
    title: { version: options.version, cwd: options.cwd },
    host: options.host,
    port: options.port,
    assets: options.assets ?? loadAssets(new URL('./assets/', import.meta.url)),
  });
  options.stderr.write(
    `genaicode ${options.version} · ${controller.get().session.agent} in ${options.cwd}\n` +
      `Open ${ui.url}\n(the link carries an access token; Ctrl-C stops the server)\n`,
  );
  if (options.open !== false) openBrowser(ui.url);
  await new Promise<void>((resolve) => {
    if (options.signal?.aborted) return resolve();
    options.signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  await ui.close();
  controller.close();
  return 0;
}

/** See `EmbeddedWebOptions` in src/ui.ts (`genaicode/ui`), which fills in the defaults. */
export interface EmbeddedWebOptions extends ChatOptions {
  version: string;
  /** Origins of the pages that show the UI in a frame. */
  frameAncestors: () => readonly string[];
  port?: number;
  clientScript?: string;
  assets?: ReadonlyMap<string, WebAsset>;
}

export interface EmbeddedWeb {
  /** The UI with its access token, for the overlay's frame. */
  url: string;
  controller: ChatController;
  close(): Promise<void>;
}

/**
 * The browser UI for a host that shows it in its own page (the Vite plugin), and that sends
 * prompts itself through `controller`. Throws `NoAgentError` when no agent is installed.
 */
export async function startEmbeddedWeb(options: EmbeddedWebOptions): Promise<EmbeddedWeb> {
  const controller = createChatController(options);
  try {
    const ui = await startWebUi({
      controller,
      clientScript: options.clientScript ?? readFileSync(new URL('./web-client.js', import.meta.url), 'utf8'),
      title: { version: options.version, cwd: options.cwd },
      port: options.port,
      frameAncestors: options.frameAncestors,
      assets: options.assets ?? loadAssets(new URL('./assets/', import.meta.url)),
    });
    return {
      url: ui.url,
      controller,
      close: async () => {
        await ui.close();
        controller.close();
      },
    };
  } catch (error) {
    controller.close();
    throw error;
  }
}

// `genaicode/ui` (src/ui.ts) calls this through a dynamic import; keep the two in step.
export type { PublicEmbeddedWeb, EmbeddedWebBundleOptions };
startEmbeddedWeb satisfies (options: EmbeddedWebBundleOptions) => Promise<PublicEmbeddedWeb>;

function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser opener: the URL is printed anyway.
  }
}
