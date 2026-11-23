# Changelog

One line per change, written for someone upgrading `genaicode`. The category decides the next
version: **Breaking** bumps major, **Added** bumps minor, **Fixed** bumps patch, **Internal** never
releases. A PR that changes `src/` (tests excluded) must add a line under `## Unreleased`, or CI
fails. Merging to master refreshes the `release` PR; merging that publishes to npm. See
[AGENTS.md](../AGENTS.md#changelog-and-releases).

## Unreleased

### Added

- The desktop Help menu, browser UI and terminal help link to support and bug reports (#331)

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
