# Several chats at once

Status: proposal, nothing built. It builds on [the desktop layout](./desktop-layout.md). Issue #354
(a command reaching the wrong conversation) is already fixed by #371, which checks a `generation`
number on every command; step 1 replaces that number with chat ids.

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
  when a window shows it or when it has something alive: a running turn, queued prompts, a prompt
  waiting for a run slot, a waiting approval or question, a running `!command`, a running pack task
  or Review/Verify check, or a pack worktree not yet merged or discarded. Every other chat is only a
  row read from the stores, as today.
- **Shown**: which loaded chat a window displays. This is window state (`#chat=<id>` in the URL), not
  server state. Switching changes the view only; it never calls `session.clear()` and is never
  refused. A chat that is not shown keeps running. The server counts a chat as shown while a window
  streams it (`GET /api/events?chat=<id>`) and for 30 seconds after that stream closes, so a
  reconnecting tab does not lose it. `open` marks the chat as shown at once, before its stream
  connects.
- **One owner per agent session.** A `(source, sessionId)` belongs to at most one loaded chat; the
  hub keeps that index. `open { type: 'continue', id, source }` (sidebar, Search, a second window,
  the menu bar) of a session a loaded chat owns returns that chat's id instead of creating a second
  controller that resumes the same session file. `/continue <id>` typed in chat B for a session
  chat A owns shows A in B's window with a notice ("Already open in ‘Release notes’"); B does not
  adopt it, because in `--cwd` mode a same-agent takeover passes the native `sessionId` to
  `session.adopt()` and both chats would then write to one history.
- **What moves up to the hub**: agent detection and inspection (`updateAgents`), the tower inbox and
  its timer, the per-recipient ordering of `sessions_send` (below), the bark setting, the run limit,
  the shared pack slots, the per-repository worktree lock and one scoped MCP server for every
  chat's channels.
- `genaicode chat` (terminal) and `/web` use a hub with one chat and behave as today.

## Limits

- A chat **runs** while its lead turn runs. Pack workers stop when the lead turn ends
  (`pack.ts` halts `turnSubs` in the run's `finally`), so they never run on their own; what does run
  without a lead turn is an operator's Review or Verify check on a task card, and a `!command`.
  Those take a pack slot (Review, Verify) or nothing (`!command`), not a chat run slot. Default:
  **4 chats running at once**; setting "Chats running at once" (1–8) in Settings › General and
  `--max-chats`.
- **Past the limit: queue, do not refuse.** The hub holds the prompt before `session.send()` and the
  chat shows "Waiting for a free slot · 2 ahead · Cancel"; the row gets the waiting glyph. It starts
  when a chat finishes, oldest first. A refusal would throw away what the person just typed.
  - A second prompt typed while waiting joins the same entry, as `session.queued` does for a running
    chat. Agent, model, effort and Plan mode changes apply when it starts.
  - Cancel or Stop removes the entry and puts its text back in the composer.
  - A chat keeps its slot while its own queued prompts run one after another; it gives the slot up
    when its queue is empty. Steering a chat that already runs is not counted.
- **Worker processes.** Each chat's pack allows 4 parallel tasks, so 4 chats could run 20 agent
  processes. The hub gives every pack one shared pool (a new `PackOptions.slots`, default 8 in
  total) next to its own `maxParallel`. Today a `delegate` past `maxParallel` throws at once
  (`pack.ts:1112-1114`), and resuming a finished task (`pack.ts:1666-1671`) and Review or Verify
  (`pack.ts:1519`) throw `PackActionError('capacity')`. Every entry point that starts a worker
  process acquires from the pool and releases when the process ends:
  - `delegate` and resume (`steer` on a finished task) **wait** for a slot when other chats hold it,
    aborting on the turn's `ended.signal` and sending MCP progress so the client's 300 s timeout does
    not fire. After 240 s (the `wait` cap) they return "All 8 pack slots are used by other chats
    (Release notes, Sprite import). Wait on your own tasks or try again later." A lead whose own
    tasks hold its `maxParallel` gets today's message. Neither leaves the lead calling `wait()` on
    no tasks in a loop.
  - Review and Verify on a card are the person's own click: they refuse at once with `capacity`,
    whose text names the chats holding the slots.

## Lifecycle

| Event                        | Effect                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stop** (button, Esc)       | Stops the chat shown, never another. The sidebar row menu gets "Stop" for a background chat.                                                                                                                                               |
| Close a browser tab          | Nothing stops; the server owns the chats.                                                                                                                                                                                                  |
| Close the desktop window     | macOS: the app stays in the menu bar and the chats keep running. Linux (closing quits): as Quit.                                                                                                                                           |
| Quit the app, Ctrl+C on `ui` | With chats running: "3 chats are working. Quit stops them." Then the hub shuts every chat down (below): processes stop, unmerged worktrees stay.                                                                                           |
| Restart                      | Survive: the conversation records (`saveConversation`) with their spent budget, the agents' own session files, unmerged pack worktrees and their task records. Lost: running turns, queued prompts, open approvals, notices, auto-approve. |
| Idle                         | A loaded chat with nothing alive that no window has shown for 10 minutes is unloaded (`controller.close()`). At most 12 idle chats stay loaded, least recently shown first out.                                                            |

- **Shutdown keeps unmerged work.** Today quit never calls `Pack.close()` (`main.ts` closes the
  controller, whose `session.close()` only stops the run), so worktrees stay on disk but nothing can
  merge them: `session.adopt()` restores old pack cards with `interactive: false`
  (`session.ts:1485`) and the `pack()` that knew them is gone. `Pack.close()` itself marks unmerged
  tasks discarded and removes their directories (`pack.ts:972-975`), so it is the wrong call for
  quit. A new `Pack.shutdown()` halts workers and checks, unwatches the trees and keeps every
  unmerged worktree; it writes for each such task the record needed to merge it later (id, title,
  agent, its session id, repo, worktree directory, start commit, base, mode) to
  `~/.genaicode/pack-tasks/<chatId>.json`. A chat loaded after a restart passes those records to
  `pack({ recovered })`, which restores interactive cards: Merge, Discard, Review and resume work on
  the original edits. `Pack.close()` keeps its meaning, an explicit discard of everything, and is
  used only when the person archives a chat.
- **Quit in the desktop app** is decided in Rust, not in the page: ⌘Q and the menu-bar Quit end in
  `app.exit(0)` (`lib.rs:994`), and Linux window close is `CloseRequested` (`lib.rs:1015`). The shell
  handles `RunEvent::ExitRequested` (which it does not today), asks the server
  `GET /api/chats?running=1` on loopback, shows the native confirmation when the count is not zero,
  and only then exits. On exit the server shuts the chats down in parallel, writes
  `ui-chats.json` and the pack task records first, and each `!command` group gets
  `KILL_AFTER_MS` (3 s). `STOP_GRACE` (5 s, `lib.rs:269`) covers that only if shutdown is parallel;
  it goes to 10 s to leave room for agent CLIs that flush their session files on SIGTERM.
- **`ui-chats.json`.** The hub writes the ids of loaded chats, whether each was running and which one
  the window showed to `~/.genaicode/ui-chats.json`. After a restart those that were running show an
  "interrupted" glyph and a line "Stopped when the app quit. Continue?"; nothing resumes by itself.
  `--restore` (the desktop app passes it, `lib.rs:319`) now means "load the chats in `ui-chats.json`
  and show the one shown last"; without that file it falls back to today's last conversation of the
  directory (`main.ts:961`). Without `--restore` the file is read only for the interrupted glyphs.
- **Unloading.** A chat with an unmerged pack worktree is not unloaded: its cards live in the `pack()`
  instance. (With `Pack.shutdown()` and `pack({ recovered })` this rule could later relax.) A loaded
  idle chat costs its transcript in memory and a token on the scoped MCP server; agent CLIs run only
  during a turn. The work is bounded by the two limits above, the memory by the idle rule.
- **Budget survives unloading.** `remainingBudget()` reads the session's cumulative `usage` and
  `costUsd`, which `ConversationRecord` does not store, so a chat that spent $9 of a $10 `--budget`
  would get $10 again after reloading. The record gains `usage` and `costUsd`, saved at the end of
  every turn, and a reloaded session starts from them (the `pastUsage`/`pastCost` it keeps today).
- **Coming back to an unloaded chat.** A tab that wakes after the chat was unloaded asks
  `GET /api/events?chat=<id>`; the hub loads the chat again from `conversations.json` and the agent's
  session store under the same id, as `open` would. A chat whose record is gone answers 404
  `{ reason: 'gone' }` and the page shows home.

## Per-chat state

| State                                                       | Today                                                                       | With many chats                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent, model, effort, Plan mode                             | `SessionState`                                                              | Per chat, unchanged.                                                                                                                                                                                                                                                                                                                                                  |
| Approvals, questions                                        | `session.approvals`                                                         | Per chat; the command names the chat.                                                                                                                                                                                                                                                                                                                                 |
| Auto-approve                                                | per conversation, guarded by `generation`                                   | Per chat, guarded by the chat id. A new chat starts from `--yes`.                                                                                                                                                                                                                                                                                                     |
| Pack tasks and worktrees                                    | one `pack()` in `agents`, tasks "over all runs"                             | One `pack()` per chat: the hub takes `agentsFor(chatId)` instead of `agents`. Worktree directories get the chat's namespace, `<chat>-t1-<time>` (today `${id}-${Date.now().toString(36)}` with `t1` in every pack, `pack.ts:1362`), and git worktree operations take a lock per repository from the hub instead of the per-pack `withWorktree` queue (`pack.ts:794`). |
| `ask_user`, progress, `open_project`, artifacts, `sessions` | one loopback MCP server each, `bind()` takes one handler                    | One server for the hub through `startScopedLocalMcpServer`, as `startProgressChannel` already does (`progress.ts:102`): each chat's turn gets a URL token, so the server knows the calling chat. No server per chat.                                                                                                                                                  |
| `sessions_send` consent and relay cards                     | one `SessionSendGate`; `attach()` replaces the handler and clears `allowed` | A gate per chat: its confirm handler, relay cards and `allowed` set. Only the per-recipient ordering (`line`, `pending`) is shared on the hub, so two chats writing to one session still go one after the other.                                                                                                                                                      |
| Artifacts                                                   | one store, `/artifacts/<id>`, 200 MB cap per store                          | One store per chat, `/artifacts/<chat>/<id>`, under one cap for the hub (200 MB in total; the oldest artifacts of idle chats go first). Sixteen stores with their own caps could hold 3.2 GB.                                                                                                                                                                         |
| Uploads                                                     | `createUploads(() => cwd of the session)`                                   | Stored per chat; `POST /api/upload?chat=`. `/uploads/<id>` stays as it is (ids are 64 random bits), and the hub looks in every chat's uploads.                                                                                                                                                                                                                        |
| Files                                                       | `makeRoots()` with the one session's cwd first                              | `chat=` on `/api/file`, `/api/file/raw`, `/api/file/images`, `/api/reveal`, `/api/pull-request` and `/api/pack-profile`; roots are built per chat (its cwd, its pack worktrees, the sessions it opened).                                                                                                                                                              |
| Budget (`--budget`)                                         | per session                                                                 | Per chat, kept across unloading (Lifecycle). An app-wide cap is an open question.                                                                                                                                                                                                                                                                                     |
| `!command` shells, notices, relay cards                     | controller                                                                  | Per chat, unchanged. A running shell keeps its chat loaded.                                                                                                                                                                                                                                                                                                           |
| Transcript copy and save                                    | the open chat                                                               | `chat=` on `/api/transcript` and `/api/save-transcript`. The desktop File › Session menu fetches these in Rust (`lib.rs:818-822`, `SAVE_TRANSCRIPT_PREFIX`): it reads `#chat=` from the webview's URL and passes it on.                                                                                                                                               |
| Composer draft and attachments                              | `AgentChat` state (`agent-chat.tsx:273`, `useAttachments`)                  | Per chat: `AgentChat` takes an optional `draftKey` and keeps the draft and pending attachments for each key. Remounting with `key={chatId}` would lose them.                                                                                                                                                                                                          |
| Bark, theme, sidebar and panel widths                       | app or window                                                               | Unchanged.                                                                                                                                                                                                                                                                                                                                                            |

The work panel, the mission strip, the top bar and the composer render the chat shown and nothing
else. Panel memory is already per chat.

**Two chats in one folder.** Two leads editing the same files will collide. When a chat starts a
turn in a directory where another loaded chat runs, the composer says "Another chat is working in
this folder". It does not refuse and offers nothing else: the "This folder / New worktree" choice
from the desktop layout was never built (`StartsIn` in `composer.tsx` picks a directory only), and
`isDisallowedWorkspace()` rejects `.genaicode/worktrees/*` as a chat's directory. A lead chat in its
own worktree, with merging and discarding the whole chat, is a separate design.

## Cross-chat surfaces

- **Sidebar glyphs.** `liveGlyph()` is used for every loaded chat, not only the open one: `run`,
  `ask`, `err`, `ok`, `idle`. One new glyph, `wait` (queued for a slot or interrupted). A chat that
  finished or failed while not shown keeps a bold title until it is shown. The footer says
  "3 of 4 running" while the limit matters.
- **One row per chat.** `withOpenChat`, `isOpenChat`, `waitingElsewhere` (`sidebar.ts`) and
  `needsItems` (`needs-you.ts`) compare with one `open: { id, source }` and one sentinel source,
  `OPEN_CHAT_SOURCE`. They take the list of loaded chats instead: a loaded chat's row and its
  approvals come from the `chats` event, and the same `(source, sessionId)` from `/api/sessions` or
  the hooks is dropped. A loaded chat without a session id yet gets its own sentinel,
  `genaicode:open:<chatId>`, so two new chats do not merge into one row.
- **Needs you.** Approvals and questions of background chats are items with the chat's title and are
  answered in place (`needs-you.ts` already has the `app` source); answering does not switch the
  view. The count on the sidebar and the mission strip's "next approval" stay as designed: the strip
  is about the chat shown, the sidebar about all.
- **Notifications.** The bark and a toast "Done: Release notes" fire for any loaded chat that asks or
  finishes while it is not shown, and name the chat; a click shows it. In a browser the page also
  uses `new Notification()` when the window is hidden. The desktop app has no notification plugin
  (`src-tauri/` has none), and WKWebView does not reliably show page notifications or bring a hidden
  window back; system notifications there need `tauri-plugin-notification` and a click that calls
  `show(app)` and opens `#chat=<id>`. That is shell work after step 4.
- **Search (⌘K).** Same data. Opening a result is a view switch, so it always works; loaded chats
  come first with their glyph.
- **Tower.** One inbox on the hub, fed by every loaded chat. A local approval's key gets the owning
  chat, `turn:<chat>:<turnId>:<requestId>` (today `turn:<turnId>:<requestId>`, and turn numbers start
  at 1 in every session), and `approve` goes to that chat's session, whichever window pressed it.
  `send` delivers a drafted proposal to the recipient recorded in the draft, as `decide()` does
  today; no chat is involved. `TowerInbox.view()` takes the loaded chats instead of one
  `SessionState`. Tower commands about `hook:` items, proposals and running questions belong to the
  hub and need no `chat`. The desktop menu-bar tower reads `sessions --waiting` and needs no change.
- **Menu bar "open session".** The shell writes `open-session <id>` to the server (`lib.rs:197-207`),
  which today makes the one controller `continueSession()` it and the window follows. Now the hub
  opens (or finds) the chat and sends an `open { chat }` event to the windows; the desktop window
  shows it.

## Server and API

- **Every chat command carries `chat`** (`submit`, `stop`, `approve`, `answer`, `pack-task`,
  `agent`, `model`, `auto`, and `tower` on `turn:` items). The server finds the controller by id; an
  id that is not loaded answers 409 `{ reason: 'conversation' }`. `generation`, the optional
  `conversation` fields and the server's per-window switch order (`SwitchOrder`, `lastOrder`,
  `switchSeq`) are removed; the chat id does what #371's checks do.
- **Opening** replaces switching: `{ type: 'open', target }` with the targets of today (home,
  project, topic, continue) answers `{ ok, chat }`, and only the window that asked shows it; a
  session a loaded chat owns answers that chat. A slow folder lookup ends in an `open` whose result
  only its own window shows; the window drops it if the person moved on, with the per-window counter
  it already has. `{ type: 'close', chat }` unloads an idle chat. `takeover` (`/continue <id>`) still
  joins the chat it was typed in, unless another chat owns that session (Model).
- **`/new` keeps its meaning**: `session.reset()` on the command's chat, a fresh agent session that
  keeps the transcript (`controller.ts:1379`). `/clear` and ⌘N open a new chat. A `/new` names its
  chat, so it cannot reset one another window shows.
- **SSE: one multiplexed stream per window**, `GET /api/events?chat=<id>`. Browsers allow about six
  HTTP/1.1 connections per origin, so a stream per chat is out. Events: `chats` (a summary of every
  loaded chat: id, title, directory, glyph, task counts, waiting approvals, queue position), `view`
  (the full `ChatView` of the chat shown, now with its id), `open` (the hub asks the window to show a
  chat), and `config`, `toast`, `release` as today. A window that shows another chat reconnects with
  the new id; views are snapshots, so nothing is lost. Background chats send summaries only, never
  transcripts.
- **`genaicode/react`**: `WorkPanel` and the mission strip take one session's state and do not
  change. `AgentChat` gains the optional `draftKey` (Per-chat state); without it, it behaves as
  today. The hub, the sidebar and the `chats` event live in `src/ui`, which is not exported.
  `ChatView.generation` goes; it was only read by the page.

## Modes

- **Desktop and `ui --home`**: everything above. Chats are in any directory. "Chats running at once"
  is kept in `DesktopSettings` (`nav.rs:165`, today only `artifactCdn`) through `POST /api/settings`,
  and the shell passes it as `--max-chats` when it starts the server (`lib.rs:311-333`).
- **`ui --cwd`**: several chats, all in that directory (or its worktrees). `/clear` and ⌘N open a new
  chat instead of emptying the one shown.
- **`genaicode ui` in a terminal**: "Press Enter to chat in this terminal too" (`index.tsx:596`)
  attaches the terminal to the chat the server started with. It does not follow the windows; its
  `/continue` and `/clear` act on that chat as they do today.
- **`genaicode chat` with `/web`**: one chat, as today; the limit does not apply.
- **`startEmbeddedWeb`** (`genaicode/ui`, the `genaicode/vite` overlay): one
  `EmbeddedChatController` the host drives, as today; single-chat like `/web`.
- **Several windows on one server**: each shows its own chat; two windows on the same chat see the
  same view, as today. The desktop app keeps one window; a second one (⌘⇧N) needs only shell work
  afterwards.

## Migration

Each step ships alone and leaves the app working. The tests named are the ones each step adds.

1. **Chat ids on the wire.** A `ConversationMeta` in every mode; every command carries `chat`, the
   server refuses a mismatch; `generation`, `conversation` and `SwitchOrder` removed. `/new` stays
   `session.reset()`. Still one controller. Tests: `parseCommand` cases; the #371 tests for the
   three cases of #354 pass with chat ids; `/new` keeps the transcript.
2. **Hub with one chat.** `createChatHub`, `agentsFor(chatId)`, `open` in place of the switch
   commands; one scoped MCP server for `ask_user`, progress, `open_project`, artifacts and
   `sessions`; a `SessionSendGate` per chat; artifact stores and uploads per chat under one cap;
   `chat=` and per-chat roots on the file endpoints; worktree namespaces and the per-repository
   lock. Behaviour unchanged (an `### Internal` line). Tests: hub unit tests with a fake
   `CodingAgent`; two packs in one repository with a fixed clock get different worktree
   directories and do not run `git worktree add` at once; two chats' `ask_user` calls on one server
   reach their own chat; consent given to `sessions_send` in A does not let B send; `/api/file`
   with two projects holding `README.md` returns each chat's own; the artifact cap counts both
   stores. The existing browser tests pass unchanged.
3. **Background chats.** Switching no longer clears; `?chat=`, the `chats` and `open` events and
   the 30 s shown grace; one owner per session; live glyphs, the bold title and one row per chat in
   the sidebar; the run limit with the queue; the shared pack slots; per-chat drafts in `AgentChat`;
   the same-folder warning. Tests: two chats running with fake agents, each event and command
   reaching only its own; the third chat queues at limit 2, Cancel returns its text and it starts
   when one ends; pool of 8 filled by A, then Review in B refuses with `capacity` and no ninth
   process starts, and a `delegate` in B waits and starts when A's task ends; `open continue` of a
   session A owns returns A, and `/continue` of it in B while A runs leaves B unadopted; a draft and
   an attachment typed in A are back after showing B; two new chats without session ids are two
   sidebar rows; sidebar browser test and new screenshots.
4. **Cross-chat attention.** Needs you answers background chats in place; tower keys with the chat;
   notifications and toasts name the chat; Stop on a row; the quit confirmation, in the page and in
   the Tauri shell (`ExitRequested`, `GET /api/chats?running=1`). Tests: `needs-you` unit and
   browser tests with two chats, answering clears every copy, a background chat's approval is
   counted once; two chats with the same turn and request ids, approving B's item from A's window
   approves B only; a tower `send` goes to the recorded recipient; the Rust quit decision with zero
   and three running chats.
5. **Lifecycle and settings.** Idle unload with the budget in the record, rehydration on a stream
   for an unloaded chat, `ui-chats.json`, `--restore` and the interrupted state, `Pack.shutdown()`
   and recovered tasks, parallel shutdown within `STOP_GRACE`, the "Chats running at once" setting,
   `--max-chats` and `DesktopSettings`, `docs/cli.md` and `src/desktop/README.md`. Tests: unload
   rules with fake timers (a chat with an unmerged worktree stays); a chat that spent $9 of $10
   has $1 left after unload and reload; a stream for an unloaded chat reloads it under the same id;
   quit with a completed, unmerged task, restart, and merge its original edits from the reopened
   chat; restart shows interrupted chats; four chats with a running `!command` shut down within
   `STOP_GRACE`.

## Risks

- **Quota and cost** are spent several times faster; the quota rows in the sidebar are the only brake.
- **Same-folder edits** by two leads; the warning does not prevent them.
- **An approval answered for the wrong chat**: every cross-chat item names its chat and project, and
  every key carries the chat id.
- **Recovered pack tasks** after a restart may face a base that moved; Merge then goes through the
  same patch check as today and reports conflicts instead of applying.
- **Agent CLIs under concurrency**: several sessions of one CLI in one directory work today from
  separate terminals, but resume and login refresh races should be tried per agent.

## Open questions

1. Default limit: 4 chats running at once, 8 pack tasks in total?
   - Review input: good defaults, provided the 8-task pool waits or queues instead of throwing
     `capacity` across chats (Limits now says how).
2. Past the limit: queue (recommended) or refuse with a message?
   - Review input: queue, with Cancel, Stop and re-queueing spelled out (Limits).
3. Quit with chats running: confirm and stop (recommended), or keep the server alive in the background?
   - Review input: confirm and stop, wired into Tauri's `ExitRequested` / `CloseRequested`.
4. After a restart: show "interrupted" and wait for the person (recommended), or resume by itself?
   - Review input: wait; say what happens to pack worktrees left on disk (Lifecycle:
     `Pack.shutdown()` and recovered tasks).
5. Two chats in one folder: warn (recommended), always start the second in a worktree, or refuse?
   - Review input: warning only for now; lead-chat worktrees as their own design.
6. A budget across all chats, besides the one per chat?
   - Review input: defer; `--budget` per chat and the quota rows suffice for a first version.
7. A chat that finishes in the background: system notification by default, or only the glyph and a toast?
   - Review input: glyph and toast by default; system notifications opt-in, or only when the window
     is hidden, once the desktop shell supports them.
8. A second desktop window now, or after step 5 (recommended)?
   - Review input: after step 5.
