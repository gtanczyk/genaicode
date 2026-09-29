import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { render } from 'ink';
import type { CodingAgent } from '../agents/types.js';
import { createChatController, NoAgentError, type ChatOptions } from './controller.js';
import { ChatApp } from './tui/app.js';
import { startWebUi } from './web/server.js';

/**
 * Interactive front ends for `genaicode chat` and `genaicode ui`.
 *
 * This module is bundled with Ink and React into `dist/ui/`, so the library itself keeps
 * no UI dependencies. The CLI loads it only for these two commands.
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
