# Agent inside your app (`genaicode/app-agent`)

[← README](../README.md)

`genaicode/app-agent` puts an agent in a local app you run on your machine (an admin
console, an internal tool, a game editor). The user chats with an agent CLI they already
have; the agent works the app through tools the app serves over MCP, changes wait for the
user's approval, and in `dev` mode the agent also edits the app's code and proposes a commit.

```ts
import { createServer } from 'node:http';
import { createAppAgent, createAppAgentHandler } from 'genaicode/app-agent';

const agent = createAppAgent({
  name: 'the shop admin',
  mcpUrl: 'http://127.0.0.1:3000/api/agent/mcp',
  tools: [
    { name: 'orders', description: 'List open orders.', run: () => JSON.stringify(listOrders()) },
    {
      name: 'refund',
      description: 'Refund an order.',
      write: true, // a card with Approve and Reject; runs only after Approve
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: ({ id }) => refund(String(id)),
    },
  ],
  pages: () => ['/orders', '/customers'], // page context, link chips, "take me there"
  dev: { cwd: process.cwd(), commands: ['npm test'] }, // optional: the agent edits the app
});
const handle = createAppAgentHandler(agent, { authorize: (req) => isSignedIn(req) });

createServer(async (req, res) => {
  if (await handle(req, res)) return;
  // ...the rest of the app
}).listen(3000, '127.0.0.1');
```

On the page, `AppAgentChat` from `genaicode/react` is the whole drawer: the chat, the agent's
page chips under its replies, Approve and Reject cards (with the diff of a proposed commit),
and the agent and mode pickers. It reports `currentPath` to the agent and calls `onNavigate`
when a chip is clicked or the agent is asked to go somewhere.

```tsx
import { AppAgentChat } from 'genaicode/react';
import 'genaicode/react/styles.css';

<AppAgentChat currentPath={location.pathname} onNavigate={(path) => router.push(path)} />;
```

<p align="center">
  <img alt="A shop admin with the agent drawer: the agent proposed a refund, waiting for Approve." src="media/screenshots/app-agent.png" width="80%">
</p>

Under it, `/api/agent` serves `GET /events` (a stream of `AppAgentState`: the session, earlier
turns, pending actions, link chips, navigation requests) and `POST /send`, `/stop`, `/reset`,
`/config`, `/view`, `/actions/:id` and `/approvals/:id` (the agent CLI's own permission
prompts); `useAppAgent` wraps them for a page of your own. Switching agent or mode keeps the
conversation: the next agent gets a short transcript. `trace` receives every prompt, MCP call,
decision and finished turn, for a log. Default agents are Claude Code, Codex and
Copilot CLI, locked down per mode: in `use` mode they get only the app's tools (no shell, no
file edits); in `dev` mode they edit files and run the listed commands, never commit or push (Claude and
Copilot enforce the command list; Codex has no per-command allowlist, so it runs in its
`workspace-write` sandbox: writes only inside `cwd`, no network).
`propose_commit` snapshots the worktree, the user reviews that diff, and Approve commits
exactly that tree on the reviewed HEAD, or refuses if the files or HEAD changed since, a hook
changed the files, or a merge or rebase is in progress. The repository's commit hooks run. An app that delivers the
edits itself (syncs the files, uploads them) passes `dev.commit: false`, so the agent gets no
`propose_commit`, and `dev.only: true` when there is nothing to do in `use` mode.
The agent sees no MCP server but the app's: Claude runs with `--strict-mcp-config`, and Codex
and Copilot get the user's own configured servers switched off. The MCP endpoint takes a per-run
bearer and refuses browser requests; every other route asks `authorize` and refuses
cross-site requests. Without `authorize` only a loopback `Host` is accepted (add names with
`allowedHosts`), so a DNS-rebinding page cannot reach the agent.
