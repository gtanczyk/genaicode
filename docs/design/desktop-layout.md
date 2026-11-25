# Desktop window layout with sidebars

Status: implemented. All 13 steps of the [PR breakdown](#proposed-pr-breakdown) are merged; the
text below is revision 2 of the proposal (after three design reviews and the owner's direction; see
[Changes after review](#changes-after-review)) and is kept as the record of the design. Where the
code and this document differ, the code and `docs/cli.md` are right. Not built: the **To** chip and
`@t9` in the composer, bulk **Approve all** / **Merge all**, the "Open the work panel when work
starts" and "Auto-approve all by default" settings; the open questions at the end stay open.

Mockup: [`desktop-layout.html`](./desktop-layout.html), one self-contained file. Open it from disk;
the dark bar at the bottom switches states and is not part of the design. A state can be linked:
`desktop-layout.html#scn=big&theme=dark&task=t3` (`scn` is `new`, `chat`, `tasks` or `big`; `page` is
`inbox`, `sessions` or `settings`; `tab` is `live`, `tasks`, `changes` or `artifacts`).

## Why

The window of desktop 3.3.0 is a header with two rows of pills over one chat column. Everything that
is not the conversation competes for those two rows. The work of a lead agent sits inside the
transcript as a card that grows with every delegated task, and it does not say what a task is doing:
a running task shows `Now  tool Read`, and a message sent to it disappears without a trace.

Claude desktop, the Codex app and Antigravity share one shape: navigation on the left, the
conversation in the middle, the agent's work on the right. This proposal takes that shape and then
goes past it in the one place where genaicode is different: a person here follows many agents at
once. Three things carry that:

1. **Readable live activity.** Every running task says what it does in words: a verb and the file or
   command (`Editing src/react/work-panel.tsx +18 −4`, `Running npm test -- tower · 14s so far`), and
   its latest message. In the task row, in the task's detail and in the Live tab.
2. **Messages to a running task have receipts.** A message to the lead or to one task shows
   `Sending…`, then `Delivered` once the agent took it, then `answered` when its next message comes;
   or `Queued` for an agent that cannot take input mid-turn, or `Not delivered` with Send again.
3. **A mission strip above the message box.** The team's counts by state and the next decision that
   waits for you, with Approve and Deny, are always in reach, at every width, with the panel closed.

## Layout

```
┌──────────────┬──────────────────────────────────────┬─────────────────────┐
│ Sidebar      │ Top bar: title / project    ⋯  Work  │ Live Tasks Changes  │
│  New chat    ├──────────────────────────────────────┤ Artifacts           │
│  Search      │                                      ├─────────────────────┤
│  Needs you   │ Chat                                 │                     │
│  All sessions│  (one line per work card, task ids   │ Work panel          │
│  Chats       │   are links)                         │                     │
│   by project ├──────────────────────────────────────┤                     │
│  Other agents│ Mission strip: counts · next approval│                     │
│ ──────────── │ Composer                             │                     │
│  Update      │  To · agent · Plan · mode · Stop Steer                     │
│  Quota       │                                      │                     │
│  Settings Help                                      │                     │
└──────────────┴──────────────────────────────────────┴─────────────────────┘
   268 px / 56 px rail      flexible, at least 600 px      420 px, 380 px to half the window
```

### Words

One meaning each, everywhere in the window:

- **Project**: a directory. The sidebar groups chats by it; the top bar and the new chat name it.
- **Topic**: a piece of work that can cross directories and agents (`genaicode topics`). The start
  screen lists and Usage are by topic and say so.
- **Team**: the lead and workers saved for one project (`.genaicode/pack.json`). Settings › Team.

### Left sidebar

Collapsible with ⌘B to a 56 px icon rail; the state is remembered per window. Below 980 px the rail
is the default.

On macOS the window buttons are drawn by the system at the top left and cannot move. With the full
sidebar they sit in its top strip, left of the brand. With the rail they overhang it, so the rail's
top 46 px stay empty and the top bar starts 88 px from the window edge, with the **Show sidebar**
button first.

- **New chat** (⌘N), **Search** (⌘K).
- **Needs you**, with a count across all projects (the tooltip adds "N in this chat").
- **All sessions**: the Sessions view of today, as a page.
- **Chats by project**: one group per directory, the path in the tooltip. Each row has a state glyph
  and its age. A project heading has a "new chat here" button. Chats started without a folder sit
  under "Home folder".
- **Other agents' sessions**: the few most recent sessions this app did not start, tagged with their
  agent, and a link to all of them.
- Bottom: the **update** button (only while an update waits); **quota**, one row per agent of the
  team with its worst window (`claude 62% · 5h`, `gemini out · 6h`, `agy no limits`), on the rail
  one ring for the worst of them with the list in its tooltip; **Settings**; **Help** (What's new,
  Get help, Report a bug, Terms, Commands and keys); the **connection** state.

### Search (⌘K): kept

A palette over this app's chats and the other agents' sessions. First version: it matches the title
and the first and last prompt that `listSessions()` already returns, and every result names its
project and agent, because titles repeat across projects. Arrow keys move, Enter opens, Escape
closes and puts focus back where it was. Searching inside transcripts is a later step. It has its
own step in the PR plan.

### Center

- **Top bar** (46 px): chat title, project chip (folder name and branch; the full path is its
  tooltip), token usage as quiet text, a `⋯` menu (session id, file path, transcript copy and save,
  Team for this project), and the **Work** button with the count of things that need you in this
  chat and a dot when there is work you have not opened.
- **Chat**: unchanged in content. A turn still folds its steps. A work card is one line
  (`48 delegated tasks · Open ›`, `Artifact · Sidebar states · HTML · v2 · Open ›`). A task id
  written anywhere (the lead's text, the fold line, plan steps, review notes) is a link that opens
  that task. A message you sent to a task leaves a receipt line in the chat. A pending approval of
  the lead's own turn stays inline, where the eye already is.
- **Mission strip**, above the composer while a turn with tasks runs:

  - one button per state with its glyph and count, in the order of the task groups; a click opens
    Tasks filtered to it;
  - what the lead does now, as quiet text;
  - the head of this chat's needs-you queue: agent, task id, the command, **Approve**, **Deny**, and
    "1 of 3 in this chat".

  It updates in place and never takes focus. It is how new work shows where the panel is closed.

- **Composer**. A new chat has the same composer, focused; there is no page without one.
  - New chat only: a context line, **Starts in** `[folder · branch ▾]` with recent projects, a path
    field and Choose… for a new folder, the Home folder for questions across projects, and
    **This folder / New worktree**. The line says where the prompt will run before it is sent.
  - A chip row of attached files. Files send without text.
  - Row: attach, voice, **To** (while a turn runs: the lead or one running task; typing `@t9` at the
    start does the same), the **agent chip** (agent and model; the popover has agent, model, effort
    and fallback), then **Plan**, **Ask first / Auto-approve all** (it covers this session), **Stop**
    and the submit button.
  - **Stop is its own button** and never the submit button. Submit is labelled for what Enter does:
    **Send** when idle, **Steer** when the running agent takes input mid-turn (claude, agy, the live
    drivers), **Queue** when it cannot (the prompt runs when the turn ends), **Steer t3** or
    **Queue for t5** when a task is addressed.
  - Stop is ⌘. and the button. Escape closes things and never stops a turn (today Esc stops; see the
    open point at the end).
  - Under the composer: the keys, and a quota line only for a team agent above 80%.

### Right work panel

It opens by itself on the first plan, delegated task or approval of a turn only when it fits beside
the chat (a setting turns that off), and never takes keyboard focus. ⌘⌥B and the Work button toggle
it. Its left edge drags, or moves with the arrow keys, between 380 px and half the window.

Remembered per chat: open or closed, the tab, the open task, filters, grouping, folded groups and
scroll position. Remembered per window: the panel's width and the sidebar's state.

Four tabs:

- **Live**: the answer to "what is everybody doing".
  - **Needs you**, the items of this chat ("2 in this chat", and "all 4 ›" to the queue).
  - **Lead**: the plan from `report_progress` and what the lead does now. Nothing else: the steps of
    the turn are in the chat's fold.
  - **Watching**: up to three running tasks as cards: what the task does now, its latest message and
    the delivery state of your last message to it. Tasks you messaged or pinned come first, then the
    newest.
  - **Team feed**: one list over all tasks, newest first. Highlights are messages, approvals,
    failures, finished tasks and your own messages with their delivery; routine reads and edits fold
    into one line per task ("t4 · 6 reads, 2 edits in src/react"). "Everything" shows those too.
- **Tasks**: the delegated tasks.
  - Groups in the order of what to do next: **Needs you**, **Failed**, **Review blockers** (a review
    found a BLOCKER, or is unresolved), **Running**, **Unmerged**, **Done**. Group headers stick to
    the top while their rows scroll. Done is folded when there is anything else.
  - Filter chips with counts, a text filter over title, agent and id, grouping by status or agent.
  - Up to 15 tasks a row has two lines: glyph, **id**, title, agent and age; under it the live
    activity and latest message, the command it waits for, its error, or its result. Above 15 tasks
    rows are one line (28 px) and a group shows 8 rows and **Show N more**.
  - Actions on the row: **Approve / Deny**, **Merge**, **Retry**. On the group: **Approve all**
    (shows the commands first), **Retry failed**, **Merge all** (only tasks whose review and tests
    passed on the revision shown; it names the ones it skipped).
  - Updates from the agents change text in place. A row is never rebuilt under the keyboard focus,
    and a row that changes group while it has focus or hover moves when focus leaves it. After your
    own action focus stays on that task's row.
- **Task detail** (a row, or any task id, opens it in the panel, with a back button):
  - id, title, state; agent, model, effort, worktree or shared, directory, revision, `mcpServers`;
  - the approval card (**Approve**, **Deny**, **Auto-approve all** for this session);
  - **Now**: verb, file or command, detail (elapsed time, line range, +/−), and the latest message;
  - result; **Changes** with **Show diff**, which opens that task's diff here, file by file, next to
    the revision, the review notes, the test output and Merge. A file opens the viewer;
  - **Checks before merge** on the revision shown: Code review with its notes and "ran on `a1b2c3d`,
    the worktree is now `e4f5a6b`" when outdated, Tests with their output, Request review, Run tests;
  - **Merge `<revision>` locally** sends the revision you looked at; if the worktree changed since,
    nothing merges and the diff reloads. Discard. Retry and Retry with another agent on a failure;
  - **Timeline**, newest first: what it read, ran, edited and searched, with file or command and
    outcome; its messages; your messages, each with its receipt; approvals; the start;
  - a **message box** pinned to the bottom of a running task, with Steer or Queue and Stop task, and
    one line that says what will happen to the message for this agent.
- **Changes**: the files changed by delegated tasks, with status, +/− counts, the task id (a link)
  and merged or not. The lead's own edits are not listed until the page gets them.
- **Artifacts**: the artifacts of the conversation with their versions.

**Viewer.** A file or an artifact opens inside the panel as a drill-in with a back arrow to where it
came from (Changes, Artifacts or the task). While one is open the panel widens to 600 px where the
chat keeps 600 px. **Expand** puts it over the whole chat area, **Dock** brings it back. Version
picker, Diff / File, Reveal in Finder.

### Message delivery

| State         | Shown as                            | Comes from                                                |
| ------------- | ----------------------------------- | --------------------------------------------------------- |
| Sending       | `Sending…`                          | `steer()` was called                                      |
| Delivered     | `✓ Delivered · 0.9s`                | `steer()` resolved: the agent took the input              |
| Answered      | `✓✓ Delivered · answered`           | the agent's first message after it; shown right above     |
| Queued        | `Queued · runs when this turn ends` | the agent has no `steer()`; the prompt waits in the queue |
| Not delivered | `Not delivered` + Send again        | `steer()` rejected: the task ended, or no acknowledgement |

The receipt is in the task's timeline, in the Watching card, in the team feed and as a line in the
chat. Today the transcript keeps steered text as an `input` entry without a time or an outcome, and
a pack task reports its tool calls without their arguments; both are listed under
[What the page needs](#what-the-page-needs).

### Pages and sheets

Settings, All sessions and Needs you take the place of the chat; the sidebar stays. Escape or the
back arrow returns to the chat, which keeps running behind them, and puts focus in the composer.

- **Needs you** is one queue: this chat's approvals, questions in this app's other chats, and what
  other agents' sessions hold open. The tower is a filter on it, next to This chat, This app's
  chats, Approvals and Questions. Every item shows its project, agent, the chat or session, and the
  requested action with the command or question. Answering an item anywhere (here, the strip, the
  panel, a task row, All sessions) clears every copy. A count always says its scope.
- **All sessions** keeps every control of today: Archive and Unarchive on rows, "Archive N stale",
  the Archived filter, and the waiting-command preview (tool and command) under a session that asks
  for approval, with "answer it in Gemini CLI" where the tower cannot answer.
- **Settings**: General (theme, bark, Auto-approve all by default, open the panel automatically),
  Agents (state per agent, copyable commands, Check again, Use), Team (an editable project folder
  path with recent ones and Choose…, lead, workers, Remember this team), Artifacts (CDN allow-list),
  Usage (plan limits per agent, work by topic), About and updates.
- **What's new** is the only sheet. First run without a usable agent opens the Agents section full
  width in the chat area.

### Visual language

- Type scale: 11, 12, 13, 14, 16, 20, 24 px, and nothing between. 11 px is for count badges, key
  hints and uppercase section labels only; meta text is 12 px or more. System font.
- All text has a contrast of 4.5:1 or more on its background in both themes, muted and faint text
  and state colors on their tints included. The mockup's check measures every text node.
- One control style: a 30 px button (26 small, 22 in rows) in four variants, a segmented switch, a
  toggle, a filter chip. Pills are status only and never clickable.
- State is a hue and a shape, the same everywhere:

  | State          | Hue    | Shape              |
  | -------------- | ------ | ------------------ |
  | Running        | blue   | open ring, turning |
  | Needs you      | amber  | filled diamond     |
  | Failed         | red    | cross              |
  | Review blocker | red    | triangle with `!`  |
  | Unmerged       | violet | square with a dot  |
  | Done, merged   | green  | check              |
  | Idle           | grey   | small circle       |

  Violet is used for nothing else; the accent (rust) is for primary actions and selection only.

- Tokens for surface, line, text and state colors, defined once for light and dark.
- 8 px radius on controls, 12 px on cards, a 4 px spacing grid.

### Widths

The panel docks from the space the chat needs, not from a fixed breakpoint: it sits beside the chat
while the chat column keeps 600 px (the width at which the composer row, Stop included, fits on one
line). Otherwise it opens as a full-width view under the top bar: no scrim, the sidebar stays, the
top bar gets a back arrow ("Chat") and its own Stop while a turn runs. Escape closes it and puts
focus back in the composer.

| Window  | Sidebar | Work panel                                  |
| ------- | ------- | ------------------------------------------- |
| 1440 px | full    | beside the chat, 420 px (600 px for a file) |
| 1280 px | full    | beside the chat, up to 412 px               |
| 1100 px | full    | full-width view; with the rail it docks     |
| 900 px  | rail    | full-width view                             |

Where the panel would be a full-width view it does not open by itself: the Work button shows the
count and a dot, and the mission strip carries the approval. The minimum window width stays 900 px.

## Feature map

Every control of the window today, and where it goes.

| Today                                                                    | New home                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Wolf logo and "genaicode"                                                | Sidebar top, right of the window buttons                                         |
| Pill "What's new · 3.3.0"                                                | Help menu › What's new, a dot on Help while unread; Settings › About             |
| Version text                                                             | Sidebar bottom, beside the connection state                                      |
| Chat title and subtitle / project folder name                            | Top bar: title and project chip                                                  |
| Pill "session …4ae4d086 ▾"                                               | Top bar `⋯` menu                                                                 |
| Pill "9.8M tokens"                                                       | Top bar, quiet text (hidden first on a narrow chat column; also in `⋯`)          |
| "New chat"                                                               | Sidebar button, ⌘N; "+" on each project; same composer with a project line       |
| Folder choice for a new chat                                             | Composer › Starts in: recent projects, a path, Choose…, This folder / worktree   |
| "Chats"                                                                  | Sidebar › Chats by project                                                       |
| "Sessions"                                                               | Sidebar › All sessions page; recent ones under Other agents' sessions            |
| Sessions filters, group by, period, stalled, put away, refresh           | All sessions page, unchanged (group by: project or topic)                        |
| Session row actions (Reply, Continue, copy, transcript, Approve/Deny)    | All sessions page rows                                                           |
| Archive, Unarchive, "Archive N stale", Archived filter                   | All sessions page, unchanged                                                     |
| Waiting-command preview (tool and command)                               | All sessions rows; Needs you items                                               |
| "Tower inbox · N"                                                        | Needs you, filter "Tower: other agents' sessions"                                |
| "Project team" modal, with its editable folder path                      | Settings › Team; shortcut in the top bar `⋯` menu                                |
| "Settings" popover "HTML artifact CDNs"                                  | Settings › Artifacts                                                             |
| "Connect agent" button and setup banner                                  | Banner stays above the composer; it opens Settings › Agents                      |
| Onboarding screen, Check again, copy commands, Use                       | Settings › Agents; full width in the chat area on first run                      |
| Sign-in card on a failed turn                                            | Stays inline in the chat                                                         |
| "Artifacts · N" popover                                                  | Work panel › Artifacts; one line in the chat                                     |
| Artifact and file viewer side panel                                      | Drill-in inside the work panel, 600 px, Expand over the chat                     |
| "Install X and relaunch" / "Downloading update…"                         | Sidebar bottom button; Settings › About                                          |
| "Get help", "Report a bug"                                               | Help menu; Settings › About. Terms: see the open point                           |
| Green connection dot                                                     | Sidebar bottom, labelled "Connected" or "Disconnected"                           |
| Folded "N steps" of a turn                                               | Stays in the chat                                                                |
| Plan from `report_progress`                                              | Work panel › Live › Lead; the current step stays in the fold line                |
| "Pack tasks" / "Delegated tasks" card                                    | One line in the chat; mission strip; Work panel › Tasks                          |
| "Now tool Read" on a running task                                        | Verb + file or command + detail, and the latest message, on rows, cards, detail  |
| Approval queue of the card                                               | Mission strip, task rows, Live › Needs you, task detail, Needs you page          |
| "Auto-approve all" on an approval (session scope)                        | Approval card in the task detail; composer switch                                |
| Task actions (Steer, Stop, Show diff, Merge, Discard, Review, Run tests) | Task detail; Approve/Deny, Merge, Retry also on rows and groups                  |
| Task meta (model, effort, directory, `mcpServers`), review notes, tests  | Task detail                                                                      |
| Approval and question cards of the lead's turn                           | Stay inline in the chat                                                          |
| Messages relayed to other sessions                                       | Stay inline in the chat                                                          |
| Composer quota chip                                                      | Sidebar bottom, every team agent; Settings › Usage; under the composer above 80% |
| Agent picker, model field, effort select                                 | Composer agent chip popover                                                      |
| `/fallback` (command only today)                                         | Agent chip popover, and still a command                                          |
| "Plan"                                                                   | Composer row, a toggle                                                           |
| "✓ Auto-approve" / "Ask first"                                           | Composer row, "Ask first / Auto-approve all"; default in Settings › General      |
| Stop / Steer                                                             | Two buttons: Stop (⌘.) and Send / Steer / Queue                                  |
| Attach files, voice message, slash command list                          | Composer, unchanged; files send without text                                     |
| Start screen topics (Needs you now, Agents at work, Topics, Stalled)     | New chat, above the composer, named as topics                                    |
| Start screen plan limits and "where its work went"                       | Settings › Usage; meters in the sidebar                                          |
| Start screen ideas                                                       | New chat; a click fills the composer                                             |
| Bark, `/bark`                                                            | Settings › General toggle, and still a command                                   |
| Toasts                                                                   | Unchanged, bottom center of the chat area                                        |
| Native menus (File › Session, Help) and the menu bar icon                | Unchanged                                                                        |

## States

| State                           | Sidebar                          | Center                                         | Work panel                                |
| ------------------------------- | -------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| New chat                        | nothing selected                 | greeting, ideas, topics; composer with project | closed, no Work button                    |
| Plain chat                      | chat selected                    | transcript, composer with Send                 | closed; opens on a plan or artifact       |
| Lead turn with tasks            | chat selected, running glyph     | mission strip, Stop and Steer / Queue          | open on Tasks where it fits, else a dot   |
| Something needs you             | Needs you count; diamond on chat | approval in the strip (task) or inline (lead)  | count on Work; group on top               |
| Message sent to a task          | —                                | receipt line in the chat                       | receipt in timeline, Watching, feed       |
| Setup (no usable agent)         | chats listed                     | onboarding, or banner over a disabled composer | closed                                    |
| Disconnected                    | "Disconnected" at the bottom     | composer disabled                              | keeps the last state, dimmed              |
| Update ready                    | button above the quota           | —                                              | —                                         |
| Sidebar collapsed               | icon rail with counts            | top bar starts 88 px in, with Show sidebar     | unchanged                                 |
| Chat column under 600 px        | rail below 980 px                | full width                                     | full-width view with back arrow, no scrim |
| Settings / Sessions / Needs you | item selected                    | the page                                       | closed                                    |

## What the page needs

Three things in this design are not in the data the page gets today. Each is a small change in
`src/`, to be made with the step that shows it:

- **Activity of a pack task.** A task's `tool` entries need the argument that names what it works on
  (the path, the command, the pattern) and their start time. The lead's own turn already has them.
- **Steer outcome.** An `input` entry (lead and task) needs its time and a state: sent, delivered
  (`steer()` resolved), failed (it rejected), queued. "Answered" is derived: the first agent message
  after it.
- **The lead's own changed files**, for Changes. Until then Changes lists task changes only.

## Proposed PR breakdown

Each step leaves the app working and can be reviewed alone.

1. **Visual baseline and tokens.** First a browser test that takes screenshots of `<AgentChat>` and
   the desktop page in both themes and compares them, because `agent-chat.css` is shipped to
   `genaicode/react` consumers. Then the tokens as CSS custom properties, added as aliases: existing
   class names and variables keep working and the baseline does not move.
2. **Shell and sidebar navigation.** `client.tsx` renders the grid: sidebar (New chat, Search button,
   Needs you, All sessions, Settings, Help with What's new, update, connection, quota per agent),
   chat, no panel yet. The header becomes the top bar; the old pills leave it in the same step, so
   no control exists twice. Rail with ⌘B, the macOS inset.
3. **Sidebar chat list.** Chats by directory from `/api/sessions`, state glyphs, "new chat here",
   Other agents' sessions. Browser test for collapse and selection.
4. **Composer.** Stop and Send / Steer / Queue as two buttons, file-only sends, the project line of
   a new chat (with worktree choice), agent chip popover, Plan, the permission switch, quota out of
   the composer.
5. **Work panel frame and one whole task workflow.** `WorkPanel` in `src/react`: tabs, resize,
   docking from the chat's width, the full-width view, memory per chat. Tasks with groups, rows and
   detail, enough to do approve → diff → review → merge on one task without leaving the panel. Task
   ids as links. An embedded `<AgentChat>` without a panel keeps the inline card as it is today.
6. **Live activity and receipts.** The task activity and steer outcome from
   [What the page needs](#what-the-page-needs); readable rows, the Now card, the timeline, the task
   message box, the To chip, receipts in the chat.
7. **Mission strip and Live tab.** Counts, the next approval, Lead, Watching, the team feed.
8. **Tasks at scale.** One-line rows above 15, sticky headers, Show N more, bulk actions, in-place
   updates that keep focus. A browser test with 50 tasks.
9. **Viewer drill-in, Artifacts and Changes.** The viewer inside the panel with Expand; the Artifacts
   popover becomes the tab; Changes with task changes only.
10. **Search (⌘K).** The palette over chats and sessions, labelled by project and agent.
11. **Needs you page.** One queue with filters; answering clears every copy.
12. **Settings page.** General, Agents, Team, Artifacts, Usage, About. Removes the two modals.
13. **Cleanup.** Remove dead styles, update `docs/react.md`, `src/desktop/README.md` and the
    screenshots.

`genaicode/react` consumers: `AgentChat` keeps its props and its look (step 1 guards that). The
panel is a new export; a host that does not render it gets the inline card, as today.

## Decisions

- **Needs you** is one queue. The tower is a filter on it, not a page.
- **Changes** starts with task changes only.
- **Search** is kept, with the small first version above.
- **Panel memory** is per chat; width and sidebar state are per window.
- **Terms** stays a TODO for the owner: the Help menu keeps the item, and there is no page to link.

## Changes after review

Reviewed by Gemini 4 Neon, GPT Astra 6.2 and a fresh-eyes pass. The owner then asked for a bolder
revision and named the biggest pain: a running task shows `Now  tool Read`, and a steering message
leaves no trace.

Addressed, must:

1. New chat keeps the composer, focused, with a project line: recent projects, a new folder by path
   or picker, This folder / New worktree, and the place the prompt will run.
2. Stop is its own button. Submit says Send, Steer or Queue for the agent, and names the task when
   one is addressed. Files send without text.
3. Docking comes from the chat's width (600 px). Otherwise a full-width view with a back arrow and
   no scrim; it does not open by itself there, the Work button and the strip show the news. Escape
   closes and returns focus.
4. Tasks at scale: the mockup has a 48-task state (30 running). One-line rows above 15, sticky
   headers, Show N more, the new group order, "Unmerged", ids on rows and as links, Approve / Deny /
   Merge / Retry on rows, bulk actions on groups, updates that keep focus.
5. Search is kept and has a step in the plan.

Addressed, should: the macOS inset; the task's diff inside its detail with revision-aware merge; the
viewer as a drill-in that widens and expands; resize up to half the window; archive, unarchive and
waiting-command previews; the editable folder path; `mcpServers`, review notes and test output;
"Auto-approve all" for the session; one meaning of project, topic and team; a violet Unmerged and a
shape per state; the type scale and 4.5:1 text; quota for every team agent; one needs-you queue with
scoped counts; panel memory per chat; plan and now only in the lead's section; consistent mock data;
the PR plan (merged shell steps, one whole workflow before the rest, a visual baseline first, tokens
as aliases, the inline fallback); open questions turned into decisions.

Beyond the reviews, on the owner's direction:

- Progress became **Live**: needs you, the lead, three watched tasks and one feed over all tasks.
- **Readable activity** everywhere a running task shows.
- **Receipts** for messages to the lead and to tasks, a **To** chip and `@t9` in the composer, and a
  message box in the task detail.
- The **mission strip**, so the next approval never needs the panel.

Verified in headless Chromium at 1440, 1280, 1100 and 900 px, both themes, with the 48-task state:
no page errors; the panel never overlaps the composer; Stop and submit stay on one line; focus
survives live updates; approving on a row lowers every count; a message to a task goes Delivered,
then answered; every text node is on the type scale and at 4.5:1 or more.

Deliberately not done:

- **A board of all tasks** (columns by state, or a grid of live cards across the window). The feed
  and three watched cards cover following many agents in 420 px; a board needs its own design.
- **Search inside transcripts.** The first version matches titles and prompts only.
- **Virtualized lists.** Capped groups keep 50 tasks to about 30 rows; revisit past 200.
- **A "seen" state for messages.** No agent reports that it read a message, only that it took it.
- The mockup does not show Setup, Disconnected or the lead's inline approval; they are unchanged.

Open, for the owner:

- **Escape no longer stops a turn** (it closes the innermost thing; Stop is ⌘. and the button). This
  changes a key people use today. The alternative is Escape stops only when nothing is open and
  focus is in the composer.
- **Terms** link target.
- The feed's Highlights rule (what counts as routine) should be tried on a real 30-task run.
