import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { detectAgents } from '../../agents/discovery.js';
import type { CodingAgent } from '../../agents/types.js';
import type { UiRelease } from './release.js';
import { secretOk, type WebAsset } from './server.js';

/** How to get an agent: the command that installs it and what signs it in. Others: its own site. */
const SETUP: Record<string, { name: string; install?: string; login?: string }> = {
  claude: {
    name: 'Claude Code',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    login: 'run "claude" once and sign in',
  },
  codex: { name: 'Codex', install: 'npm install -g @openai/codex', login: 'run "codex login"' },
  copilot: {
    name: 'GitHub Copilot CLI',
    install: 'npm install -g @github/copilot',
    login: 'run "copilot" once and type /login',
  },
  agy: { name: 'Antigravity' },
  muse: { name: 'Muse Code' },
  gemini: { name: 'Gemini CLI', install: 'npm install -g @google/gemini-cli', login: 'run "gemini" once and sign in' },
};

export interface WelcomeAgent {
  /** The command looked for on PATH. */
  command: string;
  name: string;
  installed: boolean;
  install?: string;
  login?: string;
}

/** The agents a chat could run, one per command, with whether each is installed. */
export function welcomeAgents(agents: readonly CodingAgent[], env?: NodeJS.ProcessEnv): WelcomeAgent[] {
  const seen = new Set<string>();
  return detectAgents(agents, env).flatMap(({ agent, path }) => {
    if (seen.has(agent.command)) return [];
    seen.add(agent.command);
    const setup = SETUP[agent.command];
    return [{ ...setup, command: agent.command, name: setup?.name ?? agent.name, installed: path !== null }];
  });
}

export interface WelcomeOptions {
  agents: readonly CodingAgent[];
  env?: NodeJS.ProcessEnv;
  version: string;
  host?: string;
  port?: number;
  token?: string;
  release?: () => UiRelease;
  assets?: ReadonlyMap<string, WebAsset>;
}

export interface Welcome {
  url: string;
  /** For the chat that takes this page's place: the same link then opens it. */
  token: string;
  port: number;
  /** Resolves once an agent is installed; the page asks every few seconds and on "Check again". */
  found: Promise<void>;
  close(): Promise<void>;
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function welcomeHtml(version: string, agents: readonly WelcomeAgent[], release?: UiRelease): string {
  const rows = agents
    .map(
      (agent) => `<li data-command="${escape(agent.command)}">
<div class="name">${escape(agent.name)} <code>${escape(agent.command)}</code><span class="state">not found</span></div>
${
  agent.install
    ? `<pre>${escape(agent.install)}</pre><div class="then">Then ${escape(agent.login ?? 'sign in')}.</div>`
    : `<div class="then">Install it from its own site, then sign in.</div>`
}
</li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>genaicode</title>
<link rel="icon" type="image/png" href="/assets/wolf-64.png">
<style>
html, body { margin: 0; min-height: 100%; }
body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: Canvas; color: CanvasText; }
.drag { position: fixed; inset: 0 0 auto 0; height: 40px; }
main { max-width: 40rem; margin: 0 auto; padding: 4rem 1.5rem 3rem; }
h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
p { margin: 0 0 1.25rem; opacity: .75; }
ul { list-style: none; margin: 0 0 1.25rem; padding: 0; }
li { border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 10px; padding: .75rem 1rem; margin-bottom: .6rem; }
.name { font-weight: 600; display: flex; gap: .5rem; align-items: baseline; }
.name code { font-weight: 400; opacity: .6; }
.state { margin-left: auto; font-weight: 400; font-size: 13px; opacity: .6; }
li.ok .state { color: #2b8a3e; opacity: 1; }
pre { margin: .5rem 0 .25rem; padding: .5rem .75rem; border-radius: 6px; background: color-mix(in srgb, CanvasText 7%, transparent); overflow-x: auto; user-select: all; -webkit-user-select: all; font-size: 13px; }
.then { font-size: 13px; opacity: .7; }
button { font: inherit; padding: .5rem 1.25rem; border-radius: 8px; border: 0; background: #3b5bdb; color: #fff; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
#note { margin: .75rem 0 0; font-size: 13px; min-height: 1.5em; }
small { opacity: .5; }
</style>
</head>
<body>
<div class="drag" data-tauri-drag-region></div>
<main id="welcome">
<h1>Connect a coding agent</h1>
<p>genaicode works through the coding agents you have: it brings none of its own. None was found on this computer. Install one in a terminal, sign in, and this page goes on by itself.</p>
<ul>
${rows}
</ul>
<button id="check" type="button">Check again</button>
<p id="note"></p>
<small>genaicode ${escape(version)}</small>
${
  release
    ? `<details${release.announce ? ' open' : ''}><summary>What’s new in ${escape(version)}</summary>
${release.previous ? `<p>Updated from ${escape(release.previous)} to ${escape(version)}.</p>` : ''}
<pre style="white-space:pre-wrap">${escape(release.notes || 'No release notes bundled for this version.')}</pre></details>`
    : ''
}
</main>
<script>
(() => {
  const token = new URL(location.href).searchParams.get('token') || '';
  const button = document.getElementById('check');
  const note = document.getElementById('note');
  let leaving = false;
  // The chat takes this page's place on the same address: load it once it answers.
  const arrived = async () => {
    try {
      const page = await fetch(location.href, { cache: 'no-store' });
      return page.ok && !(await page.text()).includes('id="welcome"');
    } catch {
      return false;
    }
  };
  const leave = async () => {
    leaving = true;
    button.disabled = true;
    note.textContent = 'Found one. Starting the chat…';
    while (!(await arrived())) await new Promise((done) => setTimeout(done, 500));
    location.reload();
  };
  const check = async (asked) => {
    if (leaving) return;
    try {
      const reply = await fetch('/api/agents', { method: 'POST', headers: { 'x-genaicode-token': token } });
      if (!reply.ok) throw new Error(String(reply.status));
      const agents = (await reply.json()).agents;
      for (const agent of agents) {
        const row = document.querySelector('li[data-command="' + agent.command + '"]');
        if (!row) continue;
        row.classList.toggle('ok', agent.installed);
        row.querySelector('.state').textContent = agent.installed ? 'found' : 'not found';
      }
      if (agents.some((agent) => agent.installed)) return leave();
      if (asked) note.textContent = 'Still none. If you just installed one, quit genaicode and open it again: a new command may need a fresh start to be seen.';
    } catch {
      // The chat may already have taken this page's place.
      if (!leaving && (await arrived())) location.reload();
    }
  };
  button.addEventListener('click', () => check(true));
  setInterval(() => check(false), 4000);
})();
</script>
</body>
</html>`;
}

/**
 * What `genaicode ui` serves while no agent CLI is installed: which agents it could use and how
 * to get one. It answers on the link the chat will use, so the page moves on by reloading.
 */
export async function startWelcome(options: WelcomeOptions): Promise<Welcome> {
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? randomBytes(32).toString('hex');
  let port = 0;
  let foundOne!: () => void;
  const found = new Promise<void>((resolve) => (foundOne = resolve));
  const look = () => welcomeAgents(options.agents, options.env);
  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(body);
  };
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`];
    if (!req.headers.host || !allowed.includes(req.headers.host)) return send(res, 403, 'text/plain', 'Forbidden host');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const asset = options.assets?.get(url.pathname.slice('/assets/'.length));
      return asset ? send(res, 200, asset.type, asset.body) : send(res, 404, 'text/plain', 'Not found');
    }
    if (req.method === 'GET' && url.pathname === '/') {
      if (!secretOk(url.searchParams.get('token'), token))
        return send(res, 403, 'text/plain', 'Open the link genaicode printed in your terminal (it carries a token).');
      return send(res, 200, 'text/html; charset=utf-8', welcomeHtml(options.version, look(), options.release?.()));
    }
    if (req.method === 'POST' && url.pathname === '/api/agents') {
      const header = req.headers['x-genaicode-token'];
      if (typeof header !== 'string' || !secretOk(header, token)) return send(res, 403, 'text/plain', 'Bad token');
      const agents = look().map(({ command, installed }) => ({ command, installed }));
      send(res, 200, 'application/json', JSON.stringify({ agents }));
      if (agents.some((agent) => agent.installed)) foundOne();
      return;
    }
    return send(res, 404, 'text/plain', 'Not found');
  };
  const server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  return {
    url: `http://${shown}:${port}/?token=${token}`,
    token,
    port,
    found,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
