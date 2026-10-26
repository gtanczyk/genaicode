---
name: genaicode-embed
description: Embed genaicode in a project so its developers chat with their own coding agent (Claude Code, Codex, Copilot...) from inside the running app, and optionally let the agent use the app itself (play a game, click through a flow). Use when asked to add genaicode, its Vite overlay, a dev agent panel, an in-app agent drawer (genaicode/app-agent), or an agent panel in a desktop app, a game engine editor (Godot, Unity...) or a non-JavaScript app (genaicode acp).
---

# Embed genaicode in this project

genaicode (npm package `genaicode`, Apache-2.0) drives the coding-agent CLIs a developer
already has installed (Claude Code, Codex, Copilot CLI, Cursor, Gemini, opencode...) behind
one API. Your job is to wire it into the project in the current directory so the
project's developers can talk to their agent from inside the running app.

There are five ways in, plus a last resort. Pick by what the project is, not by what is
more impressive. Always end with a working way in: "it doesn't fit" is not a result while
the project has HTML pages a browser can open or a UI you can add a panel to.

1. **Vite dev overlay** (`genaicode/vite`): for any app built with Vite. One plugin line;
   in `vite dev` the page gets a wolf button that opens a chat with the agent working in
   the project root, and the page's errors can be sent to the agent with one click.
   Builds are untouched, nothing reaches production.
2. **Dev overlay without Vite** (`createDevOverlay` from `genaicode/ui`): the same overlay
   (the wolf, the error badge, "Fix N errors") for apps on webpack, Next.js, Express,
   Fastify, Koa or any other Node dev server. The dev server mounts its routes, the page
   loads one script in development. A few more lines than the plugin, same result.
3. **In-app agent** (`genaicode/app-agent` on the server, `<AppAgentChat>` from
   `genaicode/react` on the page): for a local app with its own Node server (an admin
   console, an internal tool, an editor) whose users want the agent to act on the app's
   data. The agent works the app through tools the app serves over MCP, every write waits
   for the user's Approve, and an optional `dev` mode lets the agent edit the app's own
   code and propose a commit.
4. **A dev server of your own**: the project has pages but nothing serves them in
   development (static HTML, files opened from `file://`, a build script that writes
   `index.html`, a game jam entry with a size budget...). Write a small Node script that
   serves those files on localhost with the overlay from option 2 injected into the HTML
   it serves, and an npm script to start it. The files on disk and the build output stay
   untouched, so size budgets and release builds are not affected.
5. **Desktop app, game engine or another language** (`genaicode acp`): Electron, Tauri,
   .NET, Qt, a Godot or Unity editor plugin, a Python or Go tool. The app starts
   `npx genaicode acp` as a child process and talks the Agent Client Protocol (JSON-RPC on
   stdin/stdout) to it: a whole conversation with streaming, tool calls, permission questions
   and agent/effort pickers, from any language. Electron can also use `genaicode/ui` in its
   main process directly.
6. **Last resort**: nothing you can add a panel to (a Rails, Django or Go web app whose
   server you cannot change safely): tell the user to run `npx genaicode ui` (browser) or
   `npx genaicode` (terminal) next to their dev server, and say why.

Any of these can also **let the agent drive the app**: the app serves a few MCP tools
(observe, take control, act, release control) and the agent uses the running app the way a
person does, e.g. plays the game to test a change, reproduces a bug, walks through a flow.
Offer it when the app is a game or anything interactive; add it when the user asks for it.
See "Recipe: let the agent drive the app".

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
   - A desktop app, a game engine project (`project.godot`, a Unity `Assets/` folder...),
     or an app in another language with its own UI: option 5.
   - The user wants the agent to play the game or click through the app: add the tools from
     "Recipe: let the agent drive the app" to whichever option you chose.
   - Otherwise: option 6. Say why.
   - If genaicode is already wired in, extend or fix what is there instead of adding a
     second copy.
3. **Install** `genaicode` as a dev dependency for options 1, 2 and 4, as a regular
   dependency when the server imports `genaicode/app-agent`. Use the project's package
   manager (lockfile: `package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn,
   `bun.lockb`/`bun.lock` bun). If you may not run the install, add the dependency to
   `package.json` with the version from your task and tell the user to run it. genaicode
   needs Node 20+ and declares no React peer: the app brings React 18+ for
   `genaicode/react`. Option 5 outside Node installs nothing in the project: the app runs
   `npx -y genaicode@<version> acp` (the version from your task) and needs Node 20+ on the
   developer's machine.
4. **Wire it in** (recipes below), matching the project's style: TypeScript or
   JavaScript, ESM or CJS, its formatter, its folder layout.
5. **Check it**: run the project's type check, lint and tests if it has them, and a
   production build. For options 1, 2 and 4 the production output must not contain
   genaicode; for option 5 and the drive-the-app tools, release builds must not start
   `genaicode acp` or serve the tools. Fix what you broke; do not "fix" unrelated failures. Remove build output
   you created that the project does not track.
6. **Report**, starting with how to see it, before anything else: one line with the exact
   command to run and what happens next, e.g. "Run `npm run agent`: the game opens in your
   browser with the genaicode wolf in the bottom-right corner. You can also type
   `!npm run agent` right here." The developer may not know
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

## Recipe: dev overlay without Vite

`createDevOverlay()` from `genaicode/ui` is the Vite plugin's overlay for any Node dev
server: the genaicode wolf in the page's bottom-right corner opens the chat, its badge
counts the page's errors, and "Fix N errors" sends them to the agent. Do not write your own
button, panel or session route: use this.

Server side, in the Node process that serves the app in development, and only there:

```ts
// Development only: production never imports genaicode.
if (process.env.NODE_ENV !== 'production') {
  const { createDevOverlay } = await import('genaicode/ui');
  const overlay = createDevOverlay(); // the agent works in process.cwd(); `cwd` to change
  app.use(overlay.middleware); // before the app's own routes
}
```

- `overlay.handle(req, res)` answers everything under `/__genaicode/` and resolves to
  `false` for other URLs; `overlay.middleware` is the same for Express / Connect. Options:
  `cwd`, `agent`, `model`, `effort`, `approveAll` (only if asked), `port`,
  `captureErrors: false`, like the Vite plugin.
- The chat starts in the background on 127.0.0.1. Its token goes only to the app's own
  pages, on this machine, opened at `localhost`, `*.localhost`, `127.0.0.1` or `[::1]`.
  Without an agent CLI it logs why and the app runs on.
- Start it once per process. Dev servers that reload server code (Next.js, nodemon...)
  re-run modules: keep the overlay on `globalThis` so a reload does not start a second chat.
- Where to hook it:
  - Express / Connect: `app.use(overlay.middleware)` before the routes.
  - node:http: `if (await overlay.handle(req, res)) return;` at the top of the handler.
  - webpack-dev-server: `setupMiddlewares: (middlewares) => [{ name: 'genaicode', middleware: overlay.middleware }, ...middlewares]`.
  - Fastify: an `onRequest` hook that, for URLs under `/__genaicode/`, calls
    `reply.hijack()` and `overlay.handle(request.raw, reply.raw)`. Koa: a middleware that
    sets `ctx.respond = false` when `await overlay.handle(ctx.req, ctx.res)` is true.
  - Next.js: a rewrite in `next.config` from `/__genaicode/:path*` to
    `/api/genaicode/:path*` (development only), and a pages-router route
    `pages/api/genaicode/[...path].ts` with `export const config = { api: { bodyParser: false } }`
    that returns 404 outside development, sets
    `req.url = '/__genaicode/' + [req.query.path].flat().join('/')` and calls
    `overlay.handle(req, res)`.

Page side, the overlay script in development only:

- Where the server renders or serves the HTML: `overlay.injectHtml(html)`, or
  `overlay.script` (an inline error collector plus
  `<script type="module" src="/__genaicode/overlay.js"></script>`) at the top of the dev
  template's `<head>`.
- Otherwise, in the app's entry, behind the bundler's dev flag so production drops it:

  ```js
  if (process.env.NODE_ENV === 'development') {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/__genaicode/overlay.js';
    document.head.append(script);
  }
  ```

## Recipe: a dev server of your own

For a project with pages but no dev server. One file, e.g. `tools/agent-dev.mjs` (match the
project's folder for scripts), plus `"agent": "node tools/agent-dev.mjs"` (or a name that
fits next to the existing scripts) in `package.json`:

```js
// Development only: serves <dir> on 127.0.0.1 with the genaicode overlay injected into HTML.
// The files on disk are not changed.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createDevOverlay } from 'genaicode/ui';

const root = resolve(process.argv[2] ?? 'build');
const port = Number(process.env.PORT ?? 5173);
const overlay = createDevOverlay();
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

createServer(async (req, res) => {
  if (await overlay.handle(req, res)) return;
  let file;
  try {
    file = normalize(join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
  } catch {
    return res.writeHead(400).end();
  }
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
  const body = await readFile(file).catch(() => null);
  if (!body) return res.writeHead(404).end('not found');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'text/html' ? overlay.injectHtml(body.toString()) : body);
}).listen(port, '127.0.0.1', () => {
  const page = `http://localhost:${port}/`;
  console.log(`${page}  (genaicode: the wolf in the bottom-right corner)`);
  // Open it like `vite --open` does; NO_OPEN=1 to skip.
  if (!process.env.NO_OPEN && !process.env.CI) {
    const opener = { darwin: 'open', win32: 'explorer' }[process.platform] ?? 'xdg-open';
    spawn(opener, [page], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  }
});
```

- Listen on `127.0.0.1` only.
- Serve what the developer actually opens: the build output folder if the project builds
  one (start or chain its build or watch script when it has one, e.g. with `--watch` or a
  second process), otherwise the source folder with the HTML.
- Open the browser on start (as above), at the page the developer works on when there is
  one obvious page (e.g. `/fireball/`), not a folder listing.
- A page that reloads itself on change (a watch build) is the developer's own; do not
  add a live-reload system for this.

## Recipe: desktop, game engines, other languages (`genaicode acp`)

`genaicode acp` is a coding agent for the [Agent Client Protocol](https://agentclientprotocol.com)
(v1): newline-delimited JSON-RPC 2.0 on stdin/stdout. Zed and other ACP editors can use it as
is. In an app you write a small client:

1. Start `npx -y genaicode@<version> acp` (flags: `-a <agent>`, `-m <model>`, `--effort`,
   `-y` to skip permission prompts, only if asked) with the project as working directory.
   On Windows run it through `cmd.exe /c`. Read stdout without blocking the UI thread.
2. Send `initialize` `{protocolVersion: 1}`, then `session/new`
   `{cwd, mcpServers: [...]}`. Its result has `sessionId` and `configOptions` (agent, effort,
   approval mode): show them as pickers, change them with `session/set_config_option`.
3. Send `session/prompt` `{sessionId, prompt: [{type: 'text', text}]}`. While it runs,
   `session/update` notifications stream `agent_message_chunk` text, `tool_call` and
   `tool_call_update`; render them in the panel. The result has `stopReason`.
4. Answer `session/request_permission` requests (Allow / Reject in the panel) with
   `{outcome: {outcome: 'selected', optionId}}`; several can be open at once. Stop sends the
   `session/cancel` notification.
5. After a prompt, refresh what the host shows from disk (the agent edited files).

Put the panel where the host's developers work: an editor dock (Godot `EditorPlugin`, Unity
`EditorWindow`), a side window, a dev-only menu entry. Keep it out of release builds.
A complete GDScript client and editor dock: https://github.com/gtanczyk/genaicode/blob/master/docs/examples/godot
Electron: `startEmbeddedWeb` from `genaicode/ui` in the main process shows the bundled chat in
a `BrowserWindow` without any protocol code.

## Recipe: let the agent drive the app

In the running app (development builds only), serve four MCP tools on 127.0.0.1 and pass that
server to the agent: `mcpServers` in `session/new` for ACP, `tools` of `createAppAgent` for the
in-app agent, `task.mcpServers` elsewhere.

- `game_observe` (or `app_observe`): the state as JSON plus a small screenshot (a few hundred
  pixels wide) as an MCP image.
- `game_take_control`: the agent takes over. The app shows "Agent controls this game" with a
  Take back control button, and pauses between the agent's moves if it can.
- `game_act`: press keys or click, run a bounded number of frames (clamp, e.g. 1-120, in code,
  not only in the schema), return the new state. Fails until control is taken, and when the
  user took control back. One act at a time.
- `game_release_control`: give the controls back. Also release when the agent's turn ends
  or its client disconnects.

Listen on 127.0.0.1 only and refuse browser requests (an `Origin` header, a `Host` that is not
localhost) so a web page cannot drive the app. These tools are not writes, so they need no
approval card. Details and a TypeScript version: "The agent drives the app (a game)" in
https://github.com/gtanczyk/genaicode/blob/master/docs/app-agent.md; a GDScript server:
https://github.com/gtanczyk/genaicode/blob/master/docs/examples/godot/addons/genaicode/game_mcp.gd.
When you add this, the report says how to try it, e.g. "run the game, then ask the agent:
Play the game: take control and collect 3 stars."

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
- Docs: https://github.com/gtanczyk/genaicode#readme, outside the web:
  https://github.com/gtanczyk/genaicode/blob/master/docs/embedding.md
