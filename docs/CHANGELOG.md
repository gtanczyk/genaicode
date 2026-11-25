# Changelog

One short bold title per change, with optional indented details. The category decides the next
version: **Breaking** bumps major, **Added** bumps minor, **Fixed** bumps patch, **Internal** never
releases. A PR that changes `src/` (tests excluded) must add a line under `## Unreleased`, or CI
fails. Merging to master refreshes the `release` PR; merging that publishes to npm. See
[AGENTS.md](../AGENTS.md#changelog-and-releases).

## Unreleased

### Added

- **Review bulk approvals and merges, inspect changed files, and undo a discard.** (#371)
  - The work panel confirms bulk approvals and checked merges and shows per-file changes. Merged and discarded worktrees stay on disk for recovery (#358, #365).

### Fixed

- **Open session transcripts directly and see why a reply failed.** (#369)
- **Read release highlights and expand changes for details.** (#368)
- **The work panel keeps “Running” on one line beside long commands.** (#370)
- **Browser commands follow the current conversation across windows.** (#371)
  - Browser commands follow the conversation generation. Resumed pack tasks renew their checks (#354, #362).
  - Streaming waits report increasing progress and send a final JSON-RPC response.

### Internal

- **Refresh the macOS task and file viewer screenshots in both themes.** (#373)

## 3.4.0 — 2026-11-25

The new window layout puts your chats in the sidebar and delegated tasks in the work panel. Press ⌘K (Ctrl+K) to search chats, sessions and commands. Open Needs you to answer agents across projects, or Settings to manage agents, teams and usage.

### Added

- **Read file changes and published artifacts in the work panel.** (#364)
  - The work panel of the desktop and browser app gets **Changes** and **Artifacts** tabs after Tasks and Live.
  - Changes lists the files changed in the chat: the lead agent's own edits (newest first, with +/− counts where the agent reports a patch), then the files of the delegated tasks with the task's id and merged or unmerged; a task's file opens that task, where its diff, review and merge are.
  - Artifacts replaces the "Artifacts · N" menu of the top bar and lists what the chat published with kind, size and versions.
  - A file or an artifact now opens **inside the panel** instead of in a side panel of its own: with a back button to where it was opened from (Changes, Artifacts, the task, or Close for a link in the chat), the panel widening to 600 px where the chat keeps its own 600, **Diff / File** for a file the lead edited with a patch, and **Expand / Dock** in place of Full size (over the chat area, not the whole window).
  - Escape docks, then goes back.
  - A task's changed files open from its detail, read from its worktree while that is there, else from the chat's folder, also when the chat runs in a folder of the repository (a file outside that folder is not a link); back from a file finds the detail as it was left, with its diff open and what was typed.
  - The Work button shows for a chat with changed files or artifacts too, and the panel still opens by itself only on delegated tasks.
  - lib: In `genaicode/react`, `<WorkPanel>` has the two tabs and takes `renderViewer`, `viewsFiles` and `artifactUrl`; `workArtifacts`, `workChanges` and `WORK_PANEL_VIEWER` are new exports, and `WorkPanelView.tab` can be `changes` or `artifacts`.
- **Continue finished tasks and limit how many a lead starts.** (#361)
  - In a pack, `steer` on a finished task continues it in the same agent session and worktree (drivers that can resume; `agents` says which), `discard` dismisses a finished `shared` task from the task list, `maxTasksPerTurn` (default 25, `--max-tasks`) caps how many tasks one lead turn may start, and `wait` sends a task's full prompt only the first time, caps its wait at 240 s and sends MCP progress while it waits.
- **Follow and review delegated tasks in a dedicated work panel.** (#353)
  - The desktop and browser app show delegated tasks in a **work panel** on the right (the **Work** button, ⌘⌥B) instead of a card in the chat, which keeps one line per turn ("3 delegated tasks · 1 running · Open").
  - The panel sits beside the chat while the chat keeps 600 px and is a full-width view with a back arrow otherwise; its width is remembered per window, and open/closed and the open task per chat.
  - Tasks are grouped as Needs you, Failed, Review blockers, Running, Unmerged and Done; a row opens the task with what it was asked, agent and model, start time and duration, what it does now, messages sent to it with their receipts, result, changed files, diff, review, tests, and steer, stop, merge or discard.
  - lib: `PackTask.pullRequest` records the task’s pull request.
  - A task that opened a pull request (its worktree is on the pull request's head branch at its head commit with nothing uncommitted, asked of `gh` and git) shows "PR #12 · merged" (or open, closed) with a link instead of **Merge locally**; a pull request its reply only mentions is a link beside Merge locally and Discard.
  - Merge locally says what it does and merges the revision whose diff you read, also after a review or tests; if the worktree changed since, nothing merges until the new diff is shown.
  - The worktree is checked again every minute while it is there, also after its pull request merged: an edit made since brings Merge locally back, and Discard is refused if the worktree no longer matches the pull request.
  - lib: Discard an empty worktree with `PackAction` `{ type: 'discard', empty: true }`, refusal reason `changed`.
  - A task that changed no files offers **Show diff**, which also lists an edit made in its worktree since, and **Discard worktree**, which is refused if the worktree has changes by now, also a commit, a staged file its diff no longer shows or an edit `git status` does not list (`--assume-unchanged`); Merge locally merges nothing and keeps the worktree while it holds a commit, staged work, work inside a submodule or a repository cloned into it that its diff does not carry.
  - Task actions and the panel's Stop are refused once the window has moved to another chat.
  - "Requires another agent that can review without tools" and "Choose the test command with --verify" now say what you can do.
  - lib: `genaicode/react` exports `<WorkPanel>` (its `onPackAction` is a `WorkActionHandler`), `workPanelLayout()` and `<AgentChat onOpenTasks>`; without them the inline card stays, `storedSize()` takes the storage to keep a size in, and `PackTask.worktree` names a worktree task's worktree root.
- **Filter, group and clear long lists of delegated tasks.** (#360)
  - The work panel stays readable with 100 and more delegated tasks.
  - Above 8 tasks it has status chips with counts (All, Needs you, Failed, Blockers, Running, Unmerged, Done), a text filter over title, agent, id and status, and a switch to group by agent; above 15 a row is one line, a group shows its newest 8 rows and **Show N more** (50 at a time), also under a chip, a text filter or by agent (another chip or text filter starts again from the newest 8), and the folded Done group says what it holds ("100 done · 5 stopped · 3 merged locally").
  - Finished tasks that left no worktree to merge or discard, such as reviews that ran in your folder, can be cleared from the list: **Clear N** on Done and Failed, or the × on a row, which gives the keyboard to the row beside it; the conversation keeps them, the list says how many it hides and **Show them** brings them back.
  - A row under the pointer or the keyboard focus stays in its group and in the text filter it matched, with its new state, until they leave, a new task does not fold Done from under it, and Approve on a row leaves the focus on that row.
  - lib: `WorkPanelView` stores the list state in `filter`, `query`, `by`, `more`, `dismissed`.
  - Filters, grouping, opened rows and cleared tasks are remembered per chat.
  - lib: The inline card of `<AgentChat>` shows one-line rows, the first 12, a filter and **Clear N finished** above 15 tasks, and is unchanged up to 15; what it remembers is kept per conversation and turn (`<AgentChat chatId>`).
  - Escape in a panel field with text in it clears the field first.
- **Track live work and answer approvals above the message box.** (#363)
  - The desktop and browser app show a **mission strip** above the message box while delegated work runs: one count per state (Needs you, Failed, Review blockers, Running, Unmerged, Done; a click opens Tasks on that group; tasks cleared from Tasks are not counted), what the lead does now, and the next approval a task waits for with **Approve** and **Deny** and "1 of 3 in this chat", at every width and with the work panel closed.
  - A request that just moved up ignores clicks for 400 ms, so a double click does not answer the next one.
  - An approval of a delegated task is answered there, on its row or in its detail and no longer shows in the transcript; the lead's own approvals and every question stay in the chat.
  - The work panel gets a **Live** tab beside Tasks: what waits for you in this chat ("all N ›" opens Needs you), the lead's plan and what it does now, up to three running tasks as cards (pinned ones first, then the ones you messaged, then the newest) with what each does, its latest message and the receipt of your last message, and a team feed over all tasks, newest first, where routine reads and edits are one line per task until **Everything** is chosen.
  - lib: `WorkPanelView` remembers `tab`, `pinned`, `feed`.
  - A task id opens that task, and Back returns to the tab it was opened from; the tab, the pins and the feed's choice are remembered per chat.
  - lib: `genaicode/react` exports `<MissionStrip>` (`dismissed` takes the panel's cleared tasks), `<AgentChat missionStrip>` and `<WorkPanel needsYou>`; without `missionStrip` the chat is unchanged, and without its `onOpenGroup` the transcript keeps every approval.
- **Find chats, sessions and settings in the new sidebar.** (#350)
  - The desktop and browser app get a sidebar: **New chat** (⌘N), **Needs you** with a count across projects, **All sessions**, this app's chats grouped by project (the directory they ran in) with a state glyph each and a **+** that starts a chat in that folder, **All chats** for the older and the archived ones, the other agents' latest sessions, plan limits per agent, **Settings**, **Help** (What's new, Get help, Report a bug, Terms, Commands and keys) and the connection state. ⌘B (Ctrl+B) folds it to a rail of icons; the choice is remembered, and the rail is the default in a window under 980 px.
  - The header is now a slim top bar with the chat's title, its folder and a `⋯` menu for the session id and transcript; the pills it held (What's new, Sessions, Chats, Tower inbox, Project team, Settings, the update button, the support links) moved into the sidebar.
  - Escape goes back from a page to the chat or closes the open menu, and stops a running turn only from the message field.
- **Choose how to send a message and where to start a chat.** (#352)
  - lib: `SessionState.sendAction` identifies the available submit action.
  - The desktop and browser composer is one card. **Stop** is a button of its own (also ⌘. / Ctrl+.) beside the submit button, which says what Enter does: **Send**, **Steer** for an agent that takes input mid-turn, **Queue** for one that does not or while a review of delegated work holds the budget.
  - One agent chip opens a popover with the agent, model, effort and fallback agents (they were separate controls, and fallback was `/fallback` only); **Plan** is a toggle and the permission switch reads **Ask first / Auto-approve all** and, like `/auto`, holds for the chat it was set in (a new chat starts from `--yes` or asking).
  - A new chat says where it starts: **Starts in** offers the recent project folders, a path, the home folder, and **Choose…** with the system's folder dialog in the desktop app.
  - The plan's limits left the composer for the sidebar; only an agent that used 80% or more of a plan window, or all of it, is named under it.
  - While a folder is looked up or another chat opens, a prompt waits in the field; `/clear`, `/new` and `/continue <id>` still go and win.
  - lib: `<AgentChat>` takes `composerLayout="card"` and `composerHeader` for the same layout, `sendsWhileDisabled` for messages that go while it is `disabled`, and keeps its look without them.
- **Manage agents, teams, appearance and usage in Settings.** (#355)
  - The desktop and browser app get a **Settings** page in place of the Settings menu, the Project team dialog and the HTML artifact CDNs popover.
  - It opens from the sidebar or with ⌘, (Ctrl+,), takes the chat's place while the chat keeps running, and Escape or the top bar's back arrow returns to the message field.
  - Sections: **General** (theme: System, Light or Dark, kept for the next visit; the bark, as `/bark`), **Agents** (the state of every agent CLI, the commands to install or sign in with a copy button, **Check again**, **Use**), **Team** (the open chat's project, or, where no chat names one, a folder to type, pick from recent ones or **Choose…**; lead, workers, **Remember this team for the project**), **Artifacts** (the CDN allow-list), **Usage** (plan limits per agent and where its work went by topic; the sidebar's plan limits open it) and **About and updates** (version, What's new, the update, help links).
  - "Team for this project…" in the `⋯` menu and the sign-in links of the agent chip open their section.
- **Search chats, sessions and commands with ⌘K or Ctrl+K.** (#357)
  - **Search** in the desktop and browser app: ⌘K (Ctrl+K) or the sidebar's Search opens a palette over the page with this app's chats, the other agents' sessions of the last week (where the page has a session index) and the window's commands (New chat, Needs you, All sessions, All chats, each section of Settings, Collapse sidebar, What's new, Commands and keys).
  - It matches every typed word against the title, the project folder, the agent, the branch and the first and last prompt, titles first, and a session's repository; each result names its project (its folder, else a cloud session's repository) and agent.
  - The arrow keys, Home and End move, the selection, the first result too, stays on its result while the list refreshes, Enter opens (a chat as its sidebar row does, another agent's session in All sessions), Escape or a press beside it closes and puts the focus back where it was, or on the button of a menu it closed.
  - In `genaicode ui --home`, a recorded chat is matched by its store or agent and its id, so another agent's session with the same id is not listed as this app's chat.
- **See what each task is doing and when your message arrives.** (#359)
  - The work panel says what a running delegated task does in words: its row and the card in its detail name the tool call it is in with a verb and what it works on ("Running `npm test -- cart` · 14s so far", "Editing `src/cart.ts`"), the time counts up, and the card adds the task's latest message; an edit whose call fails is taken back there too.
  - The task's detail has a **Timeline**, newest first, that updates while the task works: the calls that returned, ordered by when they returned, with how long each took ("<1s" under a second), that it failed or that the task was stopped in it, the files it edited (not those of an edit that failed), what it asked approval for, what it said, the messages sent to it, and its start, each with its time.
  - A message sent to a task shows its receipt there: "Sending…", "✓ Delivered · 0.9s" once the agent took it, "✓✓ Delivered · answered" once the agent starts a new message after taking it (the rest of one it was already writing does not count), "Sent to …" for an agent that does not confirm, or "Not delivered" with **Send again** while the task still takes messages.
  - Your own messages to the lead show the same receipts in the chat, with the time they were sent, in place of "Seen by …".
  - lib: `PackTask.steps` (`PackStep`) carries a task's latest 30 steps with the tool's argument (credentials such as auth headers and cookies, `-u user:password`, tokens, passwords and keys hidden) and its start and end time (`interrupted` when the task ended first), `PackSteer` gains `settledAt` and `answeredAt`, a `SessionEntry` input gains `at`, `settledAt` and `answeredAt`, and Claude's and Gemini's `file-change` events name the tool call making the change (`toolId`).
- **Answer waiting agents across projects from Needs you.** (#356)
  - **Needs you** in the sidebar of the desktop and browser app opens a page in the chat's place: one queue of everything that waits for you across projects and agents (the open chat's approvals, what the tower holds, and the sessions of every agent and the chats of this app that ask a question or wait on a tool), each with its project, agent, what it asks and how long it has waited.
  - Approve, deny, send or dismiss in place where the source takes an answer, reply to a waiting session, or open its chat or session; filters narrow it to this chat, this app's chats, other agents' sessions, approvals or questions, each with its count.
  - The page lists exactly what the sidebar counts, a session whose hook asks for approval included even where its row was read before the question or still says it is at work, says so when nothing waits (also under a filter) or, in its place, that the queue could not be read and which stores failed in either listing, and Escape goes back to the chat.
  - It replaces the Tower inbox view.
- **See which model the agent is using.** (#335)
  - lib: `SessionState.reportedModel` carries the model reported by the agent.
  - The chat composer and terminal status line show the model the agent reports when none is set.
- **See delivery receipts for messages sent while an agent works.** (#347)
  - lib: The `delivery` field on a `SessionEntry` input records its receipt.
  - A message sent while the agent works says whether it reached the agent: "Sending…", then "Seen by claude" (the agent confirmed it took it), "Sent to …" (handed over, no confirmation), "Queued for the next turn" or "Not delivered", in the desktop, browser and terminal chat.
  - lib: `PackTask.steers` holds the delegated task’s receipts.
  - Messages steered into a delegated task, by the lead or by you, show the same in the task's detail and the latest one on its row.
  - lib: `AgentRun.steer` may resolve with `'taken'` (Claude, Codex, Muse, Antigravity) or `'sent'` (`SteerReceipt`).

### Fixed

- **Find plan usage in one place and see when a button is unavailable.** (#366)
  - The start screen of the desktop and browser app no longer repeats each agent's plan limits and where its work went: both are in **Settings › Usage**, and the sidebar keeps the meters.
  - A disabled button in a composer popover (**Open** with no path typed) now looks disabled, as on the Settings and Needs you pages, which share one set of button, pill and filter-chip styles.
  - lib: `genaicode/react` is unchanged.
  - Styles and code paths the sidebar layout left without a user are gone (the old popover styles, the agents view that Settings › Agents replaced).
- **See the model that actually answered each turn.** (#342)
  - Antigravity, Claude, Copilot and Gemini report the model that answered a turn, not the one configured at its start.
- **See running tasks first and read the outcome of finished work.** (#345)
  - The delegated-work card in the desktop, browser and terminal chat is now **Delegated tasks** ("3 tasks delegated · 1 running") instead of "Pack tasks" with slots and the lead turn's dollar figure.
  - Running tasks come first and show the command or message they are on now in their row; finished ones show their outcome (verdict line, first line of the reply, changed files, error, or who stopped them) and how long they took; older finished tasks fold behind "Show N earlier".
  - lib: `PackTask` gains `startedAt`, `endedAt`, `stoppedBy` and `verdict` (the reply's verdict line, read from the whole reply outside quotes and code).
- **Recognize delegated chats by your own words in their titles.** (#344)
  - A chat started with `genaicode ui --delegate` is titled after what you asked, not the first line of genaicode's delegation briefing: the briefing now follows your words in a tagged `<genaicode-briefing>` block on the lead's first turn, and is left out of session titles (also Codex's indexed titles), prompt previews and taken-over transcripts, also for older sessions.
  - Muse takes a prompt that starts with a dash.

### Internal

- **Check chat layouts in both themes against saved screenshots.** (#349)
  - A browser test compares screenshots of `<AgentChat>` and the `genaicode ui` page, in both themes, with committed baselines, and `agent-chat.css` defines the design tokens of the coming desktop layout (`--gc-color-*`, `--gc-type-*`, `--gc-space-*`, `--gc-radius-*`, `--gc-elevation-*`) beside its existing variables, which keep their values.

## 3.3.0 — 2026-11-24

### Added

- [Terms and privacy](legal.md): Apache-2.0 with no separate EULA, agents run on your own accounts under their providers' terms, Auto-approve and YOLO are at your own risk, and every request GenAIcode itself makes (updates only, no telemetry). Linked from the README and **Help → Terms and Privacy** in the desktop app
- `genaicode mcp install --send` (`sessions mcp --send`) lets an agent message your other sessions from its own chat: `sessions_send` asks you through the agent's client first (MCP elicitation) and returns the other session's answer, as an MCP task where the client takes tasks. For your own MCP tools: `ToolOutput.task`, `McpInputRequired`, `McpCallContext` and `createMcpState()` (#340)
- `genaicode sessions --cloud` (and `sessions mcp --cloud`) also lists cloud sessions GitHub knows of: your recent pull requests grouped by the claude.ai project thread, Claude Code cloud session or Codex Cloud task they link (through `gh`), and Codex Cloud tasks from `codex cloud list`; `githubCloudSessions()`, `codexCloudSessions()` and `joinedCloudSessions()` in code (#339)
- `genaicode sessions mcp` and `chat --sessions` let an agent read what the other agents remember about a project: `memory_list` names their instruction and note files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor rules, Claude Code's own notes) and `memory_read` returns one; `memoryTools()` and `agentMemoryFiles()` in code (#338)
- `genaicode mcp install` gives every installed agent (Claude Code, Codex, Gemini CLI, Copilot, Cursor) the session index as an MCP server; `mcp uninstall` and `mcp` (status) go with it, `installMcp()` in code. The server now also speaks MCP 2026-07-28 and serves a `genaicode-sessions` skill to agents that load skills from MCP servers; `startLocalMcpServer({ skills })` and `serveMcpStdio(tools, { skills })` do the same for your tools (#337)
- The desktop and browser chat keep the latest update and plan in view below the collapsed steps. Local agents can report progress with `report_progress` in desktop, browser and terminal chats (#333)
- The desktop Help menu, browser UI and terminal help link to support and bug reports (#331)

### Fixed

- Desktop chat links open in the default application on a regular click and show an error if opening fails. Session and transcript commands are under **File → Session** (#334)
- Long conversations stay responsive in the chat: folded steps and tool calls render only when opened, so a sent message shows up at once and typing does not lag (#336)

## 3.2.0 — 2026-11-23

### Added

- Plan mode (`task.mode: 'plan'`, `capabilities.plan`, `AgentSession.setMode()`, `CodexLiveOptions.collaborationMode`, and `/plan` + the Plan toggle in `genaicode chat`, `ui` and the desktop app): Codex enters app-server Plan mode (re-sent on resume only when changed), Claude Code uses `--permission-mode plan` and Gemini uses `--approval-mode plan`. When Codex offers its own `request_user_input` tool (Plan mode or `features.default_mode_request_user_input`), `codexLive()` drops `genaicode_ask` so Codex gets only one question tool per turn (#328)
- `sessions_send` in `genaicode ui`, `chat`, the desktop app and `<AgentChat>`: messages passed to another session show as live cards (`Queued` → `Working` with current step → `Answered` / `Failed`) with the target agent's avatar, project chip, collapsible sent prompt and Markdown-rendered reply instead of a raw monospace notice. Settled replies are passed into the active chat agent's context on the next prompt and trigger background notifications, and `sessions_send` tells the agent not to promise polling or checking back later (#323)
- `genaicode ui` and the desktop app: developer transcript export in the chat header (`session …` menu), in **Chats** / **Sessions** rows (`⋯`), and in the desktop app's **Developer** menu — copy the full session ID, the session file path on disk, the Markdown transcript (metadata, turns, tool calls, diffs, approvals, questions, pack tasks, notices) or raw JSON state, or save/download `.md` and `.json` files (with a native Save dialog in the desktop app) (#322)
- The desktop app shows the installed version and what changed after an update. Reopen **What’s new** from the window header or run `genaicode whats-new` (#327)
- "Needs you now" also sees requests put as statements and yes/no gates dressed as offers: `SessionInfo.ending` has a new value `request` ("Confirm…", "Your call whether…", "Daj znać, czy mam…", "Musisz jeszcze…", "…jeśli potwierdzisz"), counted like a question for 3 days. On a real machine a 2-hour-old "let me know whether to push the release" sat among the stalled sessions, and about half of the checked waiting sessions with no signal were such requests (#324)
- Desktop app and `genaicode ui --home`: per-conversation working directories without a fixed project folder. Cross-project chats start in `~/.genaicode/home`; **New chat** on a topic card opens in that topic's most recent non-automated directory; continuing any local session (from Sessions, Chats, the menu bar or `/continue`) resolves its directory or repository root; and `open_project` lets an agent move a conversation into an existing or new directory after one confirmation card. The header shows the conversation title and topic instead of a path (hover or `/where` shows the directory), file panel and upload roots follow the conversation, and Codex asks to trust a new directory via a question card. `genaicode ui --cwd` behaves as before (#318)
- Save a project’s pack lead and workers from the desktop or web app. The CLI reuses that team and task cards suggest compatible workers when a fresh reading shows an exhausted quota (#325)
- Rich content across `genaicode ui`, the desktop app and `<AgentChat>`: unified resizable side viewer panel for both files and artifacts (with full-size mode, version switcher, **New tab**, **Download**, session **Artifacts** list, live in-place updates on republish, and panel-attached submit confirmation; `<AgentChat onOpenArtifact>` and exported `<ArtifactPanel>`) (#317)
- Rich file viewers and line jumping: `/api/file`, `/api/file/raw` and short-lived `/files/<id>` capability URLs stream text (with `:line` / `:line:col` / `#L12-L20` line highlighting via `onOpenFile(path, position?)`), rendered Markdown (with Source toggle), images (fit / actual size), audio, video (`Range` support), PDF (with external fallback on WebKitGTK), sandboxed HTML (with Source toggle), and binary downloads, enforcing `SECRET_DIRS`/`SECRET_FILE` filtering (#317)
- Dynamic multi-root file and artifact access: `ArtifactStoreOptions.cwd` and `createProjectFiles()` accept a list or function of allowed roots so `genaicode ui --sessions`, pack task worktrees and the desktop app serve files and `publish_artifact` paths from opened/sent session directories (resolving relative paths against the session's `cwd` first) (#317)
- Markdown images in replies (`![alt](target)`): local image paths resolve to lazy no-referrer thumbnails (`<AgentChat imageUrl>`) that open in the panel; remote `http(s)` images render a click-to-load chip by default so replies never trigger unsolicited requests (`<AgentChat remoteImages="load">` opts in); `data:` targets stay plain text (#317)
- Opt-in CDN hosts for HTML artifacts: `ArtifactStoreOptions.allowScriptHosts`, `genaicode ui --artifact-cdn <host>[,<host>]` and a desktop **Settings** control (off by default) add trusted hosts to HTML CSP `script-src`, `style-src` and `font-src` only while keeping `connect-src`, `img-src`, `media-src` and `form-action` closed, and inform the agent in the `publish_artifact` tool description (#317)
- Desktop app links, downloads and Reveal: `tauri-plugin-opener` with strict `http(s)`/`mailto` scheme filtering in `on_new_window` and `on_navigation` (opening external links and tokenless artifact **New tab** links in the system browser), native Save dialog + **Show in Finder / File Manager** in `on_download`, and `POST /api/reveal` / `<AgentChat onRevealFile>` (#317)
- `genaicode ui` and the desktop app: onboarding when no agent CLI is installed or signed in. The server starts in a `setup` state with `GET /api/agents` (presence, duplicate-install hints, broken-binary detection, and cheap local sign-in checks for Claude Code and Codex), showing per-agent install/sign-in cards with copyable commands, plan limits, and **Check again** while keeping session tools working. In the desktop app, **Check again** re-reads the login shell environment without restarting. The agent picker separates Ready/Installed agents from greyed signed-out ones (**Sign in**) and **More agents** (**Install**), and auth failures on a prompt render as a sign-in card in the conversation. New exports in `genaicode/agents`: `AGENT_GUIDES`, `agentGuide`, `findAllExecutables`, `inspectAgent`, `inspectAgents`, `createAgentInspector`, `isAgentUsable`, `isAuthError`; `<AgentChat renderFailure>` in `genaicode/react` (#316)

### Fixed

- `codexLive()` and `codexTurns()` read Codex's Plan-mode output (`item/plan/delta` and completed `plan` items) instead of dropping it (#328)
- Chat renders Markdown links with angle-delimited destinations, including paths with spaces or parentheses. The desktop file panel offers Reveal for linked project folders (#329)

### Internal

- A new release becomes the "latest" one on GitHub only after the desktop build has added its downloads, so `releases/latest/download/Genaicode-*` links no longer return 404 for the half hour after each release (#321)

## 3.1.0 — 2026-11-23

### Added

- `createAppAgent({ questions })`: pass `await startQuestionChannel()` and agents without a question tool of their own (Antigravity, Gemini, Muse, Codex outside Plan mode) get `ask_user`; their questions show as a card in `<AppAgentChat>` like Claude's (#313)
- "Waiting" is split into **needs you now** and **stalled**. Needs you now: an approval, or a last message that asked a question or gave a command to run in the last 3 days. Stalled: an offer to go on ("I can also…, if you want"), a report that could not be sent back, or an older question. Topics, `sessions --waiting`, the start screen and Sessions view of `genaicode ui`, and the desktop menu bar count only what needs you now; stalled sessions fold under their topic ("Show 2 stalled", a "Stalled" submenu). New `attentionOf()`, `isStalled()`, `TopicSummary.stalled`; `isAsking()` no longer counts offers and unsent reports (#315)
- `ask_user` and per-run MCP servers (`capabilities.mcp`) on Gemini CLI (`gemini()`, via a temporary `GEMINI_CLI_SYSTEM_SETTINGS_PATH` file) and Cursor CLI (`cursor()`, via a temporary `--plugin-dir`), plus `SessionState.canAsk` and `(no questions)` markers in the UI agent picker and `/agent` (#314)

### Fixed

- Codex in chat and the desktop app honors Ask first and Auto-approve for MCP tool calls, including Sessions and Pack, and shows the tool result or error message (#320)
- `ask_user` runs without a permission prompt on `museLive()` (auto-approving only `trusted` MCP server tools once via a shared trusted-tool matcher) and Copilot (`trusted` servers pre-allowed even with `allowMcpTools: false`, and `toolTimeoutSec` mapped to Copilot's `timeout` ms) (#314)

### Internal

- Added `scripts/ask-user-live.mjs` to live-verify `ask_user` across installed agents at 0 s and past 60 s (#314)

## 3.0.1 — 2026-11-23

**Genaicode 3 is a desktop app.** Run Claude Code, Codex, Antigravity and six more coding agents together, on the logins you already have: you give one prompt, a lead agent splits the work, the others take a task each, and you review the changes and merge. [Download it for macOS or Linux](https://grzegorz.tanczyk.pl/genaicode/), or `brew trust gtanczyk/genaicode && brew install --cask gtanczyk/genaicode/genaicode`. The command line and the TypeScript API stay: `npx genaicode`.

### Breaking

- Node.js 22.5 or newer is required, up from 20: session stores are read with `node:sqlite`, and Node.js 20 is past its end of life. The desktop app carries its own Node.js and needs none on the machine (#299)

## 2.54.0 — 2026-11-23

### Added

- Pack `delegate` takes `model`, `effort`, a short `title` and `mcpServers`: names of the lead's MCP servers to give the task (servers the task was given, plus those in Claude Code's own config: user, `.mcp.json` and local scope). `agents` lists each member's effort values. New `ownMcpServers()` / `claudeMcpServers()` and `PackOptions.shareableMcpServers`. Before, a delegated agent ran on its default model and without the lead's servers, so a task that needed e.g. the gamedevpl server failed (#303)
- Pack tasks panel in `genaicode ui`, the desktop app and `<AgentChat>`: each task shows a short title, a status chip, agent/model/MCP on one line, the result in its own box and the prompt folded; one task takes the whole width; the Approvals button shows only when something waits. Delegating agents are told to act on the request instead of asking to confirm a plan (#303)

### Fixed

- Desktop app: the loading screen shows the Genaicode wolf with a soft glow and a progress bar, in the chat page's light or dark colors, instead of plain "Genaicode / Starting…" text (#305)
- `ask_user` reaches the person on Codex and Antigravity: Codex no longer rejects the call (it asked for an MCP tool approval nobody answered), and Antigravity no longer shows a "Run mcp_genaicode_ask_ask_user" approval before the question. New `McpServer.trusted` for servers whose tools need no permission prompt. `AgentSession.approve()` refuses a decision other than `approve` / `deny` instead of dropping the request (#306)

## 2.53.0 — 2026-11-22

### Added

- `genaicode ui`, `chat` and the desktop app: when Claude Code or Codex asks you to choose (`AskUserQuestion`, `request_user_input`), the question shows as a card with its options, a field for an answer of your own, and Skip. In the terminal a number chooses and Enter sends. Before, Claude's question was a plain Approve / Deny request and came back unanswered (#300)
- `task.onQuestion` answers an agent's questions (requests of `kind: 'question'` with `questions`); `capabilities.questions` on `claude()`. `AgentSession.answer()`, `<AgentChat onAnswer>`, `claudeApprovalTool({ onQuestion })`; app agents answer through `POST /approvals/:id {answers}` and `<AppAgentChat>` shows the card. `auto-approve` does not answer questions (#300)
- `ask_user`: agents without a question tool of their own (Codex outside Plan mode, Antigravity, Gemini, Muse...) can ask you to choose too. `genaicode chat`, `ui` and the desktop app give them this MCP tool, and its questions show as the same cards. `startQuestionChannel()` + `createAgentSession({ questions })` for your own sessions. New: `capabilities.remote` (managed and hosted agents) and `McpServer.toolTimeoutSec` (Codex's `tool_timeout_sec`) (#302)

## 2.52.2 — 2026-11-22

### Fixed

- Desktop app's Homebrew cask: `brew info` no longer warns about the `verified` URL parameter and the `">= :ventura"` form of `depends_on macos`. The README says Homebrew 7 needs `brew trust gtanczyk/genaicode` before the install (#294)
- Desktop app: **Relaunch to update** no longer leaves a second Genaicode icon in the Dock. The new version starts only after the old one has quit; before, both ran for a moment and the Dock gave the second one its own icon (#298)

### Internal

- Sessions doctor tests remove their temporary HOME folders, so runs no longer leave empty `genaicode-doctor-*` folders in the temp directory (#298)

## 2.52.1 — 2026-11-22

### Fixed

- Desktop app: it looks for a newer version every half hour, not every six hours, so a release shows as **Relaunch to update** soon after it comes out (#292)

## 2.52.0 — 2026-11-22

### Added

- `genaicode chat`, `ui` and `tower --delegate`: every agent may hand work to the other installed agents through the pack tools, so a delegated agent's approvals come to the chat. Before, asked for a second opinion from Antigravity, Claude started `agy` from its shell, where Antigravity could not ask and came back empty. The desktop app turns it on. A turn that delegates nothing looks as before (#288)
- `pack()`: a delegated agent's commands that only read inside its directory, a git repository (`ls`, `cat`, `rg`, `git log`, `git diff`...), pass without asking; `readOnlyCommands: 'ask'` keeps asking. `delegate` takes a `cwd` for work in another directory. `isReadOnlyCommand()` and `delegationBrief` are exported (#288)
- `genaicode ui` and the desktop app: **New chat** in the header starts a new conversation with an empty screen (`/clear` in `chat` too), and in the desktop app **Chats** lists the conversations you had in the app itself, apart from the sessions of every agent. `AgentSession.clear()` (#291)
- Desktop app: it comes back to the conversation it had last, with its history, after a restart or an update. `genaicode ui --restore` does the same for any directory (#290)
- Desktop app: an update says what it is doing: **Downloading update…** while it downloads and **Relaunching…** while it installs, in the window's header and in the menu bar (#290)
- `sessions_send` queues a message for a session that is working right now, instead of refusing it: the tool answers "Queued", the chat says so, and the message goes as that session's next turn once the current one ends, several in order (#287)

## 2.51.0 — 2026-11-22

### Added

- Desktop app: an update downloads quietly and waits as **Relaunch to update** in the window's header and in the menu bar, instead of a dialog that interrupts. Nothing installs before you choose it. An app that starts `genaicode ui --exit-with-stdin` can offer the same by writing `update-ready <version>` to its stdin (#285)

### Fixed

- Desktop app: **Check for Updates…** in the minutes when a new release exists but its app is still being built says so, instead of the error "Could not fetch a valid release JSON" (#285)

## 2.50.0 — 2026-11-22

### Added

- Desktop app for Linux: each release carries an AppImage (it updates itself) and a `.deb` for x86_64. The panel icon with the waiting sessions works where the desktop shows status icons; the package installs `genaicode-desktop` and leaves the `genaicode` command and the system's Node.js alone (#284)
- Desktop app for Intel Macs: a second `.dmg`, beside the one for Apple silicon (#284)
- Desktop app from Homebrew: `brew install --cask gtanczyk/genaicode/genaicode`. Each release also carries its downloads under names without the version, so `releases/latest/download/Genaicode-macos-arm64.dmg` is always the newest (#284)
- `genaicode ui` and the desktop app: with no agent CLI installed they no longer stop with an error. The page lists the agents genaicode can use, the command that installs each and how to sign in, and opens the chat by itself once one is found (#283)
- Desktop app: it has no project folder any more. It works where your agents work: no folder question at start, no Project menu, and its chat is about the sessions of every project. `genaicode ui --sessions --no-project` gives the same page in a browser (#281)

## 2.49.2 — 2026-11-22

### Fixed

- Session tools: their instructions tell the agent to look at the sessions first when asked what is going on or how work is progressing, and at files and git after that. In the desktop app the agent answered such a question from git alone, because Claude Code keeps most of these tools behind a tool search (#279)

### Internal

- Desktop app: a release workflow builds the macOS app after each npm release, signs it with the Developer ID certificate, has Apple notarize it and adds the `.dmg` to the GitHub Release. It runs once the Apple secrets are in the repository (#276)
- Desktop app: its name is Genaicode, with a capital letter (the app, its window and its menu bar items), and a second launch shows the app that already runs instead of starting another (#277)
- Desktop app: it updates itself. It looks for a newer version at start, every six hours and on **Check for Updates…**, offers it, and installs it only when told to. The release workflow adds the signed archive it updates from and `latest.json` to each GitHub Release, once the `TAURI_SIGNING_PRIVATE_KEY` secret is set (#278)

## 2.49.1 — 2026-11-22

### Fixed

- `genaicode ui`: the row under the prompt field is lighter. The line of key hints under it is gone (they are a tooltip on the field), the bark button left the row (`/bark` stays), and the model and effort controls take less room. `<AgentChat composerTitle>` sets such a tooltip for a host (#275)
- `genaicode chat`, `ui` and `tower` run Codex without its plugins too (`features.plugins=false`): a plugin from a remote marketplace started an MCP server that `codex mcp list` does not name, so it could not be switched off alone. The plugins' skills go with them; `--agent-mcp` keeps both. The same holds for `onlyTaskMcpServers` of the `codex` and `codexLive` drivers (#273)

### Internal

- Desktop app (macOS): one title line. The window's buttons sit in the header of the page instead of in a title bar above it; the header moves the window and zooms it on a double click (#271, #272)

## 2.49.0 — 2026-11-22

### Added

- `/effort [level|default]` in `genaicode chat`, `ui` and `tower` changes the reasoning effort from the next prompt, and the browser has an effort picker in the row under the prompt field for an agent that takes one. `AgentSession.setEffort()` does it for a host; switching to an agent that does not know the level goes back to that agent's default (#269)
- `genaicode chat`, `ui` and `tower` run Codex without the MCP servers of its own config, which it would start with every turn; `--agent-mcp` keeps them. `codexLive({ onlyTaskMcpServers })` does it for the live driver (`'when-listed'`: a Codex that cannot list its servers keeps them, with a note), and `liveAgent`'s `prepare` may be async (#267)
- `genaicode chat`, `ui` and `tower` run Codex over its live driver (`codexLive`), as a pack already did: "Ask first" asks before a step outside the sandbox, a message sent mid-turn steers the run, Codex's plan limits show, and an edit by Codex shows its diff. `genaicode run` keeps the headless driver (#266)
- `<AgentChat>`: an edit an agent reports as changed files (Codex) shows its diff like an edit step, and a link to a file in a reply (`[a.txt](/path/a.txt)`) shows as its label and opens the file with `onOpenFile`. The `file-change` event and the session `files` entry take an optional `diff` (#265)
- `genaicode ui`: the plan limits, agent, model, approval mode and the attach button sit in one row under the prompt field, which holds the text and Send only. `<AgentChat composerExtras>` renders in that row, with the attach buttons (#264)
- `genaicode ui`: the path of a file the agent edited or read opens the file beside the chat (text files inside the project only). `<AgentChat>` takes `onOpenFile` to make those paths buttons, and `toolPath` is exported from `genaicode/react` (#262)
- `<AgentChat>`: a step that edits a file shows what it changed, added and removed lines, when opened, with the counts on its line. `toolDiff` is exported from `genaicode/react` (#261)
- `genaicode ui`: the agent, the model, the approval mode and the plan's limits sit in the prompt box instead of the top bar, and files can be attached, pasted or dropped on the chat (kept in `.genaicode/uploads/`, their paths go to the agent). `<AgentChat>` takes `composerExtras` for host controls in the composer (#260)
- `<AgentChat completions>` offers the host's commands while the user types one (arrows, Tab or Enter to complete, Escape to close), and `genaicode ui` lists its `/` commands that way (#259)
- The start screen of `ui --sessions` (the desktop app) says, under each agent's plan limits, which topics that agent's work of the last 7 days went to, in percent; `topicShares()` in `genaicode/agents` computes it (#258)

### Fixed

- The start screen's topic shares no longer read a long Codex rollout from its start every time: what was read is kept under `~/.genaicode/cache/rollouts`, and a later look reads only what the rollout gained (a 2 GB thread took about 9 s per look). `partsSince(sessions, since, { env })` says where home is (#270)
- `genaicode ui`: "Its work in the last 7 days went to" counts only what each session did in those days. A long session touched once in the period no longer counts with its whole life (read from Codex rollouts and Claude Code transcripts, estimated from the lifetime elsewhere). `topicShares` takes these parts from the new `partsSince()` (#268)
- `genaicode ui`: the agent, model and approval controls in the prompt box have an outline, so they read as controls. A note Codex sends about a hook timeout it clamps no longer shows as an error in the conversation (it is a `stderr` event) (#263)
- Sessions a program started in a temporary directory or in a `.genaicode/worktrees` worktree, and Antigravity command-line runs outside any project, no longer show in session listings or topics (`sessions --automated` lists them) (#256)

## 2.48.0 — 2026-11-21

### Added

- `ui --sessions` (the desktop app) opens an empty chat on your topics: those that wait for you, those agents work on now, and each agent's plan limits; a topic opens its sessions (#254)

## 2.47.0 — 2026-11-21

### Added

- `sessions_send` in `chat --sessions` and `ui --sessions` (the desktop app): ask the agent to tell another session something and it sends it there; the first message to each session waits for your approval in the chat, and the chat shows the answer (#253)
- `genaicode sessions send` refuses in a shell that a coding agent runs, so prompts to other sessions come from a person; `--force` sends anyway (#247)
- The desktop app starts its chat with the session tools (`ui --sessions`), so the agent answers what goes on in a project from the session index (#251)
- `genaicode ui` and the desktop app fold a turn's tool calls into one "N steps" line that opens on click; the answer, errors and open approvals stay in view (#251)
- The browser's Sessions view groups sessions by topic once `genaicode topics refresh` has sorted them (those that ask for you first; **By directory** brings projects back), and the header shows the chosen agent's plan limits as `genaicode limits` last saw them, without a price when a plan limit is known (#251)
- `genaicode sessions --waiting --json --watch` carries the topics: each session the name of its `topic`, and the line `topics` (name, sessions, asking, active). The desktop app's menu names a waiting session by its topic and lists the topics agents work on now (#250)
- `genaicode topics refresh` puts the sessions that worked in a directory of a Codex desktop app project in a topic named as that project, whichever agent they were in (`codexProjects()`, `folderTopics()`), after the claude.ai projects and before any agent is asked; the agent is told to keep topics few and broad (#248)

### Fixed

- `sessions --waiting --json --watch` (the desktop app's menu bar) lists only the sessions that ask now, not every session whose turn ended; `hooks status` says `broken` when the Node its hook was installed with is gone (#252)
- `genaicode hooks install` gives Codex's `SessionEnd` hook the three seconds Codex allows, so Codex no longer warns about it in every session (#251)
- `genaicode topics` lists topics without their directories, and with names up to 48 characters (#248)
- Threads the Codex desktop app's server ran for another program, and Muse Code's probes and test-provider sessions, count as automated (#248)

## 2.46.0 — 2026-11-21

### Added

- Pack task cards let you request an independent review, test an isolated copy of the worker's files and see when either result is outdated before merging (#239)

### Fixed

- `replyEnding()` strips trailing punctuation/emoji and inspects the closing clause in linear time, eliminating polynomial regex backtracking on long whitespace runs (#245)

## 2.45.0 — 2026-11-21

### Added

- `genaicode topics refresh` puts the sessions Claude Code ran for a claude.ai project (`SessionInfo.project`, read from the session) in a topic named as that project, without asking an agent (`projectTopics()`); `--again` sorts everything anew (#244)

### Fixed

- Fewer machine-made sessions in listings and topics: Claude Code's `turnOrigin` is read, and single-prompt headless runs count as automated; what ran in a pack worktree or a temporary directory takes no topic; a topic asks for you only for approvals and for 3 days after a message asked something (#244)
- `genaicode topics refresh` says how many runs it takes and how far it is after each one, and gives sessions that say the very same thing (the hundredth run of one prompt) a single line, so there are fewer runs (#242)

## 2.44.0 — 2026-11-21

### Added

- `genaicode topics`: your sessions as pieces of work, whichever agents and directories they were in, with what asks for you first. `topics refresh` has an agent sort the sessions no topic has yet (one line per session; kept in `~/.genaicode/topics.json`), and `topics rename|merge|move` correct it. From `genaicode/agents`: `topicsPrompt()`, `sortedTopics()`, `summarizeTopics()`, `readTopics()`, `writeTopics()` (#241)
- `genaicode sessions` leaves out the sessions nobody typed into (Claude Code's scheduled tasks and notifications, `codex exec` runs; `--automated` or `{ automated: true }` lists them, and they carry `automated: true`), and says what a waiting session's last message asks of you: `SessionInfo.ending` (`question`, `command`, `offer`, `unreported`) from `replyEnding()`. `sessions --waiting`, the session tools and the desktop menu show those right after the approvals (#240)
- `genaicode limits`: how much of each agent's plan is used (share of each window, when it resets), as last seen and without asking any agent. Runs through genaicode keep what the agents report, Codex's limits are read from its sessions, and `genaicode hooks install` makes `genaicode limits record` Claude Code's status line (unless you have your own), which keeps Claude's. `sessions --waiting --json --watch` carries them as `limits`, and the desktop app's menu shows them (#235)
- `claude()` inherits `permissions.defaultMode` from Claude Code user settings (`~/.claude/settings.json` / `$CLAUDE_CONFIG_DIR`) or `options.settings` instead of overriding it with `--permission-mode acceptEdits`, keeping `acceptEdits` as the fallback when no default mode is configured (#238)

### Fixed

- `genaicode ui` (and `chat --web` / `tower`) strips `?token=` from the browser address bar into origin-isolated `sessionStorage`, sends the token in headers for `/api/events` and commands, and keeps reloads working via a reload-only `HttpOnly` shell cookie (#236)

## 2.43.0 — 2026-11-21

### Added

- `<AgentChat>` (`onAutoApprove`) and the browser UI show an **Auto-approve all** button right on permission requests, matching the terminal chat's `a` shortcut to approve pending and future requests in one click (#234)

### Fixed

- `sessions --waiting --json --watch` reads every agent's session store on each fifth look only, and at once when a hook reports something new, so a watch left open uses far less CPU (#232)

## 2.42.0 — 2026-11-21

### Added

- `genaicode chat --pack`, `ui --pack` and `tower --pack` work without an explicit `lead:members` value, automatically assembling a pack from all installed agents (first MCP-capable one leads, or pass `-a <lead>` to choose the lead) (#226)
- `genaicode sessions --waiting --json --watch`: stays open and prints the waiting sessions as one JSON line whenever they change, for programs that show them; `--exit-with-stdin` ends it with its parent (#231)
- `npx genaicode install`: installs the `genaicode` command that updates itself, the same as the shell installer, with `--version`, `--bin-dir` and `--force` (#225)

### Fixed

- Pack tasks work in projects opened through a symlink, and the browser explains merge conflicts when running the installed CLI (#229)
- `genaicode update`, `genaicode install` and `scripts/install.sh` revalidate npm's local package cache (`--prefer-online --no-prefer-offline`) so installing a newly published release no longer fails with `ETARGET` (#230)

### Internal

- Desktop app: a menu bar icon lists the sessions that wait for you, with Approve and Deny for open questions; closing the window keeps the app in the menu bar (#231)
- First skeleton of a macOS desktop app in `src/desktop` (Tauri 2 shell that runs a bundled Node.js on `genaicode ui`); not part of the npm package (#228)

## 2.41.1 — 2026-11-21

### Fixed

- Browser pack task actions return public refusal reasons (`PackActionError`) instead of raw exception messages from git, drivers or the filesystem (#223)

## 2.41.0 — 2026-11-21

### Added

- `genaicode tower --pack` brings pack and session approvals into one inbox and lets you review, send or dismiss each message the lead proposes for another session (#221)

## 2.40.0 — 2026-11-20

### Added

- `genaicode tower` opens an indexed chat with waiting sessions across projects. Use `/waiting [project]` to refresh the queue and `/read <id>` to preview a conversation locally (#217)
- The waiting queue and browser Sessions view show up to 200 characters of a shell command awaiting approval in GitHub Copilot CLI or Gemini CLI (#219)
- `genaicode chat` and `ui` accept `--pack claude:codex,gemini` to follow delegated tasks, answer approvals, steer a worker and review or merge its changes from either view (#220)

## 2.39.0 — 2026-11-20

### Added

- Ask “Which sessions need my attention?” in `genaicode chat --sessions`. The new `sessions_waiting` MCP tool lists pending approvals and replies across projects, including open questions (#215)

## 2.38.0 — 2026-11-20

### Added

- `genaicode sessions send <id> "<prompt>"` and **Reply** in the browser's Sessions view resume a waiting local conversation in its original agent and directory. The CLI streams the reply or runs in the background with `--detach` (#213)

## 2.37.1 — 2026-11-20

### Fixed

- Control tower fixes from a run on macOS: `--help` after any command shows the help; `hooks uninstall` removes a hooks file (and Copilot's hooks folder) left with nothing but genaicode's; `hooks install -a <agent>` says when that agent's CLI is not found; sessions with a zero time (Antigravity) no longer show as thousands of days old; `sessions --waiting --json` carries the open questions (`asks`); `hooks status` counts open and ended sessions apart (#211)

## 2.37.0 — 2026-11-20

### Added

- What waits for you, across agents: `genaicode sessions --waiting` (`-w`) lists only the sessions whose next move is yours, approvals first, each with what it asks or said and the command that continues it (last 7 days unless `--since`); the browser's Sessions view gets a "N wait for you" button with the same order; `waitingSessions()` in `genaicode/agents` (#206)
- `genaicode notify on`: with the hooks installed, a desktop notification (macOS Notification Center, `notify-send` on Linux) when a session of Claude Code or Codex asks for approval, once per question; `--done` also when a session finishes its turn; `notify test`, `notify off`. It names the agent, the project and the tool only. In code: `noticeFor()`, `sendNotice()`, `readNotify()`/`writeNotify()` and `recordHook({ onRecord })` (#207)
- Answer approvals from the tower: `genaicode hooks install --answer` holds each approval question of Claude Code open (up to 9 minutes) while its own dialog shows it, so `genaicode sessions approve <q>` / `sessions deny <q> -m <why>` or the browser's Sessions view (Approve / Deny under the session) can answer too; `sessions --waiting` lists the questions with what the tool would do. In code: `pendingAsks()`, `answerAsk()`, `waitForAnswer()` (#208)
- `genaicode hooks install` also for Gemini CLI (`~/.gemini/settings.json`), GitHub Copilot CLI (`~/.copilot/hooks/genaicode.json`) and Cursor's CLI (`~/.cursor/hooks.json`): their sessions show as working, waiting or (Copilot, Gemini) asking for approval in `sessions`, `--waiting`, the browser and `notify`. `hookInput()` puts their hooks' input in Claude Code's words (#209)
- `genaicode sessions archive --stale` (`--older 5d`) puts away the sessions left waiting or half way for days, `sessions archive <id...>` / `unarchive` one by one, `sessions --archived` lists them; the browser's Sessions view has Archive / Unarchive, "Archive N stale" and an Archived filter. Agents' files are untouched (`~/.genaicode/archived.json`) and a session with news comes back by itself. In code: `archived` on `SessionInfo`, `archiveSessions()`, `staleSessions()`, `readArchive()` (#210)

### Fixed

- `chat --sessions` and `sessions mcp`: the session index now tells the agent when to use it (MCP `instructions`), so a question like "which sessions are open?" goes to `sessions_list` for every agent instead of the agent's own session listing; `startLocalMcpServer({ instructions })` does the same for your tools (#204)

## 2.36.0 — 2026-11-19

### Added

- An installer for the `genaicode` command (`curl -fsSL https://raw.githubusercontent.com/gtanczyk/genaicode/master/scripts/install.sh | sh`) that keeps itself up to date: once a day a background check installs a new version beside the running one; `genaicode update [--check] [--version <v>] [--auto on|off]` updates by hand and prints the release notes (#202)
- Ask an agent what is open across all of them: `genaicode chat --sessions` (and `ui --sessions`) gives the chat's agent the session index as MCP tools (`sessions_projects`, `sessions_list`, `sessions_read`), and `genaicode sessions mcp` serves them to any agent on stdio. In code: `sessionTools()` and `serveMcpStdio()` in `genaicode/agents` (#201)

## 2.35.1 — 2026-11-19

### Fixed

- Copilot CLI sessions that were opened and left with nothing said (no event log, unknown to the CLI's index) are no longer listed, so `sessions doctor` no longer reports Copilot's store as broken because of them; the Cursor reader is stamped as checked with Cursor agent 2026.10.22 (#199)

## 2.35.0 — 2026-11-18

### Added

- `pack({ lead, members })` in `genaicode/agents`: one agent over the installed ones. The lead delegates to the others in parallel git worktrees through MCP tools and merges their work; new `subtask-start`, `subtask` and `subtask-update` events (#184).
- `listSessions()` and `genaicode sessions`: one list of the sessions coding agents keep on this machine, grouped by project, with state (active, waiting for you, unfinished), latest prompt and the id to resume. Every driver names its store in `agent.sessions` (Claude Code, Codex, Copilot, Cursor, Gemini CLI, Antigravity, Muse, Vibe; `null` for opencode); SQLite-backed stores require Node 22.5+ (`node:sqlite`), and `SessionSource` is the seam for vendor clouds (#186).
- `listSessions()` reads vendor clouds too: `anthropicManaged` lists its agent's sessions and `cursorCloud` the account's Cloud Agents (`where: 'cloud'`, with a link to open them); `geminiManaged`, `openaiManaged` and `hostedAgent` say `sessions: null`, as their APIs list nothing (#187).
- `genaicode ui` and `chat --web`: a Sessions view in the browser lists every agent's sessions by project, with search, filters by agent, state and period, and the command that continues each one (#188).
- Continue a session in another agent: `--from <session id>` in `genaicode chat`, `ui` and `run`, `/continue <id>` in the chat and **Continue here** in the browser's Sessions view bring a Claude Code or Codex session into the chat; its own agent resumes it, any other gets a recap and the transcript. In code: `SessionSource.read()`, `readSession()`, `findSession()` and `AgentSession.adopt()` (#189).
- Sessions of Gemini CLI and Copilot CLI can be taken over too (`--from`, `/continue`, **Continue here**): their sources have `read()`, with `geminiTranscript()` and `copilotTranscript()` (#190).
- Sessions of Muse, Antigravity and Vibe can be taken over too (`museTranscript()`, `antigravityTranscript()`, `vibeTranscript()`); Copilot CLI sessions without an event log are read from its `session-store.db`, and its tool results are kept; `SessionSource.find()` lets `--from` look a Claude Code session up by id without reading every transcript (#191).
- `genaicode hooks install`: Claude Code and Codex report through their own hooks what a session does, so `listSessions()`, `genaicode sessions` and the Sessions view show which sessions ask for approval (`waitingFor`, `waitingTool`) and which finished their turn; `installHooks()`, `recordHook()`, `readLive()`, `withLive()` in `genaicode/agents` (#192).
- `genaicode sessions doctor` and `checkSessions()`: per session store, how many sessions it lists, how many have a prompt and a directory, whether the newest conversations open, and whether the agent's CLI is newer than the one the reader was checked with (`SessionSource.verified`). Counts only; exits 1 when a store reads differently than expected (#193).
- Codex sessions can be asked of Codex itself: `codexSessions({ via: 'app-server' | 'auto' })` or `GENAICODE_CODEX_SESSIONS=app-server` lists and reads through `codex app-server` (`thread/list`, `thread/turns/list`), falling back to the files; `genaicode sessions doctor --api` compares what the files gave with what Codex lists. `openCodexServer()`, `codexThreads()`, `readCodexThread()` exported. The files stay the default (#194).

### Fixed

- OpenAI: `openai()` runs on the Responses API, so function tools work on GPT-6 models (`gpt-6.2-astra`, `gpt-6.2-sol`), which reject them on chat completions; `openai({ api: 'chat' })` keeps chat completions (use it or `openaiCompatible()` for chat-completions-only `baseURL` proxies). Temperature is left out for reasoning models (o-series, GPT-5 and later), which accept only their default. `raw` is now the Responses API `Response` (#183).
- Gemini: `thinking: false` and JSON responses work on Gemini 3.7+, Gemini 3.8 Flash and Gemini 4 (`gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen`), which reject the `MINIMAL` thinking level: they now get `LOW` (#182).

## 2.34.0 — 2026-11-18

### Added

- `withFallback()` gains `info()` and `forget()` when its agents have them, and `nano()` gains `info()`: `createPageAgent({ agent: withFallback([...]) })` shows what the agent that runs first takes (image attachments where the model does) and when an agent over its allowance is back, and "New" clears every agent's conversation (#177).
- `managedAgent()` and `ManagedProvider` in `genaicode/agents`: one contract for hosted agent platforms whose sessions outlive the process (Anthropic, Gemini, OpenAI and Cursor managed agents). Sessions are addressed by id (`start`, `get`, `events` or a live `watch`, `send`, `answer`, `interrupt`, `release`, `delete`), report usage and cost, pass `task.budget` to the platform's own cap (a stop there fails with `failure.kind: 'budget'`) and bring approvals back to `task.onApproval`. `hostedAgent()` now runs on it (`fromHosted()`) (#174).
- `anthropicManaged()` in `genaicode/agents`: tasks run as Claude Managed Agents sessions of an agent and environment you created once. Text streams live, `steer()` and `abort()` reach the session, paused tool calls come back as approvals, `task.budget.maxCostUsd` becomes the session's list-cost cap, `resume` continues a session, MCP bearer tokens go into a per-session vault, files and `https://github.com/...` workspaces are mounted, and custom tools run through `tools` handlers. Pass a client from an `@anthropic-ai/sdk` with `beta.sessions` (#178).
- `geminiManaged()` in `genaicode/agents`: tasks run on Gemini Managed Agents (Antigravity) through the Interactions API, on the Gemini API or Gemini Enterprise Agent Platform. Steps stream live and resume after a drop, `abort()` cancels the interaction, `resume` chains the next turn in the same environment, MCP servers go along with their headers, `task.budget.maxTokens` becomes the interaction's token cap, and files and git repositories are mounted in a fresh sandbox (#179).
- `openaiManaged()` in `genaicode/agents`: tasks run as OpenAI background responses with hosted tools (a hosted shell in a container kept for the session, web search, or your own list). Output items are polled in order and reported as messages and tool calls, `abort()` cancels the response, `resume` chains the next response, MCP servers go along with their bearer token, and `effort` and `maxTurns` map to `reasoning.effort` and `max_tool_calls` (#180).
- `cursorCloud()` in `genaicode/agents`: tasks run as Cursor Cloud Agents on a repository or pull request. The agent keeps one session id across turns (`resume` sends a follow-up run), its run streams live and resumes after a drop, `steer()` and `abort()` reach the running turn, MCP servers go along with their headers, and usage is the agent's total (#181).
- `genaicode/backend`: a model behind your server for the page agent. `createAgentBackend()` runs the tool loop on any `genaicode()` client, hands page-tool calls to the page and runs server tools for the signed-in user, keeps the conversation in an encrypted token (or a `store`), and holds costs with output, step, conversation and daily limits (`memoryLimiter()`); `handle(request)` takes a web `Request`, `toNodeListener()` serves Node. In `genaicode/browser`, `remote({ url, tools })` is its driver and `withFallback` is exported, so a page can fall back between the server and Gemini Nano (#175).

### Fixed

- Gemini: a tool call's `thoughtSignature` now goes back with it in the history (`ToolCall.signature`), so Gemini 3 accepts the next step of a tool loop; a streamed reply keeps the tool calls and images of every chunk, not only the last one's (#175).

## 2.33.0 — 2026-11-12

### Added

- `genaicode/browser`: an agent that runs in the web page on the browser's built-in model (Gemini Nano through Chrome's Prompt API), with no server and no key. `nano()` is a `CodingAgent` that calls page tools through schema-constrained choices, `createPageAgent()` is the conversation (approval of `write` tools, model download, context use), `exposeWebMcp()` offers the same tools to outside agents over WebMCP and `webMcpTools()` reads them back; `<PageAgentChat>` and `usePageAgent` in `genaicode/react` draw it (#168).
- Files in the page agent: `PageAgent.send(text, files)` and `nano().run({ attachments })` read text files into the prompt and hand images and audio to the browser's model where it takes them (`nano({ inputs: ['image', 'audio'] })`, `inputs()`, `state.model.inputs`). `<AgentChat attachments>` adds an attach button, paste, drop and a voice-message recorder to the composer (`onSend(text, files)`), and draws a turn's `attachments`; `<PageAgentChat attachments>` turns it on for the kinds the model takes (#171).

### Fixed

- `<AgentChat attachments>`: the message field takes the whole width of the composer and the attach, record, Stop and Send buttons sit in a row under it, instead of squeezing the field between them (#172).
- `nano()` asks each schema-constrained step on a copy of the model session (`clone()`): Chrome keeps a session's first `responseConstraint`, so the arguments call failed with `UnknownError` on Gemini Nano and fell back to a slow answer in words (#171).
- `nano()` (`genaicode/browser`) survives Chrome's `UnknownError` on a schema-constrained call by asking the model in words, retries a reply that failed before its first word, names the failed step in the error and reports each model call through `onModelCall` (#170).

## 2.32.0 — 2026-11-11

### Added

- Artifacts take audio and video (a player in the card; `artifactResponse(artifact, body, { range })` now returns a `status` and answers `Range` so players can seek; `maxMediaBytes`, `maxTotalBytes`), a published page can send the user's answers back to the agent (`parent.postMessage({ genaicode: 'submit', data }, '*')`, confirmed on the card; `<AgentChat onArtifactSubmit>`, `artifactSubmission()`), and an agent that takes over after a switch or failover is told what was published, by `name`, with the content of pages that exist nowhere else (#166).

## 2.31.0 — 2026-11-11

### Added

- Artifacts: agents with MCP support get a `publish_artifact` tool to show the user a self-contained HTML page, an image or a document. `startArtifactChannel()`, `createArtifactStore()`, `artifactResponse()` and `createAgentSession({ artifacts })` (an `artifact` transcript entry) in `genaicode/agents`; `<AgentChat artifactUrl renderArtifact>` shows a card with a sandboxed preview; `genaicode chat` and `ui` have it on by default (`--no-artifacts`) (#162).
- App agents publish artifacts too: `createAppAgent({ artifacts: true })` offers `publish_artifact`, `createAppAgentHandler` serves `GET <basePath>/artifacts/:id` sandboxed and behind `authorize`, and `<AppAgentChat>` shows the cards (`renderArtifact` to replace them) (#164).

## 2.30.0 — 2026-11-07

### Added

- Opt-in failover between agents: `result.failure` (`quota`, `auth`, `unavailable`, `crash`, `budget`), `shouldFailOver()`, `withFallback([...agents])`, `createAgentSession({ fallback })`/`setFallback()` with a `failover` transcript entry, `createAppAgent({ fallback })`/`configure({ fallback })`, and `run|chat|ui --fallback` plus `/fallback` in the chat (#160).
- Switching agents keeps the conversation: after `AgentSession.setAgent()` (and `/agent` in `genaicode chat` / `ui`) the next agent's first prompt carries a recap of the turns it missed plus the path of a full Markdown transcript in `.genaicode/handoff/` in the cwd; switching back resumes the agent's own session and tells it only what it missed. Opt out with `setAgent(agent, { handoff: false })`, `handoff: false`, or `/agent name --fresh`.

## 2.29.0 — 2026-11-07

### Added

- `rate-limit` events report plan limits (Claude's 5-hour/weekly windows, `codexLive` rate limits; any quota error as `window: 'quota'`), and `task.budget` (`maxTokens`, `maxCostUsd`, `warnAt`) emits `budget-warning` then stops the run; sessions take `budget` and keep `state.rateLimits`, `<AgentChat>`/`chat`/`ui` show limit chips, and `run|chat|ui` take `--max-tokens`/`--max-cost` (#157).

## 2.28.1 — 2026-11-04

### Fixed

- `antigravity()` tool calls show what they act on: MCP tools are named `mcp__<server>__<tool>`, arguments gain `path`/`command`/`description`, and a `read_file` shows the lines it read.

## 2.28.0 — 2026-11-04

### Added

- `antigravity()` drives `agy acp` with `task.mcpServers`, `task.resume`, `steer()`, and `onApproval` (#151).

## 2.27.0 — 2026-10-30

### Added

- The app agent chat can dismiss settled action cards.

Earlier versions: [changelog-2.26-and-older.md](changelog-2.26-and-older.md) and the git tags.
