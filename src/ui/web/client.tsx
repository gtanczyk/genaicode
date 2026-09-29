import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionEntry, SessionTurn } from '../../agents/session.js';
import type { ChatView, Notice } from '../controller.js';
import {
  formatDuration,
  formatUsage,
  needsAttention,
  relativePath,
  shortId,
  toolLabel,
  toolSummary,
  turnFooter,
} from '../format.js';
import type { WebCommand } from './server.js';

const token = new URLSearchParams(location.search).get('token') ?? '';
const CWD = document.getElementById('root')?.dataset.cwd ?? '';

async function command(body: WebCommand): Promise<boolean> {
  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
    body: JSON.stringify(body),
  });
  return res.ok && ((await res.json()) as { ok: boolean }).ok;
}

function useView(): { view?: ChatView; connected: boolean } {
  const [view, setView] = useState<ChatView>();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    source.addEventListener('view', (event) => {
      setView(JSON.parse((event as MessageEvent<string>).data) as ChatView);
      setConnected(true);
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);
  return { view, connected };
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The wolf from genaicode 1.0: while the tab is in the background, bark when the agent asks for
 * approval or finishes, and count those in the tab title. Coming back to the tab hushes it.
 */
function useBark(view: ChatView | undefined) {
  const seen = useRef<ChatView['session']>(undefined);
  const audio = useRef<HTMLAudioElement>(undefined);
  const unread = useRef(0);
  useEffect(() => {
    const hush = () => {
      if (document.visibilityState !== 'visible') return;
      unread.current = 0;
      document.title = 'genaicode';
      if (audio.current) {
        audio.current.pause();
        audio.current.currentTime = 0;
      }
    };
    window.addEventListener('focus', hush);
    document.addEventListener('visibilitychange', hush);
    return () => {
      window.removeEventListener('focus', hush);
      document.removeEventListener('visibilitychange', hush);
    };
  }, []);
  useEffect(() => {
    if (!view) return;
    const before = seen.current;
    seen.current = view.session;
    if (!needsAttention(before, view.session) || (document.hasFocus() && document.visibilityState === 'visible'))
      return;
    unread.current += 1;
    document.title = `(${unread.current}) genaicode`;
    if (!view.bark) return;
    audio.current ??= new Audio('/assets/bark.mp3');
    audio.current.currentTime = 0;
    audio.current.volume = 0.5;
    // Browsers may refuse sound before the first click on the page; the title still counts.
    audio.current.play().catch(() => {});
  }, [view]);
}

// ---------- Markdown (a small, safe subset; no HTML) ----------

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const [token] = match;
    if (match[1]) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (match[3]) out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    else if (match[4]) {
      const label = token.slice(1, token.indexOf(']'));
      out.push(
        <a key={key++} href={match[5]} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\s+$/, '').split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push(
        <pre key={key++}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = `h${heading[1].length + 1}` as 'h2';
      blocks.push(<Tag key={key++}>{inline(heading[2])}</Tag>);
      i += 1;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key++}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*]\s|\d+\.\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={key++}>{inline(para.join('\n'))}</p>);
  }
  return <div className={`md${streaming ? ' caret' : ''}`}>{blocks}</div>;
}

// ---------- Transcript ----------

function Entry({ entry, agent }: { entry: SessionEntry; agent: string }) {
  switch (entry.kind) {
    case 'text':
      return <Markdown text={entry.text} streaming={entry.streaming} />;
    case 'tool': {
      const summary = toolSummary(entry.input, 200, CWD);
      return (
        <details className="tool">
          <summary>
            <span className={`state ${entry.done ? (entry.isError ? 'err' : 'ok') : ''}`}>
              {entry.done ? entry.isError ? '✗' : '✓' : <span className="spin" />}
            </span>
            <span className="name">{toolLabel(entry.name)}</span>
            <span className="arg">{summary}</span>
          </summary>
          <pre>{entry.output?.trim() || (entry.done ? 'No output.' : 'Running…')}</pre>
        </details>
      );
    }
    case 'files':
      return (
        <div className="files">
          <span>✎ Edited</span>
          {entry.paths.map((path) => (
            <code key={path}>{relativePath(path, CWD)}</code>
          ))}
        </div>
      );
    case 'approval': {
      const what =
        entry.request.kind === 'command' ? 'run' : entry.request.kind === 'file-change' ? 'apply edits to' : 'do';
      if (entry.decision) {
        return (
          <div className="approval done">
            {entry.decision === 'approve' ? '✓ Approved' : '✗ Denied'}: {what}&nbsp;
            <span className="what">{entry.request.summary ?? entry.request.id}</span>
          </div>
        );
      }
      return (
        <div className="approval">
          <div>
            <strong>{agent}</strong> wants to {what}:
          </div>
          <div className="what">{entry.request.summary ?? entry.request.id}</div>
          <div className="buttons">
            <button
              className="btn primary"
              onClick={() => void command({ type: 'approve', id: entry.request.id, decision: 'approve' })}
            >
              Approve
            </button>
            <button
              className="btn danger"
              onClick={() => void command({ type: 'approve', id: entry.request.id, decision: 'deny' })}
            >
              Deny
            </button>
          </div>
        </div>
      );
    }
    case 'input':
      return (
        <div className="prompt steer">
          <small>Sent while working</small>
          {entry.text}
        </div>
      );
    case 'error':
      return <div className="error">{entry.message}</div>;
  }
}

function Turn({ turn, now }: { turn: SessionTurn; now: number }) {
  const running = !turn.result;
  const bad = turn.result && !turn.result.ok;
  return (
    <section className="turn">
      <div className="prompt">{turn.prompt}</div>
      {turn.entries.length ? (
        <div className="agent-row">
          <div className="avatar" title={turn.agent}>
            {turn.agent.slice(0, 2)}
          </div>
          <div className="steps">
            {turn.entries.map((entry, i) => (
              <Entry key={i} entry={entry} agent={turn.agent} />
            ))}
          </div>
        </div>
      ) : null}
      {running ? (
        <div className="working">
          <span className="spin" /> {turn.agent} is working · {formatDuration(now - turn.startedAt)}
        </div>
      ) : (
        <div className={`footer${bad ? ' bad' : ''}`}>
          {turnFooter(turn, now)} · {turn.agent}
        </div>
      )}
    </section>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  return <div className={`notice${notice.tone === 'error' ? ' err' : ''}`}>{notice.text}</div>;
}

const IDEAS = ['Explain how this project is organized', 'Find and fix a failing test', 'Add a --verbose flag'];

function App() {
  const root = document.getElementById('root')!;
  const cwd = root.dataset.cwd ?? '';
  const { view, connected } = useView();
  useBark(view);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<string>();
  const scroller = useRef<HTMLElement>(null);
  const pinned = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const running = view?.session.status === 'running';
  const now = useNow(running);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [draft]);

  if (!view) return <div className="empty">Connecting…</div>;
  const { session, agents } = view;
  const send = (text = draft) => {
    if (!text.trim()) return;
    pinned.current = true;
    void command({ type: 'submit', text });
    setDraft('');
  };

  // Notices sit after the turn that was last when they were posted.
  const items: ReactNode[] = [];
  const notices = [...view.notices];
  const flush = (upTo: number) => {
    while (notices.length && notices[0].afterTurn <= upTo) {
      const notice = notices.shift()!;
      items.push(<NoticeLine key={`n${notice.id}`} notice={notice} />);
    }
  };
  session.turns.forEach((turn, index) => {
    flush(index);
    items.push(<Turn key={turn.id} turn={turn} now={now} />);
  });
  flush(Number.MAX_SAFE_INTEGER);

  const usage = formatUsage(session.usage, session.costUsd);
  root.classList.toggle('has-turns', session.turns.length > 0);
  return (
    <>
      <header className="bar">
        <div className="brand">
          <img src="/assets/wolf-64.png" alt="" /> genaicode <small>{root.dataset.version}</small>
        </div>
        <label className="field">
          Agent
          <select
            value={session.agent}
            disabled={running}
            onChange={(event) => void command({ type: 'agent', name: event.target.value })}
          >
            {agents.map((agent) => (
              <option key={agent.name} value={agent.name}>
                {agent.name}
                {agent.installed ? '' : ' (not installed)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Model
          <input
            placeholder="agent default"
            value={model ?? session.model ?? ''}
            onChange={(event) => setModel(event.target.value)}
            onBlur={() => {
              if (model !== undefined) void command({ type: 'model', model });
              setModel(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <span className="cwd" title={cwd}>
          {cwd.length > 36 ? `…${cwd.slice(-35)}` : cwd}
        </span>
        <span className="spacer" />
        {session.sessionId ? <span className="chip">session {shortId(session.sessionId)}</span> : null}
        {usage ? <span className="chip">{usage}</span> : null}
        <button
          className={`chip${view.bark ? '' : ' off'}`}
          title={view.bark ? 'The wolf barks when the agent needs you or finishes' : 'The wolf is quiet'}
          aria-pressed={view.bark}
          onClick={() => void command({ type: 'submit', text: `/bark ${view.bark ? 'off' : 'on'}` })}
        >
          {view.bark ? '🔊 Bark' : '🔇 Quiet'}
        </button>
        <span className={`conn${connected ? '' : ' off'}`} title={connected ? 'Connected' : 'Disconnected'} />
      </header>
      <main
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="thread">
          {session.turns.length === 0 ? (
            <div className="empty">
              <div className="wolf" role="img" aria-label="genaicode wolf" />
              <h1>What should {session.agent} work on?</h1>
              <div>It works in {cwd}, with its own login, tools and permissions.</div>
              <div className="ideas">
                {IDEAS.map((idea) => (
                  <button key={idea} onClick={() => send(idea)}>
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {items}
        </div>
      </main>
      <footer className="composer">
        <div className="composer-inner">
          {session.queued.length ? (
            <div className="queued">
              {session.queued.map((prompt, i) => (
                <span key={i}>⏸ {prompt}</span>
              ))}
            </div>
          ) : null}
          <div className="box">
            <textarea
              ref={input}
              rows={1}
              autoFocus
              value={draft}
              placeholder={
                running
                  ? session.canSteer
                    ? 'Add to the running task…'
                    : 'Queue the next prompt…'
                  : `Ask ${session.agent} to change something…`
              }
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
                if (event.key === 'Escape' && running) void command({ type: 'stop' });
              }}
            />
            {running ? (
              <button className="btn danger" onClick={() => void command({ type: 'stop' })}>
                Stop
              </button>
            ) : null}
            <button className="btn primary" disabled={!draft.trim()} onClick={() => send()}>
              {running ? (session.canSteer ? 'Steer' : 'Queue') : 'Send'}
            </button>
          </div>
          <div className="hint">
            <span>Enter to send · Shift+Enter for a new line · Esc stops</span>
            <span>/help for commands</span>
          </div>
        </div>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
