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
HTML; links open in a new tab), collapsible tool calls, edited files, errors, the agent's
own approval requests, queued prompts and a working indicator, and an input where Enter
sends, Shift+Enter adds a line and Esc stops. Props:

| Prop                                                                           |                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `state`                                                                        | `SessionState`, or null before there is a session                |
| `onSend(text)`, `onStop()`                                                     | Enter or Send; Stop or Esc. No `onStop`, no Stop button          |
| `onApprove(id, decision)`                                                      | answers `state.approvals`; without it they show as waiting       |
| `renderPrompt(text, turn?)`                                                    | how a sent prompt shows (return null to hide it)                 |
| `renderAfterTurn(turn, i)`, `renderFooter()`                                   | your content after a turn, or at the end                         |
| `notices`                                                                      | `{ id, afterTurn, text, tone? }[]`: your own lines between turns |
| `foldSteps`                                                                    | fold each turn's tools and edits into one "N steps" line         |
| `header`, `headerExtras`                                                       | replace the header (null for none), or add to its right end      |
| `emptyState`, `placeholder`, `hint`                                            | text before the first turn, in and under the input               |
| `formatToolName(name)`, `disabled`, `autoFocus`, `theme`, `className`, `style` |                                                                  |

Theme it with CSS custom properties on the component or any ancestor: `--gc-bg`,
`--gc-panel`, `--gc-border`, `--gc-text`, `--gc-muted`, `--gc-accent`, `--gc-accent-text`,
`--gc-error`, `--gc-font`, `--gc-mono`, `--gc-font-size`, `--gc-radius`, `--gc-max-width`
(and `--gc-ok`, `--gc-warn`, plus soft shades mixed from these unless set). Unset ones keep
the `genaicode ui` look, light or dark by `prefers-color-scheme`, or by `theme="light"` /
`"dark"`. `genaicode ui` and the Vite panel draw this same component.

Two smaller pieces come along for hosts that build their own panels around a transcript:

```ts
import { installResizeHandle, storedSize, useFollowScroll } from 'genaicode/react';

// A log that stays at its newest line until the user scrolls up (and again after follow()).
const { ref, onScroll, follow } = useFollowScroll(lines);

// A drag handle on a panel's left edge; the width survives reloads.
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
