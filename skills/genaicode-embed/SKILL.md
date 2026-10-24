---
name: genaicode-embed
description: Embed genaicode in a project so its developers chat with their own coding agent (Claude Code, Codex, Copilot...) from inside the running app. Use when asked to add genaicode, its Vite overlay, a dev agent panel, or an in-app agent drawer (genaicode/app-agent) to a project, with or without Vite.
---

# Embed genaicode in this project

genaicode (npm package `genaicode`, Apache-2.0) drives the coding-agent CLIs a developer
already has installed (Claude Code, Codex, Copilot CLI, Cursor, Gemini, opencode...) behind
one API. Your job is to wire it into the project in the current directory so the
project's developers can talk to their agent from inside the running app.

There are three ways in, plus a fallback. Pick by what the project is, not by what is
more impressive.

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
4. **Fallback**: no Node process to host it (a Rails, Django, Go or static-site project,
   or a stack you cannot change safely): tell the user to run `npx genaicode ui` (browser)
   or `npx genaicode` (terminal) in the project next to their dev server.

The agent CLI always runs on the machine that runs the server, with that machine's
login and files. Options 1 and 2 exist only in development. The in-app agent is for apps
that run on the developer's own machine (or a trusted internal host behind real auth).
Never wire any of them into a public production site, and never expose them without auth.

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
   - Otherwise: option 4. Say why.
   - If genaicode is already wired in, extend or fix what is there instead of adding a
     second copy.
3. **Install** `genaicode` as a dev dependency for options 1 and 2, as a regular
   dependency when the server imports `genaicode/app-agent`. Use the project's package
   manager (lockfile: `package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn,
   `bun.lockb`/`bun.lock` bun). If you may not run the install, add the dependency to
   `package.json` with the version from your task and tell the user to run it. genaicode
   needs Node 20+ and declares no React peer: the app brings React 18+ for
   `genaicode/react`.
4. **Wire it in** (recipes below), matching the project's style: TypeScript or
   JavaScript, ESM or CJS, its formatter, its folder layout.
5. **Check it**: run the project's type check, lint and tests if it has them, and a
   production build. For options 1 and 2 the production output must not contain
   genaicode. Fix what you broke; do not "fix" unrelated failures. Remove build output
   you created that the project does not track.
6. **Report**: what you changed, file by file, and how to try it (the dev command, where
   to click). Say that the agent uses its own CLI login and billing.

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
