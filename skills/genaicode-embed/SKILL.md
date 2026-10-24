---
name: genaicode-embed
description: Embed genaicode in a project so its developers chat with their own coding agent (Claude Code, Codex, Copilot...) from inside the running app. Use when asked to add genaicode, its Vite overlay, a dev agent panel, or an in-app agent drawer (genaicode/app-agent) to a project, with or without Vite.
---

# Embed genaicode in this project

genaicode (npm package `genaicode`, Apache-2.0) drives the coding-agent CLIs a developer
already has installed (Claude Code, Codex, Copilot CLI, Cursor, Gemini, opencode...) behind
one API. Your job is to wire it into the project in the current directory so the
project's developers can talk to their agent from inside the running app.

There are four ways in, plus a last resort. Pick by what the project is, not by what is
more impressive. Always end with a working way in: "it doesn't fit" is not a result while
the project has HTML pages a browser can open.

1. **Vite dev overlay** (`genaicode/vite`): for any app built with Vite. One plugin line;
   in `vite dev` the page gets a wolf button that opens a chat with the agent working in
   the project root, and the page's errors can be sent to the agent with one click.
   Builds are untouched, nothing reaches production.
2. **Dev panel without Vite** (`genaicode/ui`): the same chat for apps on webpack, Next.js,
   Express, Fastify, Remix, Astro or any other Node dev server. The dev server process
   starts the chat on 127.0.0.1 with `startEmbeddedWeb`, and a development-only component
   on the page shows it in a frame. A few more lines than the plugin, same result.
3. **In-app agent** (`genaicode/app-agent` on the server, `<AppAgentChat>` from
   `genaicode/react` on the page): for a local app with its own Node server (an admin
   console, an internal tool, an editor) whose users want the agent to act on the app's
   data. The agent works the app through tools the app serves over MCP, every write waits
   for the user's Approve, and an optional `dev` mode lets the agent edit the app's own
   code and propose a commit.
4. **A dev server of your own**: the project has pages but nothing serves them in
   development (static HTML, files opened from `file://`, a build script that writes
   `index.html`, a game jam entry with a size budget...). Write a small Node script that
   serves those files on localhost and injects the panel into the HTML it serves, and an
   npm script to start it. The files on disk and the build output stay untouched, so size
   budgets and release builds are not affected.
5. **Last resort**: no Node at all in the project and no HTML to serve (a Rails, Django or
   Go app whose server you cannot change safely): tell the user to run `npx genaicode ui`
   (browser) or `npx genaicode` (terminal) next to their dev server, and say why.

The agent CLI always runs on the machine that runs the server, with that machine's
login and files. Options 1, 2 and 4 exist only in development. The in-app agent is for apps
that run on the developer's own machine (or a trusted internal host behind real auth).
Never wire any of them into a public production site, and never expose them without auth.

Work with as few shell commands as you can: the user approves each one unless they turned
on auto-approve. Read files instead of listing them through the shell where your tools
allow, batch what must run into few commands, and do not run the dev server just to look.

## Steps

1. **Look before you change anything.** Read `package.json` (dependencies, scripts,
   `workspaces`), the lockfile, the build and dev server config (`vite.config.*`,
   `next.config.*`, `webpack.config.*`...), the server entry if there is one, and the root
   component of the UI. Find out what actually serves the app in development. In a
   monorepo, work in the package that owns the app; ask if that is unclear.
2. **Choose the integration** (the user's request may already say which):
   - Vite serves the app in development (React, Vue, Svelte, Solid, Preact, vanilla, also
     Vite in front of a backend, Remix/React Router/Astro/SvelteKit on Vite): option 1.
   - Another Node dev server: option 2.
   - The user wants the agent to use the app itself (its data, its actions), or the app
     is an internal tool with a Node server and a React UI: option 3, alone or next to
     option 1 or 2.
   - Pages but no dev server: option 4.
   - Otherwise: option 5. Say why.
   - If genaicode is already wired in, extend or fix what is there instead of adding a
     second copy.
3. **Install** `genaicode` as a dev dependency for options 1, 2 and 4, as a regular
   dependency when the server imports `genaicode/app-agent`. Use the project's package
   manager (lockfile: `package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn,
   `bun.lockb`/`bun.lock` bun). If you may not run the install, add the dependency to
   `package.json` with the version from your task and tell the user to run it. genaicode
   needs Node 20+ and declares no React peer: the app brings React 18+ for
   `genaicode/react`.
4. **Wire it in** (recipes below), matching the project's style: TypeScript or
   JavaScript, ESM or CJS, its formatter, its folder layout.
5. **Check it**: run the project's type check, lint and tests if it has them, and a
   production build. For options 1, 2 and 4 the production output must not contain
   genaicode. Fix what you broke; do not "fix" unrelated failures. Remove build output
   you created that the project does not track.
6. **Report**, starting with how to see it, before anything else: one line with the exact
   command to run and what happens next, e.g. "Run `npm run agent`: the game opens in your
   browser with an Agent button in the bottom-right corner." The developer may not know
   the project's scripts or that a new one exists, so never leave this for the end of a
   long summary. Then what you changed, file by file, briefly. Say that the agent uses its
   own CLI login and billing.

## Recipe: Vite overlay

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import genaicode from 'genaicode/vite';

export default defineConfig({
  plugins: [
    // ...the project's plugins stay as they are
    genaicode(),
  ],
});
```

- Add it to the existing `plugins` array; keep everything else. With a config function
  (`defineConfig(({ mode }) => ...)`) it goes in the returned object the same way.
- A `vite.config.js` in a CommonJS package (no `"type": "module"`) still uses `import`:
  Vite bundles the config. genaicode is ESM only (`require('genaicode/vite')` fails), so a
  `vite.config.cjs` loads it with a dynamic import from an async config:
  `module.exports = async () => ({ plugins: [react(), (await import('genaicode/vite')).default()] })`,
  keeping the rest of the existing config in that object.
- Options, all optional: `agent` (e.g. `'claude'`, `'codex'`; default: first installed),
  `model`, `effort`, `approveAll` (skip the agent's permission prompts; only if asked),
  `port`, `captureErrors: false`. Leave the defaults unless the user asked.
- The chat runs on its own 127.0.0.1 port, only the app's own pages can frame it, and it
  takes requests only from the same machine. No env vars or secrets are needed.

## Recipe: dev panel without Vite

Server side, in the Node process that serves the app in development, and only there:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

// Development only: production never imports genaicode.
// The origins the app was opened at; the chat lets only these frame it, read per request.
const origins = new Set<string>();
let panel: Promise<{ url: string }> | undefined;
export function genaicodePanel() {
  panel ??= import('genaicode/ui').then(({ startEmbeddedWeb }) =>
    startEmbeddedWeb({ cwd: process.cwd(), frameAncestors: () => [...origins] }),
  );
  return panel;
}

// GET /__genaicode/session -> { url }. The url carries the chat's access token: hand it only
// to the app's own pages on this machine.
export async function genaicodeSession(req: IncomingMessage, res: ServerResponse) {
  const address = req.socket.remoteAddress ?? '';
  const local = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
  const host = req.headers.host ?? '';
  const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!local || !loopbackHost || req.headers['sec-fetch-site'] !== 'same-origin') {
    res.writeHead(403).end();
    return;
  }
  origins.add(`http://${host}`); // localhost and 127.0.0.1 can both frame it, without a restart
  const { url } = await genaicodePanel();
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ url }));
}
```

- `frameAncestors` is read per request and must list every origin the app is opened at in
  development (`http://localhost:3000`, `http://127.0.0.1:3000`...); the chat refuses other
  frames. Collect them as above rather than capturing the first one. Behind a dev host name
  (`app.localhost`, https), allow that name explicitly.
  `startEmbeddedWeb` binds to 127.0.0.1 on a free port (`port` to fix one) and takes
  `agent`, `model`, `effort`, `approveAll` like the Vite plugin.
- Start it once per process. Dev servers that reload server code (Next.js, nodemon...)
  re-run modules: keep the promise on `globalThis` so a reload does not start a second chat.
- Where to hook the route:
  - Express / Connect / node:http dev server: before the app's routes, behind
    `process.env.NODE_ENV !== 'production'`.
  - webpack-dev-server: `devServer.setupMiddlewares(middlewares, devServer)`, push a
    middleware for `/__genaicode/session`.
  - Next.js: a route handler such as `app/api/genaicode/route.ts` (folders starting with
    `_` are private in the app router) that returns 404 unless
    `process.env.NODE_ENV === 'development'`. It has no socket address, so check that the
    `Host` header is `localhost` / `127.0.0.1` / `[::1]` with a port and that
    `sec-fetch-site` is `same-origin`. Start the chat from the route on first use (Node
    runtime: `export const runtime = 'nodejs'`), cached on `globalThis`.
  - Fastify: a route under `if (dev)`; Koa: a middleware under `if (dev)`.

Page side, a component rendered only in development (`process.env.NODE_ENV === 'development'`,
`import.meta.env.DEV`...), loaded so the production bundle drops it (a dynamic `import()`
behind that check, or the framework's dev-only slot):

```tsx
import { useEffect, useState } from 'react';

export function GenaicodePanel() {
  const [url, setUrl] = useState<string>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    fetch('/__genaicode/session')
      .then((r) => (r.ok ? r.json() : undefined))
      .then((s) => setUrl(s?.url));
  }, []);
  if (!url) return null;
  return (
    <>
      <button onClick={() => setOpen(!open)} style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 2147483647 }}>
        Agent
      </button>
      {open && (
        <iframe
          src={url}
          title="genaicode"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 64,
            width: 420,
            height: '70vh',
            zIndex: 2147483647,
            border: 0,
            borderRadius: 12,
            boxShadow: '0 8px 32px #0004',
          }}
        />
      )}
    </>
  );
}
```

Not React? The same in the app's own framework or plain DOM: fetch the session, then a
fixed button that toggles a fixed iframe. Keep the token URL out of logs, `localStorage`
and anything the page sends elsewhere.

## Recipe: a dev server of your own

For a project with pages but no dev server. One file, e.g. `tools/agent-dev.mjs` (match the
project's folder for scripts), plus `"agent": "node tools/agent-dev.mjs"` (or a name that
fits next to the existing scripts) in `package.json`:

```js
// Development only: serves <dir> on 127.0.0.1 with the genaicode panel injected into HTML.
// The files on disk are not changed.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { startEmbeddedWeb } from 'genaicode/ui';

const root = resolve(process.argv[2] ?? 'build');
const port = Number(process.env.PORT ?? 5173);
const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
const chat = await startEmbeddedWeb({ cwd: process.cwd(), frameAncestors: () => [...origins] });
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};
const PANEL = `<script type="module" src="/__genaicode/panel.js"></script>`;

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/__genaicode/session') {
    // The token: only this machine (a loopback Host, which stops DNS rebinding), only the
    // app's own pages.
    if (!origins.has(`http://${req.headers.host}`) || req.headers['sec-fetch-site'] !== 'same-origin') {
      return res.writeHead(403).end();
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ url: chat.url }));
  }
  if (url.pathname === '/__genaicode/panel.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(PANEL_SCRIPT);
  }
  let file;
  try {
    file = normalize(join(root, decodeURIComponent(url.pathname)));
  } catch {
    return res.writeHead(400).end();
  }
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
  const body = await readFile(file).catch(() => null);
  if (!body) return res.writeHead(404).end('not found');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'text/html' ? injectPanel(body.toString()) : body);
}).listen(port, '127.0.0.1', () => {
  const page = `http://localhost:${port}/`;
  console.log(`${page}  (genaicode panel: the button in the corner)`);
  // Open it like `vite --open` does; NO_OPEN=1 to skip.
  if (!process.env.NO_OPEN && !process.env.CI) {
    const opener = { darwin: 'open', win32: 'explorer' }[process.platform] ?? 'xdg-open';
    spawn(opener, [page], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  }
});

function injectPanel(html) {
  return html.includes('</body>') ? html.replace('</body>', `${PANEL}</body>`) : html + PANEL;
}
```

`PANEL_SCRIPT` is the page side as plain DOM, the same as the React component in the
recipe above: fetch `/__genaicode/session`, then a fixed button in a corner that toggles a
fixed iframe with `src` set to the session `url`. Keep it out of the app's own code.

- Listen on `127.0.0.1` only, and hand out the token only for a loopback `Host` and
  `Sec-Fetch-Site: same-origin`. Together they keep the token on this machine and away from
  other sites, including DNS-rebinding pages.
- Serve what the developer actually opens: the build output folder if the project builds
  one (start or chain its build or watch script when it has one, e.g. with `--watch` or a
  second process), otherwise the source folder with the HTML.
- Optional, for the agent to see what breaks: in `PANEL_SCRIPT`, collect `error` and
  `unhandledrejection` events and offer a "Fix N errors" button that POSTs them to a
  `/__genaicode/fix` route (same checks as the session route) which calls
  `chat.controller.submit('Fix these errors in the page …' + details)`.
- Open the browser on start (as above), at the page the developer works on when there is
  one obvious page (e.g. `/fireball/`), not a folder listing.
- A page that reloads itself on change (a watch build) is the developer's own; do not
  add a live-reload system for this.

## Recipe: in-app agent

Server side, wherever the Node server is created:

```ts
import { createAppAgent, createAppAgentHandler } from 'genaicode/app-agent';

const agent = createAppAgent({
  name: 'the shop admin', // how the agent calls the app
  mcpUrl: () => `http://127.0.0.1:${port}/api/agent/mcp`, // this server, reachable from this machine
  tools: [
    { name: 'orders', description: 'List open orders.', run: () => JSON.stringify(listOrders()) },
    {
      name: 'refund',
      description: 'Refund an order.',
      write: true, // shows Approve / Reject; runs only after Approve
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: ({ id }) => refund(String(id)),
    },
  ],
  pages: () => ['/', '/orders'], // optional: page context and "take me there" chips
  dev: { cwd: process.cwd(), commands: ['npm test'] }, // optional: agent may edit the app's code
});
const handleAgent = createAppAgentHandler(agent, {
  // Required as soon as the server listens beyond loopback: reuse the app's own auth check.
  // authorize: (req) => isAdmin(req),
});
```

Mount `handleAgent(req, res)` before the app's own routes; it returns `true` when it
answered (everything under `/api/agent`, or `basePath`):

- node:http: `if (await handleAgent(req, res)) return;` at the top of the request handler.
- Express / Connect: `app.use((req, res, next) => handleAgent(req, res).then((done) => done || next(), next));`
  (a JSON body parser before it is fine: it reads `req.body` when one is there).
- Fastify: an `onRequest` hook that calls `reply.hijack()` and `handleAgent(request.raw, reply.raw)`
  for URLs under the base path.
- Vite dev server with no backend: a small plugin whose `configureServer(server)` adds the
  same middleware to `server.middlewares`; build `mcpUrl` from the server's real port
  (`server.httpServer.address()`), not the configured one.
- Next.js pages router: `pages/api/agent/[...path].ts` with
  `export const config = { api: { bodyParser: false } }` calling `handleAgent(req, res)`.
  The app router has no Node `req`/`res`: use a custom server or the pages route.
- Call `handleAgent.close()` when the server shuts down.

Tools are the point of the in-app agent: expose a few read tools over the app's existing
data or services and, only where it makes sense, write tools with `write: true`. Reuse the
app's own functions; never hand the agent raw database or shell access through a tool. If
the app has nothing worth exposing yet, start with `pages` and one read tool, and tell the
user where to add more.

Page side, in the React tree (React 18+):

```tsx
import { AppAgentChat } from 'genaicode/react';
import 'genaicode/react/styles.css';

// Inside a fixed-height container: a drawer, a side panel, a route of its own.
<div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 420 }}>
  <AppAgentChat currentPath={location.pathname} onNavigate={(path) => navigate(path)} />
</div>;
```

- Use the app's router for `currentPath` and `onNavigate` (React Router `useLocation` /
  `useNavigate`, Next `useRouter`...). Without a router, `location.pathname` and
  `location.assign`.
- Put the drawer behind a toggle button that matches the app's UI, closed by default.
- Theme with `--gc-*` CSS custom properties (`--gc-bg`, `--gc-text`, `--gc-accent`,
  `--gc-font`...) or `theme="light" | "dark"`, to match the app.
- Not React? Use the HTTP routes directly: `GET /api/agent/events` (server-sent
  `AppAgentState`), `POST /api/agent/send {text}`, `/stop`, `/reset`, `/actions/:id`.

## Rules

- Keep changes small and in the project's own style. Do not restructure the app, upgrade
  unrelated dependencies, or reformat files you did not need to touch.
- Do not commit, push, or create branches unless the user asks.
- Do not add API keys, tokens or env vars: the agent CLI brings its own login.
- Do not turn on `approveAll` or the agents' "yolo" modes unless the user asks.
- These recipes are starting points, not templates to paste: adapt them to what the
  project already does. If something does not fit, say what and why instead of forcing it.
- Docs: https://github.com/gtanczyk/genaicode#readme
