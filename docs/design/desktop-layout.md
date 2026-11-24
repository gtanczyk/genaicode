# Desktop window layout with sidebars

Status: design proposal. Nothing in `src/` changes with this document.
Mockup: [`desktop-layout.html`](./desktop-layout.html), one self-contained file. Open it from disk;
the dark bar at the bottom switches states and is not part of the design.

## Why

The window of desktop 3.3.0 is a header with two rows of pills over one chat column. Everything that
is not the conversation competes for those two rows: navigation (New chat, Chats, Sessions), settings
(Project team, Settings), status (tokens, session id, connection dot), support links and the release
note pill. The work of a lead agent sits inside the transcript as a card that grows with every
delegated task, so nine review tasks become a wall between two messages, and it still does not say
what each task is doing now.

Claude desktop, the Codex app and Antigravity share one shape: navigation on the left, the
conversation in the middle, the agent's work on the right. This proposal moves genaicode to that
shape and gives every current control one home.

## Layout

```
┌──────────────┬──────────────────────────────────────┬─────────────────────┐
│ Sidebar      │ Top bar: title / project    ⋯  panel │ Progress Tasks      │
│  New chat    ├──────────────────────────────────────┤ Changes Artifacts   │
│  Search      │                                      ├─────────────────────┤
│  Needs you   │ Chat                                 │                     │
│  All sessions│  (one-line summaries open the panel) │ Work panel          │
│  Chats       │                                      │                     │
│   by project │                                      │                     │
│  Other agents├──────────────────────────────────────┤                     │
│ ──────────── │ Composer                             │                     │
│  Update      │  attach · mic · agent · Plan · mode  │                     │
│  Quota       │                                      │                     │
│  Settings Help                                      │                     │
└──────────────┴──────────────────────────────────────┴─────────────────────┘
   268 px / 56 px rail          flexible, text column 760 px     404 px, resizable
```

### Left sidebar

Collapsible with ⌘B to a 56 px icon rail; the state is remembered. On a Mac the top 46 px is the
window's drag region and leaves room for the window buttons.

- **New chat** (⌘N), **Search** (⌘K, a palette over chats and sessions).
- **Needs you**, with a count: one queue for this chat's approvals, the tower inbox and questions
  other agents' sessions hold open.
- **All sessions**: the Sessions view of today, as a page.
- **Chats**, grouped by project (topic). Each row has a state dot (working, needs you, done, idle)
  and its age. A project heading has its own "new chat here" button. Chats with no project sit
  under "No project".
- **Other agents' sessions**: the few most recent sessions this app did not start, tagged with their
  agent, and a link to all of them.
- Bottom, top to bottom: the **update** button (only while an update waits), **quota** meters of the
  current agent (opens Settings › Usage), **Settings**, **Help** (Get help, Report a bug, Terms,
  Commands and keys, What's new), and the **connection** state as a labelled dot.

What's new is an item of the Help menu. An unread release shows as a small dot on Help; the release
sheet still opens by itself once after an update, as it does now.

### Center

- **Top bar** (46 px): chat title, project chip (folder name and branch; the full path is its
  tooltip), token usage as quiet text, a `⋯` menu (session id, file path, transcript copy and save,
  Project team), and the work panel toggle with a count of things that need you.
- **Chat**: unchanged in content. A turn still folds its steps into "N steps". What changes is that
  work cards become one line:
  - `12 delegated tasks · 1 needs you · 4 running · 1 failed · 2 ready to merge · 4 done  Open ›`
  - `Artifact · Sidebar states · HTML · v2  Open ›`
    Clicking the line opens the panel on that tab. A pending approval of the lead's own turn stays
    inline in the chat, where the eye already is, and is repeated in the panel.
- **Composer**: the text box, then one row: attach, voice, one **agent chip**
  (`claude · fable-5.2 · high`) that opens a popover with agent, model, effort and fallback; on the
  right **Plan**, the **Ask first / Auto-approve** switch and Send, which is Stop while a turn runs.
  The quota chip leaves the composer: it lives in the sidebar, and appears as text under the
  composer only when a limit is above 80% or while no turn runs.

### Right work panel

Opens by itself when a turn first reports a plan, delegates a task or asks for approval (a setting
turns this off), and by the top bar toggle or ⌘⌥B. Resizable; the width is remembered. Four tabs:

- **Progress**: approvals that wait (top), the plan from `report_progress` with done / current /
  pending steps, what the lead does now, and the steps of this turn.
- **Tasks**: the delegated tasks.
  - Filter chips with counts: All, Needs you, Running, Failed, To merge, Done. A text filter over
    title, agent and id. Group by status (default) or by agent.
  - Groups in the order that matters: Needs you, Running, Failed, Ready to merge, Done. Newest first
    inside a group. Done is folded when there is anything else to look at.
  - A row is two lines: state dot, title, agent and age; under it what the task does now (the first
    line of `task.text` while running, in monospace), the approval it waits for, its error, or the
    first line of its result.
  - A row opens the task in the same panel, with a back button: status, meta (id, agent, model,
    effort, worktree or shared, directory), approval card, "Now" and recent activity, result,
    changed files, pre-merge checks (Code review, Tests), prompt, and the actions of today's card:
    Steer, Stop task, Show diff, Merge locally, Discard, Request review, Run tests.
  - With dozens of tasks the list stays readable because failed and waiting tasks are always at the
    top, finished ones fold away, and the counts in the chips say the rest.
- **Changes**: files changed by the lead and by each task, with status, +/− counts and where the
  change came from (lead, task id, merged or not). A file opens its diff in place, or the file
  viewer.
- **Artifacts**: the artifacts of the conversation with their versions. The artifact and file viewer
  of today renders in this panel, with Full size and Reveal in Finder.

### Pages and sheets

Settings, All sessions and Needs you take the place of the chat; the sidebar stays. Esc or the back
arrow returns to the chat, which keeps running behind them.

- **Settings** has sections in a left list: General (theme, bark, default permission mode, open the
  panel automatically), Agents (the onboarding screen: state per agent, copyable install and sign-in
  commands, Check again, Use), Project team (project, lead, workers, Remember this team), Artifacts
  (CDN allow-list), Usage (plan limits per agent and where its work went), About and updates.
- **What's new** is the only sheet: it is read once and closed.
- First run without a usable agent still opens the onboarding screen in the chat area; it is the
  Agents section shown full width.

### Visual language

- One type scale: 11 (labels), 12 (meta), 13 (controls), 14 (body), 16/20/24 (headings). System font.
- One control style: a 30 px button (26 px small) in four variants (default, primary, ghost, danger),
  a segmented switch for two to five exclusive choices, a toggle for on/off, a filter chip. Pills are
  status only and are never clickable.
- One accent. State colors mean the same thing everywhere: blue running, amber needs you, red failed,
  green done.
- Tokens for surface, line, text and state colors, defined once for light and dark.
- 8 px radius on controls, 12 px on cards, a 4 px spacing grid.

### Widths

| Window         | Sidebar         | Work panel                      |
| -------------- | --------------- | ------------------------------- |
| 1100 px and up | full or rail    | beside the chat                 |
| 980–1099 px    | full or rail    | overlays the chat, with a scrim |
| under 980 px   | rail by default | overlays the chat               |

The minimum window width stays 900 px.

## Feature map

Every control of the window today, and where it goes.

| Today                                                                                            | New home                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Wolf logo and "genaicode"                                                                        | Sidebar top                                                              |
| Pill "What's new · 3.3.0"                                                                        | Help menu › What's new, a dot on Help while unread; Settings › About     |
| Version text (when there is no release note)                                                     | Sidebar bottom, beside the connection state                              |
| Chat title and subtitle / project folder name                                                    | Top bar: title and project chip                                          |
| Pill "session …4ae4d086 ▾" (copy id, path; copy or save transcript)                              | Top bar `⋯` menu                                                         |
| Pill "9.8M tokens"                                                                               | Top bar, quiet text (hidden first on narrow windows; also in `⋯`)        |
| "New chat"                                                                                       | Sidebar top button, ⌘N; "+" on each project                              |
| "Chats"                                                                                          | Sidebar › Chats, grouped by project                                      |
| "Sessions"                                                                                       | Sidebar › All sessions page; recent ones under Other agents' sessions    |
| Sessions filters (search, agent, state, group by, period, needs you, stalled, put away, refresh) | All sessions page, unchanged                                             |
| Session row actions (Reply, Continue, copy resume command, transcript menu, Approve/Deny)        | All sessions page rows                                                   |
| "Tower inbox · N"                                                                                | Sidebar › Needs you page                                                 |
| "Project team" modal                                                                             | Settings › Project team; shortcut in the top bar `⋯` menu                |
| "Settings" popover "HTML artifact CDNs"                                                          | Settings › Artifacts                                                     |
| "Connect agent" button and setup banner                                                          | Banner stays above the composer; it opens Settings › Agents              |
| Onboarding screen, Check again, copy commands, Use                                               | Settings › Agents; full width in the chat area on first run              |
| Sign-in card on a failed turn                                                                    | Stays inline in the chat                                                 |
| "Artifacts · N" popover                                                                          | Work panel › Artifacts; one-line card in the chat                        |
| Artifact and file viewer side panel (version, full size, reveal, resize)                         | Work panel (Artifacts and Changes tabs open it)                          |
| "Install X and relaunch" / "Downloading update…"                                                 | Sidebar bottom button; Settings › About                                  |
| "Get help", "Report a bug"                                                                       | Help menu, with Terms; Settings › About                                  |
| Green connection dot                                                                             | Sidebar bottom, labelled "Connected" or "Disconnected"                   |
| Folded "N steps" of a turn                                                                       | Stays in the chat; the same steps are in Work panel › Progress           |
| Plan from `report_progress`                                                                      | Work panel › Progress; the current step stays in the fold line           |
| "Pack tasks" / "Delegated tasks" card                                                            | One line in the chat; list and detail in Work panel › Tasks              |
| Approval queue of the card                                                                       | Work panel › Progress "Needs you", the task's own detail, Needs you page |
| Task actions (Steer, Stop, Show diff, Merge locally, Discard, Request review, Run tests)         | Task detail in the work panel                                            |
| Approval and question cards of the lead's turn                                                   | Stay inline in the chat                                                  |
| Messages relayed to other sessions                                                               | Stay inline in the chat                                                  |
| Composer quota chip "7d 43% · resets in 4d 3h"                                                   | Sidebar bottom meters; Settings › Usage; under the composer above 80%    |
| Agent picker, model field, effort select                                                         | Composer agent chip popover                                              |
| `/fallback` (command only today)                                                                 | Agent chip popover, and still a command                                  |
| "Plan"                                                                                           | Composer row, a toggle                                                   |
| "✓ Auto-approve" / "Ask first"                                                                   | Composer row, a two-way switch; default in Settings › General            |
| Stop / Steer                                                                                     | The Send button is Stop while a turn runs; typing steers                 |
| Attach files, voice message, slash command list                                                  | Composer, unchanged                                                      |
| Start screen topics (Needs you now, Agents at work, Topics, Stalled)                             | New chat page, unchanged                                                 |
| Start screen plan limits and "where its work went"                                               | Settings › Usage; meters in the sidebar                                  |
| Start screen ideas                                                                               | New chat page                                                            |
| Bark (sound and title count), `/bark`                                                            | Settings › General toggle, and still a command                           |
| Toasts                                                                                           | Unchanged, bottom center of the chat area                                |
| Native menus (File › Session, Help) and the menu bar icon                                        | Unchanged                                                                |

## States

| State                           | Sidebar                            | Center                                  | Work panel                          |
| ------------------------------- | ---------------------------------- | --------------------------------------- | ----------------------------------- |
| New chat                        | nothing selected                   | greeting, ideas, topics                 | closed                              |
| Plain chat                      | chat selected                      | transcript, composer                    | closed; opens on a plan or artifact |
| Lead turn with tasks            | chat selected, blue dot            | summary lines in the transcript         | open on Tasks                       |
| Something needs you             | Needs you count; amber dot on chat | approval inline (lead) or summary line  | badge on the toggle; pinned on top  |
| Setup (no usable agent)         | chats listed, composer disabled    | onboarding, or banner over the composer | closed                              |
| Disconnected                    | "Disconnected" at the bottom       | composer disabled                       | keeps the last state, dimmed        |
| Update ready                    | button above the quota             | —                                       | —                                   |
| Sidebar collapsed               | icon rail with counts              | wider                                   | unchanged                           |
| Narrow window                   | rail                               | full width                              | overlay with scrim                  |
| Settings / Sessions / Needs you | item selected                      | the page                                | closed                              |

## Proposed PR breakdown

Each step leaves the app working and can be reviewed alone. Steps 1–3 move things without changing
what they do; the later ones change behavior.

1. **Tokens and controls.** CSS custom properties for both themes and the button, segmented switch,
   toggle, chip and pill styles in `agent-chat.css`; existing classes map onto them. No layout change.
2. **Shell.** `client.tsx` renders a three-column grid: an empty sidebar with the brand, the chat, no
   panel yet. The header becomes the top bar (title, project, `⋯` with the transcript menu, tokens).
   Tauri drag region and Mac window buttons move with it. The old pills stay in the top bar for now.
3. **Sidebar navigation.** New chat, Needs you (tower inbox), All sessions, Settings, Help menu with
   What's new, update button, connection state, collapse to rail with ⌘B (remembered in
   `localStorage`). The pills leave the top bar.
4. **Sidebar chat list.** Chats grouped by project from `/api/sessions` (own chats), state dots,
   "new chat here" per project, and the short Other agents' sessions list. Browser test for collapse
   and selection.
5. **Work panel frame.** A `WorkPanel` in `src/react` with tabs, resize, auto-open and the overlay
   mode under 1100 px. The file and artifact viewer render inside it; the Artifacts popover becomes
   the Artifacts tab.
6. **Progress tab.** Plan from `report_progress`, current step, the turn's steps, pending approvals.
7. **Tasks tab.** `PackTasks` splits into a summary line (chat) and list + detail (panel): groups,
   filter chips, text filter, group by agent. Task actions and approvals move with the detail.
   Builds on the names from #345.
8. **Changes tab.** Files of the lead and of each task with counts and inline diff. Needs the
   lead's own changed files from the session state; if that is not there yet, this step starts with
   task changes only.
9. **Composer.** Agent chip popover (agent, model, effort, fallback), Plan toggle, permission
   switch, Send/Stop in one button, quota out of the composer and into the sidebar.
10. **Settings page.** Sections General, Agents (onboarding), Project team (from the dialog),
    Artifacts (from the CDN popover), Usage (from the start screen), About. Removes the two modals.
11. **Needs you page.** One queue over the chat's approvals, the tower inbox and waiting sessions.
12. **Cleanup.** Remove dead styles, update `docs/react.md`, `src/desktop/README.md` and the
    screenshots.

`genaicode/react` consumers: `AgentChat` keeps its props. The panel is a new export; a host that
does not render it gets the one-line summaries expanding in place, as the card does today.

## Open questions

- Should the work panel be per chat (each chat remembers its tab and open task) or one per window?
  The mockup assumes per chat.
- "Needs you" merges three sources. If the tower inbox should stay a separate concept, it becomes a
  filter on that page rather than a page of its own.
- The Changes tab for the lead's own edits needs data the page does not get today. Step 8 says how
  to start without it.
