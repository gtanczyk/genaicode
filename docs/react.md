# React components (`genaicode/react`)

[← README](../README.md)

`genaicode/react` is the same chat as a component. It draws a `SessionState` your app gives
it and calls you back; it runs, fetches and stores nothing, so your server owns the session,
its MCP servers and its prompts. React 18 or newer comes from your app: genaicode does not
declare or install it.

```ts
// server (Node): one session, streamed to the page
import { createAgentSession, claude } from 'genaicode/agents';

const session = createAgentSession({
  agent: claude(),
  cwd: process.cwd(),
  task: { mcpServers: [{ name: 'ops', url: 'http://127.0.0.1:4000/mcp' }] },
  // The agent gets the context; the transcript keeps what the user typed.
  transformPrompt: (text) => `${briefing}\n\nOperator message:\n${text}`,
});

app.get('/api/agent/events', (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  const push = (state) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  push(session.get());
  res.on('close', session.subscribe(push));
});
app.post('/api/agent/send', (req, res) => {
  session.send(req.body.text);
  res.json({ ok: true });
});
app.post('/api/agent/stop', (req, res) => {
  session.stop();
  res.json({ ok: true });
});
app.post('/api/agent/approve', (req, res) => res.json({ ok: session.approve(req.body.id, req.body.decision) }));
```

```tsx
// page
import { useEffect, useState } from 'react';
import { AgentChat, type SessionState } from 'genaicode/react';
import 'genaicode/react/styles.css';

const post = (path: string, body: object = {}) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export function AgentDrawer() {
  const [state, setState] = useState<SessionState | null>(null);
  useEffect(() => {
    const events = new EventSource('/api/agent/events');
    events.onmessage = (event) => setState(JSON.parse(event.data));
    return () => events.close();
  }, []);
  return (
    <AgentChat
      state={state}
      onSend={(text) => post('/api/agent/send', { text })}
      onStop={() => post('/api/agent/stop')}
      onApprove={(id, decision) => post('/api/agent/approve', { id, decision })}
      formatToolName={(name) => name.replace(/^mcp__ops__/, '')}
      renderFooter={() => <MyApprovalCards />}
      headerExtras={<button onClick={() => post('/api/agent/reset')}>New</button>}
    />
  );
}
```

`<AgentChat>` fills its container's height. It shows turns with streaming Markdown (no raw
HTML; links open in a new tab; GFM tables, strikethrough and task lists), collapsible tool calls, edited files, errors, the agent's
own approval requests, queued prompts and a working indicator, and an input where Enter
sends, Shift+Enter adds a line and Esc stops. Props:

| Prop                                                                           |                                                                                                                             |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `state`                                                                        | `SessionState`, or null before there is a session                                                                           |
| `onSend(text)`, `onStop()`                                                     | Enter or Send; Stop or Esc. No `onStop`, no Stop button                                                                     |
| `onApprove(id, decision)`                                                      | answers `state.approvals`; without it they show as waiting                                                                  |
| `onAnswer(id, answers)`                                                        | answers an agent's question (a card with its options); Skip calls `onApprove(id, 'deny')`. Pass `session.answer`            |
| `onAutoApprove()`                                                              | optional third button ("Auto-approve all") beside Approve and Deny to approve pending and future requests                   |
| `onPackAction(turnId, id, action)`                                             | pass the session's `actOnPackTask` to enable worker controls and return a diff or result text                               |
| `onOpenTasks(turn)`                                                            | the host shows delegated tasks in `<WorkPanel>`: a turn's task card becomes one line that calls this; approvals stay inline |
| `missionStrip`                                                                 | the mission strip above the message box (see below); with `onOpenTasks`, approvals of tasks move from the transcript to it  |
| `renderPrompt(text, turn?)`                                                    | how a sent prompt shows (return null to hide it)                                                                            |
| `renderAfterTurn(turn, i)`, `renderFooter()`                                   | your content after a turn, or at the end                                                                                    |
| `notices`                                                                      | `{ id, afterTurn, text, tone? }[]`: your own lines between turns                                                            |
| `artifactUrl(artifact)`, `renderArtifact(artifact, url)`                       | where your server serves a published artifact; your own card ([artifacts](agents.md#artifacts))                             |
| `onOpenArtifact(artifact)`                                                     | opens an artifact in a host side panel instead of expanding it inline in the transcript; `<ArtifactPanel>` is also exported |
| `onArtifactSubmit(artifact, data)`                                             | a page the agent published sent data and the user confirmed it; default sends it as a message; `null` turns it off          |
| `imageUrl(path)`, `remoteImages`                                               | resolve `![alt](path)` thumbnails in replies; `remoteImages` defaults to `'click'` (placeholder chip) or `'load'`           |
| `foldSteps`                                                                    | collapse tools and edits into one line, and keep the latest reply, status and plan in view below it, oldest first           |
| `header`, `headerExtras`                                                       | replace the header (null for none), or add to its right end                                                                 |
| `completions`                                                                  | commands the host understands (`{ name, args?, help? }`), offered while the message starts one                              |
| `composerExtras`                                                               | host controls in a row under the message field, beside the attach button (agent, model, mode)                               |
| `composerLayout`, `composerHeader`                                             | `'card'`: one card with the field over a row of attach, `composerExtras`, Stop and submit; a line above the field           |
| `onOpenFile(path, position?)`, `onRevealFile(path)`                            | makes file links (carrying `:line`, `:line:col`, `#L12-L20` positions) clickable; `onRevealFile` adds a Reveal context menu |
| `emptyState`, `placeholder`, `hint`, `composerTitle`                           | text before the first turn, in and under the input, its tooltip                                                             |
| `formatToolName(name)`, `disabled`, `autoFocus`, `theme`, `className`, `style` |                                                                                                                             |

Theme it with CSS custom properties on the component or any ancestor: `--gc-bg`,
`--gc-panel`, `--gc-border`, `--gc-text`, `--gc-muted`, `--gc-accent`, `--gc-accent-text`,
`--gc-error`, `--gc-font`, `--gc-mono`, `--gc-font-size`, `--gc-radius`, `--gc-max-width`
(and `--gc-ok`, `--gc-warn`, plus soft shades mixed from these unless set). Unset ones keep
the `genaicode ui` look, light or dark by `prefers-color-scheme`, or by `theme="light"` /
`"dark"`. `genaicode ui` and the Vite panel draw this same component.

`<WorkPanel>` shows the tasks a lead agent delegated (`turn.pack.tasks`) beside the chat, as
`genaicode ui` does: grouped by what to do next, each row opening the task's detail with its
actions (steer, stop, show the diff, request a review, run tests, merge locally, discard). It is
presentational like `<AgentChat>`, and optional: without it (and without `onOpenTasks`) the tasks
stay in the inline card of their turn.

```tsx
import { AgentChat, WorkPanel, readWorkView, workPanelLayout, writeWorkView } from 'genaicode/react';

const [view, setView] = useState(() => readWorkView(localStorage, chatId)); // what is open, per chat
const layout = workPanelLayout({ room, window: innerWidth, saved }); // room: the width chat and panel share

<AgentChat state={state} onSend={send} onOpenTasks={() => setView({ ...view, open: true })} />;
{
  view.open ? (
    <WorkPanel
      state={state}
      chatId={chatId}
      view={view}
      onView={(next) => (setView(next), writeWorkView(localStorage, chatId, next))}
      mode={layout.docks ? 'docked' : 'full'} // 'full': a view in the chat's place, below 600 px of chat
      width={layout.width}
      bounds={() => [380, layout.max]}
      onWidth={(width, commit) => setSaved(width)}
      onPackAction={async (turnId, id, action, intent) => {
        // A discard confirmed while the pull request held the work: re-check it (your own lookup).
        if (intent?.pullRequest && !(await worktreeMatchesPullRequest(turnId, id)))
          throw new Error('The worktree has work its pull request does not. Nothing was discarded.');
        return session.actOnPackTask!(turnId, id, action);
      }}
      onApprove={session.approve}
      pullRequests={{ '7:t1': { state: 'merged', ours: true } }} // by WorkTask.key ("turn:id")
      onClose={() => setView({ ...view, open: false })}
    />
  ) : null;
}
```

A task whose final reply links to a GitHub pull request carries `pullRequest: { url, number }`.
The reply may only refer to it, so the panel shows it as a link beside **Merge locally** and
**Discard** until `pullRequests` says the task opened it (`ours`, for example its worktree is on
the pull request's head branch): then "PR #12 · merged" (or open, closed) stands in for Merge
locally. Give the `state` once you have looked it up, and keep asking about a closed one: it can
be reopened. A discard confirmed while the pull request held the work calls `onPackAction` with a
fourth argument, `{ pullRequest: true }`: check that the worktree still matches the pull request
before you discard (the work may have changed since). A task that changed no files sends
`{ type: 'discard', empty: true }`, which the pack refuses (reason `changed`) once its worktree has
changes. Pass `chatId`, your id for the conversation, so a task's detail starts afresh in
another chat. The panel draws with the design tokens
(`--gc-color-*`) of `styles.css` and never takes the keyboard focus by itself.

A long list stays short on screen. Above 8 tasks the panel has status chips with counts, a text
filter (title, agent, id, status) and a switch to group by agent; above 15 a row is one line and a
group shows its newest 8 rows and **Show N more**, 50 at a time, also under a chip, a filter or
by agent. Done is one line ("100 done · 5 stopped") until it is opened. A finished task with no
worktree left to merge or discard can be cleared from the list (its row's ×, or **Clear N** on
Done and Failed); the session keeps it, and **Show them** brings it back. All of it is in `view`
(`filter`, `query`, `by`, `more`, `folded`, `dismissed`), so it is remembered wherever you keep
`view`. The inline card of `<AgentChat>` does the same above 15 tasks: one-line rows, the first 12,
a filter and **Clear N finished**; pass it `chatId` so what it remembers stays with its conversation.

The panel has two tabs, **Live** and **Tasks** (`view.tab`; a chat starts on Tasks). Live answers
"what is everybody doing": the approvals this chat's tasks wait for (`needsYou={{ total, onOpen }}`
adds "all N ›" to your own queue across chats), the lead's plan from `report_progress` and what it
does now, up to three running tasks as cards (the ones pinned with the card's pin, then the ones
the person messaged, then the newest; `view.pinned`), and one feed over all tasks, newest first:
what a task said, asked for, failed at or finished with, and the person's messages with their
receipts. A task's routine reads, edits and commands are one line ("2 reads, 1 edit in `src`")
until **Everything** is chosen (`view.feed`). A task id anywhere opens that task.

`<AgentChat missionStrip={{ onOpenGroup, onOpenTask, pullRequests }}>` puts the **mission strip**
above the message box while delegated work runs: one count per state (a click calls
`onOpenGroup(group)`: set `view` to `{ tab: 'tasks', filter: group }`), what the lead does now, and
the first approval a task waits for, with Approve and Deny through `onApprove` and "1 of 3 in this
chat". With it and `onOpenTasks`, an approval of a task no longer shows in the transcript; the
lead's own approvals and every question stay inline. It renders nothing in a chat without running
delegated work and never takes the keyboard focus. `<MissionStrip state=… />` is the same strip
for a composer of your own. Without `missionStrip` nothing changes.

Two smaller pieces come along for hosts that build their own panels around a transcript:

```ts
import { installResizeHandle, storedSize, useFollowScroll } from 'genaicode/react';

// A log that stays at its newest line until the user scrolls up (and again after follow()).
const { ref, onScroll, follow } = useFollowScroll(lines);

// A drag handle on a panel's left edge; the width survives reloads (in localStorage, or pass
// () => sessionStorage as a third argument for a width per window).
const stored = storedSize('panel-width', [300, 900]);
let width = stored.get();
const handle = installResizeHandle(edge, {
  axis: 'x',
  direction: () => -1, // dragging left makes the panel wider
  bounds: () => [300, Math.min(900, innerWidth - 24)],
  read: () => width ?? 390,
  write: (next, commit) => {
    width = next;
    panel.style.setProperty('--width', `${width}px`);
    if (commit) stored.set(width);
  },
  reset: () => {
    width = undefined;
    panel.style.removeProperty('--width');
    stored.clear();
  },
});
// The CSS caps the shown width, so the saved one comes back when the window grows again:
// .panel { width: min(var(--width, 390px), calc(100vw - 24px)); }
window.addEventListener('resize', handle.sync);
```

The handle keeps its `aria-value*` range current and takes the arrow keys (Shift for bigger
steps), Home and End, Escape to undo a drag, and Enter or double-click to reset. While a drag
runs, `document.body` (or `root`) has `data-resizing="true"`, so the page can keep the cursor
and turn off pointer events on iframes. `read()` must return what `write` or `reset` just set,
so keep the size in a variable or a ref rather than only in React state.

To show the whole `genaicode ui` page in a frame instead, `startEmbeddedWeb` from
`genaicode/ui` serves it on 127.0.0.1 with your `task` (`mcpServers`, `timeoutMs`...), `env`
and `transformPrompt`, and returns its tokenized `url` and a `controller` to send prompts.
