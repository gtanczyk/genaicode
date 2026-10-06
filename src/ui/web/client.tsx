import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentChat } from '../../react/agent-chat.js';
import styles from '../../react/agent-chat.css';
import type { ChatView } from '../controller.js';
import { formatUsage, needsAttention, shortId } from '../format.js';
import type { WebCommand } from './server.js';

// The page is the same <AgentChat> hosts get from genaicode/react, fed by this server's SSE.
const style = document.createElement('style');
style.textContent = styles;
document.head.append(style);

const token = new URLSearchParams(location.search).get('token') ?? '';

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

const IDEAS = ['Explain how this project is organized', 'Find and fix a failing test', 'Add a --verbose flag'];

function App() {
  const root = document.getElementById('root')!;
  const cwd = root.dataset.cwd ?? '';
  const { view, connected } = useView();
  useBark(view);
  const [model, setModel] = useState<string>();
  const session = view?.session;
  const running = session?.status === 'running';
  root.classList.toggle('has-turns', !!session?.turns.length);
  const usage = session ? formatUsage(session.usage, session.costUsd) : '';
  const submit = (text: string) => void command({ type: 'submit', text });

  return (
    <>
      <header className="bar">
        <div className="brand">
          <img src="/assets/wolf-64.png" alt="" /> genaicode <small>{root.dataset.version}</small>
        </div>
        {view && session ? (
          <>
            <label className="field">
              Agent
              <select
                value={session.agent}
                disabled={running}
                onChange={(event) => void command({ type: 'agent', name: event.target.value })}
              >
                {view.agents.map((agent) => (
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
              onClick={() => submit(`/bark ${view.bark ? 'off' : 'on'}`)}
            >
              {view.bark ? '🔊 Bark' : '🔇 Quiet'}
            </button>
          </>
        ) : (
          <span className="spacer" />
        )}
        <span className={`conn${connected ? '' : ' off'}`} title={connected ? 'Connected' : 'Disconnected'} />
      </header>
      <AgentChat
        state={session}
        header={null}
        autoFocus
        disabled={!connected}
        notices={view?.notices}
        onSend={submit}
        onStop={() => void command({ type: 'stop' })}
        onApprove={(id, decision) => void command({ type: 'approve', id, decision })}
        hint={
          <>
            <span>Enter to send · Shift+Enter for a new line · Esc stops</span>
            <span>/help for commands</span>
          </>
        }
        emptyState={
          session ? (
            <div className="gc-empty">
              <div className="wolf" role="img" aria-label="genaicode wolf" />
              <h1>What should {session.agent} work on?</h1>
              <div>It works in {cwd}, with its own login, tools and permissions.</div>
              <div className="ideas">
                {IDEAS.map((idea) => (
                  <button key={idea} onClick={() => submit(idea)}>
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="gc-empty">Connecting…</div>
          )
        }
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
