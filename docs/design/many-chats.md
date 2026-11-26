# Several chats at once

The desktop app and `genaicode ui` can run several conversations on one server. A window selects a chat through `#chat=<id>`. Closing a tab or opening another chat leaves its lead, workers and approvals under the server's control. See the [CLI reference](../cli.md) and [desktop app guide](../../src/desktop/README.md).

## Ownership and navigation

`ChatHub` in `src/ui/hub.ts` owns a controller and agent session for each loaded chat. The UUID in `ConversationMeta.id` identifies the chat throughout changes of agent, model and working directory. A native CLI session may acquire an ID only after the first prompt. Until then, even two empty chats in one directory have distinct rows.

Opening a chat from the sidebar or Search changes the requesting window. Other windows keep their own selections. Opening a native session already owned by a chat selects that chat. The hub serializes ownership lookups so two simultaneous requests for the same session cannot create two leads. Per-window request numbers handle a folder lookup that completes after the user chooses something else. The generation checks introduced for issue #354 still protect older single-controller clients.

In the browser, `/clear` and the New chat shortcut open a fresh chat. `/new` starts a fresh agent session within the chat and keeps the transcript. The terminal attached to `genaicode ui` controls the initial chat. The terminal `chat` command with `/web` and the embedded controller used by the Vite overlay continue to expose the host's one session.

## Scheduling and isolation

The default is four active lead turns. Settings → General and `--max-chats` accept limits from one through eight. Lowering the limit lets current turns finish. A new prompt beyond the limit waits in a FIFO queue. Additional prompts for that chat stay with its entry. Cancel returns the queued text to the composer. Running chats retain their own steering and follow-up queues. A shell command or standalone review does not consume a lead slot.

Each chat has its own pack, task IDs, worktree namespace and per-pack parallel limit. The packs share eight worker slots. Delegation and resumed work wait for global capacity with a bounded wait. Review and Verify requested on a task card report a capacity error immediately. Worktree registration, removal and patch application serialize per repository. Two leads may work directly in the same directory. The UI warns when another chat is already working there.

Each controller owns its approvals, auto-approval, session-send consent, allowed file roots, uploads, artifacts and MCP capabilities. Transport listeners can be shared while tool calls route through the issuing chat's capability. Concurrent sends to one recipient share ordering across chats. Artifact stores share a total byte cap. A file link uses a capability for the individual file. The settings, agent inspector, tower inbox and bark preference are shared across the UI server.

## Commands, events and attention

A window opens one authenticated SSE connection to `GET /api/events?chat=<id>`. It receives the selected controller's full view and lightweight chat summaries for the sidebar and Needs you. Reconnecting to a saved chat loads it on demand. The desktop stream additionally receives session selections made in the native menu.

File lookup, uploads, transcript export and state-changing commands are scoped to the selected chat. `POST /api/command` accepts the chat ID in the query or JSON body. Conflicting IDs are refused. An `open` command selects a home, topic, project or stored session and returns its chat ID. The earlier switch commands use the same routing. A `close` command releases an eligible idle controller. The initial controller remains available to the terminal and to unscoped clients.

The sidebar shows waiting and running chats, outstanding questions, completion and errors. A background chat can be stopped from its row. Needs you can answer an approval or question in place, using the originating chat and turn even if two chats issued the same request ID. Background completions and requests produce a named toast. A hidden window can use system notifications when permission has already been granted. Draft text and selected files stay in that browser window when moving between chats.

## Shutdown and recovery

A controller with an open stream, active lead, queued prompt, approval, shell, active pack check or unmerged worktree stays loaded. Other background controllers have a 30-second reconnect grace period. The hub unloads them after ten minutes, or earlier when more than twelve eligible idle controllers accumulate.

The desktop shell queries `GET /api/chats?running=1` for a native quit confirmation. Closing the macOS window can leave the server in the menu bar. On shutdown the hub stops chats concurrently and waits for their leads, shell process groups and pack workers. Pack shutdown preserves unmerged worktrees and their task records. Explicit discard retains its usual meaning.

A private directory under `$GENAICODE_HOME/ui-chats/<workspace-hash>/` holds an atomically written JSON snapshot per chat and a `ui-chats.json` index. The workspace key includes the launch directory and home mode. Snapshots include transcripts, cumulative usage and cost, native session IDs and the records needed to reopen pack cards. The desktop uses `--restore` to select the previous chat. Interrupted turns require a new prompt. A recovered card operates on the original worktree and uses the same merge checks as before shutdown.

Budgets apply per chat. The server does not start agents when it reads a saved chat. Opening another desktop window and creating worktrees for independent lead chats remain separate features.
