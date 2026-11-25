# Several chats at once

Status: proposal, nothing built. It builds on [the desktop layout](./desktop-layout.md) and settles
issue #354.

## Why

`genaicode ui` holds one conversation per server: `createChatController` creates one
`createAgentSession`, and opening another chat (`switchChat`, `openHome`) calls `session.clear()`,
which is refused while a turn runs. The sidebar lists many chats, but only one can work. The person
wants to start a task in one chat, open another and start a second one, as in other coding-agent
apps.

```
┌ Sidebar ─────────────────┬ Top bar: Fix flaky upload test · genaicode ─────┬ Work panel ───┐
│ New chat            ⌘N   │                                                 │ (of the chat  │
│ Needs you            2   │  transcript of the chat shown                   │  shown)       │
│ genaicode                │                                                 │               │
│  ● Fix flaky upload test │                                                 │               │
│  ◆ Release notes    ask  ├─────────────────────────────────────────────────┤               │
│  ◌ Rename tower  waiting │ Mission strip (of the chat shown)               │               │
│  ✓ Layout cleanup   new  │ Composer                                        │               │
│ gamedev.pl               │                                                 │               │
│  ● Sprite import         │                                                 │               │
│ ──────────────────────── │                                                 │               │
│ 3 of 4 running           │                                                 │               │
└──────────────────────────┴─────────────────────────────────────────────────┴───────────────┘
```

## Model

**Recommendation: a controller per chat, owned by one hub.** A new `createChatHub` (`src/ui/hub.ts`)
keeps `Map<chatId, ChatController>`. The controller's state is already that of one conversation
(notices, auto-approve, `!command` shells, relay cards, `ConversationMeta`), so it stays as it is
and loses only the code that replaces one conversation with another. The alternative, many sessions
inside one controller, means threading a chat id through all 1,500 lines of it for the same result.

- **Chat id**: `ConversationMeta.id`, which every chat gets (today only in `--home` mode). It stays
  the same when the agent or the directory changes. `chatKey()` returns it.
- **Loaded** (what "open" means): the chat has a controller in the server process. A chat is loaded
  when a window shows it or when it has something alive: a running turn, queued prompts, a waiting
  approval or question, a running `!command`, a running pack task or a pack worktree not yet merged
  or discarded. Every other chat is only a row read from the stores, as today.
- **Shown**: which loaded chat a window displays. This is window state (`#chat=<id>` in the URL), not
  server state. Switching changes the view only; it never calls `session.clear()` and is never
  refused. A chat that is not shown keeps running.
- **What moves up to the hub**: agent detection and inspection (`updateAgents`), the tower inbox and
  its timer, the `sessions_send` gate, the bark setting, the run limit.
- `genaicode chat` (terminal) and `/web` use a hub with one chat and behave as today.

## Limits

- A chat **runs** while its lead turn or one of its pack tasks runs. Default: **4 chats running at
  once**; setting "Chats running at once" (1–8) in Settings › General and `--max-chats`.
- **Past the limit: queue, do not refuse.** The prompt is accepted and shown in the chat as
  "Waiting for a free slot · 2 ahead · Cancel"; the row gets the waiting glyph. It starts when a
  chat finishes, oldest first. A refusal would throw away what the person just typed. Steering a
  chat that already runs is not counted.
- **Worker processes.** Each chat's pack allows 4 parallel tasks, so 4 chats could run 20 agent
  processes. The hub gives every pack one shared counter (a new `PackOptions` slot source), default
  8 tasks in total; a `delegate` past it waits the way it does past `maxParallel` today.

## Lifecycle

| Event                        | Effect                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stop** (button, Esc)       | Stops the chat shown, never another. The sidebar row menu gets "Stop" for a background chat.                                                                                               |
| Close a browser tab          | Nothing stops; the server owns the chats.                                                                                                                                                  |
| Close the desktop window     | macOS: the app stays in the menu bar and the chats keep running. Linux (closing quits): as Quit.                                                                                           |
| Quit the app, Ctrl+C on `ui` | With chats running: "3 chats are working. Quit stops them." Then every chat is stopped and closed as one is today.                                                                         |
| Restart                      | Survive: the conversation records (`saveConversation`), the agents' own session files, pack worktrees on disk. Lost: running turns, queued prompts, open approvals, notices, auto-approve. |
| Idle                         | A loaded chat with nothing alive that no window has shown for 10 minutes is unloaded (`controller.close()`). At most 12 idle chats stay loaded, least recently shown first out.            |

- The hub writes the ids of loaded chats and whether each was running to
  `~/.genaicode/ui-chats.json`. After a restart those that were running show an "interrupted" glyph
  and a line "Stopped when the app quit. Continue?"; nothing resumes by itself.
- A chat with an unmerged pack worktree is never unloaded: its task cards live in the `pack()`
  instance, and `Pack.close()` removes worktrees.
- Budget: a loaded idle chat costs its transcript in memory and its channels (below). Agent CLIs run
  only during a turn. The work is bounded by the two limits above, the memory by the idle rule.

## Per-chat state

| State                                   | Today                                           | With many chats                                                                                                  |
| --------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Agent, model, effort, Plan mode         | `SessionState`                                  | Per chat, unchanged.                                                                                             |
| Approvals, questions                    | `session.approvals`                             | Per chat; the command names the chat.                                                                            |
| Auto-approve                            | per conversation, guarded by `generation`       | Per chat, guarded by the chat id. A new chat starts from `--yes`.                                                |
| Pack tasks and worktrees                | one `pack()` in `agents`, tasks "over all runs" | One `pack()` per chat: the hub takes `agentsFor(chatId)` instead of `agents`. Worktree names are already unique. |
| `ask_user`, progress, `open_project`    | one channel each, `bind()` takes one handler    | One set per loaded chat, opened at its first turn and closed on unload.                                          |
| Artifacts                               | one store, `/artifacts/<id>`                    | One store per chat, `/artifacts/<chat>/<id>`.                                                                    |
| Uploads                                 | `createUploads(() => cwd of the session)`       | Keyed by chat; `POST /api/upload?chat=`.                                                                         |
| Budget (`--budget`)                     | per session                                     | Per chat. An app-wide cap is an open question.                                                                   |
| `!command` shells, notices, relay cards | controller                                      | Per chat, unchanged. A running shell keeps its chat loaded.                                                      |
| Transcript copy and save                | the open chat                                   | `chat=` on `/api/transcript` and `/api/save-transcript`.                                                         |
| Bark, theme, sidebar and panel widths   | app or window                                   | Unchanged.                                                                                                       |

The work panel, the mission strip, the top bar and the composer render the chat shown and nothing
else. Panel memory is already per chat. A draft typed in the composer stays with its chat in the
window.

**Two chats in one folder.** Two leads editing the same files will collide. When a chat starts a
turn in a directory where another loaded chat runs, the composer says "Another chat is working in
this folder" and offers the worktree choice the new chat's project line already has. It does not
refuse.

## Cross-chat surfaces

- **Sidebar glyphs.** `liveGlyph()` is used for every loaded chat, not only the open one: `run`,
  `ask`, `err`, `ok`, `idle`. One new glyph, `wait` (queued for a slot or interrupted). A chat that
  finished or failed while not shown keeps a bold title until it is shown. The footer says
  "3 of 4 running" while the limit matters.
- **Needs you.** Approvals and questions of background chats are items with the chat's title and are
  answered in place (`needs-you.ts` already has the `app` source); answering does not switch the
  view. The count on the sidebar and the mission strip's "next approval" stay as designed: the strip
  is about the chat shown, the sidebar about all.
- **Notifications.** The bark and the system notification fire for any loaded chat that asks or
  finishes while it is not shown or the window is hidden, and name the chat; a click shows it. A
  toast "Done: Release notes" appears when the window is visible.
- **Search (⌘K).** Same data. Opening a result is a view switch, so it always works; loaded chats
  come first with their glyph.
- **Tower.** One inbox on the hub. A decision that sends a prompt (`send`, `approve`) goes to the
  chat shown in the window where it was pressed. The desktop menu-bar tower reads
  `sessions --waiting` and needs no change.

## Server and API

- **Every chat command carries `chat`** (`submit`, `stop`, `approve`, `answer`, `pack-task`,
  `agent`, `model`, `auto`, `tower`). The server finds the controller by id; an id that is not
  loaded answers 409 `{ reason: 'conversation' }`. `generation`, the optional `conversation` fields
  and the server's per-window switch order (`lastOrder`, `switchSeq`) are removed.
- **Opening** replaces switching: `{ type: 'open', target }` with the targets of today (home,
  project, topic, continue) answers `{ ok, chat }`, and only the window that asked shows it.
  `{ type: 'close', chat }` unloads an idle chat. `takeover` (`/continue <id>`) still joins the chat
  it was typed in.
- **This settles #354.** (1) `/new` opens a new chat for its window and resets nothing, so it cannot
  clear a chat another window resumed. (2) A slow folder lookup ends in an `open` whose result only
  its own window shows; the window drops it if the person moved on, with the per-window counter it
  already has. (3) Approve, Deny and Auto-approve name their chat.
- **SSE: one multiplexed stream per window**, `GET /api/events?chat=<id>`. Browsers allow about six
  HTTP/1.1 connections per origin, so a stream per chat is out. Events: `chats` (a summary of every
  loaded chat: id, title, directory, glyph, task counts, waiting approvals, queue position), `view`
  (the full `ChatView` of the chat shown, now with its id), and `config`, `toast`, `release` as
  today. A window that shows another chat reconnects with the new id; views are snapshots, so
  nothing is lost. Background chats send summaries only, never transcripts.
- **`genaicode/react`**: `AgentChat`, `WorkPanel` and the mission strip take one session's state and
  do not change. The hub, the sidebar and the `chats` event live in `src/ui`, which is not exported.
  `ChatView.generation` goes; it was only read by the page.

## Modes

- **Desktop and `ui --home`**: everything above. Chats are in any directory.
- **`ui --cwd`**: several chats, all in that directory (or its worktrees). `/clear` and ⌘N open a new
  chat instead of emptying the one shown.
- **`genaicode chat` with `/web`**: one chat, as today; the limit does not apply.
- **Several windows on one server**: each shows its own chat; two windows on the same chat see the
  same view, as today. The desktop app keeps one window; a second one (⌘⇧N) needs only shell work
  afterwards.

## Migration

Each step ships alone and leaves the app working.

1. **Chat ids on the wire (fixes #354).** A `ConversationMeta` in every mode; every command carries
   `chat`, the server refuses a mismatch; `generation` removed. Still one controller. Tests:
   `parseCommand` cases; two pages on one server for the three cases of #354.
2. **Hub with one chat.** `createChatHub`, `agentsFor(chatId)`, channels, artifact store and uploads
   per chat, `open` in place of the switch commands. Behaviour unchanged (an `### Internal` line).
   Tests: hub unit tests with a fake `CodingAgent`; the existing browser tests pass
   unchanged.
3. **Background chats.** Switching no longer clears; `?chat=` and the `chats` event; live glyphs and
   the bold title in the sidebar; the run limit with the queue; the same-folder warning. Tests: two
   chats running with fake agents, each event and command reaching only its own; the third chat
   queues at limit 2 and starts when one ends; sidebar browser test and new screenshots.
4. **Cross-chat attention.** Needs you answers background chats in place; notifications and toasts
   name the chat; Stop on a row; the quit confirmation. Tests: `needs-you` unit and browser tests
   with two chats; answering clears every copy.
5. **Lifecycle and settings.** Idle unload, `ui-chats.json` and the interrupted state, the "Chats
   running at once" setting and `--max-chats`, the shared pack task counter, `docs/cli.md` and
   `src/desktop/README.md`. Tests: unload rules with fake timers (a chat with an unmerged worktree
   stays); restart shows interrupted chats; 5 packs share 8 slots.

## Risks

- **Quota and cost** are spent several times faster; the quota rows in the sidebar are the only brake.
- **Same-folder edits** by two leads; the warning does not prevent them.
- **An approval answered for the wrong chat**: every cross-chat item must name its chat and project.
- **Channels per chat** multiply local MCP servers; step 2 must measure what one costs and may have
  to route one server by a per-chat token instead.
- **Unload and quit against `Pack.close()`**, which removes worktrees: the "never unload with
  unmerged work" rule needs its own test, and what quit does to worktrees today must be checked
  before step 5.
- **Agent CLIs under concurrency**: several sessions of one CLI in one directory work today from
  separate terminals, but resume and login refresh races should be tried per agent.

## Open questions

1. Default limit: 4 chats running at once, 8 pack tasks in total?
2. Past the limit: queue (recommended) or refuse with a message?
3. Quit with chats running: confirm and stop (recommended), or keep the server alive in the background?
4. After a restart: show "interrupted" and wait for the person (recommended), or resume by itself?
5. Two chats in one folder: warn (recommended), always start the second in a worktree, or refuse?
6. A budget across all chats, besides the one per chat?
7. A chat that finishes in the background: system notification by default, or only the glyph and a toast?
8. A second desktop window now, or after step 5 (recommended)?
