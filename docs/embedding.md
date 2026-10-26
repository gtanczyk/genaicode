# Embedding genaicode outside the web

[← README](../README.md)

genaicode runs coding agents on the developer's machine. Web apps get the [Vite panel](./vite.md),
[`createDevOverlay`](./vite.md) or [`<AppAgentChat>`](./app-agent.md). This page is for every other
host: desktop apps, game editors, terminal tools and programs that are not written in JavaScript.
It is about development tools: the agent CLIs, their logins and Node 20+ come from the developer's
machine, so none of this belongs in an app you ship to end users.

| Host                                   | What to use                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Electron                               | `genaicode/agents` in the main process, the chat in a window ([below](#electron))                             |
| Any webview (Tauri, WebView2, Qt, CEF) | a small Node script with `startEmbeddedWeb`, its URL in the webview ([below](#a-webview-in-another-language)) |
| Any language, a whole conversation     | `genaicode acp`: the Agent Client Protocol on stdin/stdout ([below](#any-language-the-agent-client-protocol)) |
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

## Any language: the Agent Client Protocol

`genaicode acp` speaks the [Agent Client Protocol](https://agentclientprotocol.com) (ACP,
version 1): JSON-RPC 2.0, one message per line, on stdin and stdout. Editors that support ACP
(Zed, JetBrains IDEs and others) can run it as an agent as it is, and a host in any language can
drive it with an ACP client library (TypeScript, Python, Rust, Kotlin...) or a few lines of JSON.

```bash
npx genaicode acp                 # the first installed agent
npx genaicode acp -a codex -y     # start with Codex, approving every permission request
```

The host starts the process and then:

1. `initialize` with `protocolVersion: 1`.
2. `session/new` with `cwd` (the project) and `mcpServers` (HTTP or stdio servers the agent should
   use, e.g. the app's own tools). The reply lists the session's config options.
3. `session/prompt` with the user's text (also `resource_link` and embedded `resource` blocks).
   While the agent works, the host gets `session/update` notifications: `agent_message_chunk`,
   `tool_call` and `tool_call_update` (with `kind`, a title such as `Bash: npm test`, and the
   file in `locations`). The reply comes when the turn ends: `stopReason: "end_turn"`, or
   `"cancelled"` after a `session/cancel`; a failed run is a JSON-RPC error with the agent's
   message.
4. When the agent asks for permission, genaicode sends `session/request_permission` with the
   options `approve` and `deny`; the host answers with the one the user picked.

Each prompt continues the agent's own session, so the conversation carries on. The config
options switch, between prompts, `agent` (one of the installed agent CLIs; the next agent starts
a new conversation), `effort` (when the agent has levels) and `mode` (`ask` or `auto-approve`)
through `session/set_config_option`. `session/close` stops a session.

A complete exchange, one JSON object per line (`>` sent by the host, `<` by genaicode):

```text
> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}
< {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"genaicode",...},...}}
> {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/work/game","mcpServers":[]}}
< {"jsonrpc":"2.0","id":2,"result":{"sessionId":"5b1c...","configOptions":[...]}}
> {"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"5b1c...","prompt":[{"type":"text","text":"Fix the bug in math.js"}]}}
< {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"5b1c...","update":{"sessionUpdate":"tool_call","toolCallId":"toolu_01...","title":"Read: /work/game/math.js","kind":"read","status":"in_progress",...}}}
< {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"5b1c...","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Fixed: add now adds."},...}}}
< {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```

[examples/godot](examples/godot/README.md) is a complete host: a Godot editor dock that chats
with the agent over ACP in GDScript, and a game that serves its own MCP tools so the agent can
play it.

With an agent that cannot resume (gemini, antigravity) each prompt starts a fresh agent session.
A session with MCP servers offers only the agents that can attach them (claude, codex, copilot).
Not supported yet: `session/load` and `session/resume` (sessions live as long as the process),
images in prompts, SSE MCP servers, and the client's file system and terminal methods (the agent
CLI reads, writes and runs commands itself).

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

This is one-way (use `genaicode acp` for a conversation): the agent cannot ask the host for a permission, so steps that need one are
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

The [Godot example](examples/godot/README.md) does this from GDScript: the running game serves
`game_observe`, `game_take_control`, `game_act` and `game_release_control` on 127.0.0.1, and the
editor dock passes that server to `genaicode acp` in `session/new`.

The agent's CLI may ask before it calls a tool of a new server; answer in the chat, or allow the
server in the agent's own settings. Keep each action short and bounded, and show in the app when
the agent has the controls.
