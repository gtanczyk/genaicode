# Embedding genaicode outside the web

[← README](../README.md)

genaicode runs coding agents on the developer's machine. Web apps get the [Vite panel](./vite.md),
[`createDevOverlay`](./vite.md) or [`<AppAgentChat>`](./app-agent.md). This page is for every other
host: desktop apps, game editors, terminal tools and programs that are not written in JavaScript.
It is about development tools: the agent CLIs, their logins and Node 20+ come from the developer's
machine, so none of this belongs in an app you ship to end users.

| Host                                   | What to use today                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Electron                               | `genaicode/agents` in the main process, the chat in a window ([below](#electron))                             |
| Any webview (Tauri, WebView2, Qt, CEF) | a small Node script with `startEmbeddedWeb`, its URL in the webview ([below](#a-webview-in-another-language)) |
| Any language, one prompt at a time     | `genaicode run --json` as a child process ([below](#any-language-one-prompt-at-a-time))                       |
| An app the agent should act on         | the app's tools over MCP ([below](#let-the-agent-act-on-the-app))                                             |

## Electron

The main process is Node, so the whole API is there. Either show the bundled chat in a window:

```ts
// main.ts
import { app, BrowserWindow } from 'electron';
import { startEmbeddedWeb } from 'genaicode/ui';

app.whenReady().then(async () => {
  const web = await startEmbeddedWeb({ cwd: projectDir });
  const win = new BrowserWindow({ width: 480, height: 800 });
  await win.loadURL(web.url); // 127.0.0.1 with its access token: keep it out of logs
  app.on('before-quit', () => void web.close());
});
```

`web.controller` lets the app drive the same session: `submit()` a prompt, `note()` a line into
the transcript, `approve()` a pending request.

Or draw the chat in your own renderer: run `createAppAgent` and `createAppAgentHandler` in the
main process on 127.0.0.1 and put `<AppAgentChat>` in the renderer ([app-agent.md](./app-agent.md)),
or build on `createAgentSession` and `<AgentChat>` ([react.md](./react.md)).

## A webview in another language

A Tauri, .NET or Qt app can show the same chat. Start it from a short Node script next to the app
and read its URL from stdout:

```js
// genaicode-panel.mjs, started by the app with: node genaicode-panel.mjs <project dir>
import { startEmbeddedWeb } from 'genaicode/ui';

const web = await startEmbeddedWeb({ cwd: process.argv[2] });
process.stdout.write(JSON.stringify({ url: web.url }) + '\n');
process.stdin.on('end', () => web.close().then(() => process.exit(0))); // the app went away
process.stdin.resume();
```

The app opens `url` in its webview (top level, not in an iframe: framing needs `frameAncestors`).
Treat the URL as a secret; it carries the access token.

## Any language, one prompt at a time

`genaicode run --json` reads the prompt from stdin (`-`) and prints one JSON `AgentEvent` per line:
`session`, `text-delta`, `message`, `tool-start`, `tool-end`, `file-change`, `usage`, `error`,
then `done` with the result ([agents.md](./agents.md)). Pass `--resume <sessionId>` from the
`session` event to continue the conversation on the next prompt.

```python
import json, subprocess

proc = subprocess.Popen(
    ["npx", "genaicode", "run", "--json", "-a", "claude", "-C", project_dir, "-"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
)
proc.stdin.write("Fix the failing test in test_physics.py")
proc.stdin.close()
for line in proc.stdout:
    event = json.loads(line)
    if event["type"] == "text-delta":
        print(event["text"], end="")
    elif event["type"] == "done":
        session_id = event["result"].get("sessionId")
```

This is one-way: the agent cannot ask the host for a permission, so steps that need one are
declined unless you pass `--yes` (approve everything). Stop a run by ending the process.

## Let the agent act on the app

The agent can do more than edit code: it can use the app, for example play a level in a game and
look at the frames. The app serves tools over MCP and the agent calls them. In a Node host,
`genaicode/app-agent` does this with approval cards and a chat ([app-agent.md](./app-agent.md),
including [a game the agent plays](./app-agent.md#the-agent-drives-the-app-a-game)).

An app in another language serves the tools from its own MCP server (there is an MCP SDK for
most languages) and hands it to the agent through `AgentTask.mcpServers`, e.g. from the Node
script above:

```js
const web = await startEmbeddedWeb({
  cwd: process.argv[2],
  task: { mcpServers: [{ name: 'game', url: 'http://127.0.0.1:7777/mcp' }] },
});
```

The agent's CLI may ask before it calls a tool of a new server; answer in the chat, or allow the
server in the agent's own settings. Keep each action short and bounded, and show in the app when
the agent has the controls.
