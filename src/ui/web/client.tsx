import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentChat } from '../../react/agent-chat.js';
import styles from '../../react/agent-chat.css';
import type { ChatView } from '../controller.js';
import { formatUsage, limitChips, needsAttention, shortId, SLASH_COMMANDS, splitAttached } from '../format.js';
import type { WebCommand } from './server.js';
import type { RateLimit } from '../../agents/types.js';
import { Sessions } from './sessions.js';
import { Home } from './home.js';
import { TowerInboxPanel } from './tower-inbox.js';

// The page is the same <AgentChat> hosts get from genaicode/react, fed by this server's SSE.
const style = document.createElement('style');
style.textContent = styles;
document.head.append(style);

// Top-level tabs move ?token= into origin-isolated sessionStorage before paint; framed loads keep it in the URL.
const token = (() => {
  const win = window as unknown as { __genaicodeToken?: string };
  const initial = win.__genaicodeToken ?? new URLSearchParams(location.search).get('token') ?? '';
  delete win.__genaicodeToken;
  if (initial) return initial;
  try {
    return sessionStorage.getItem('genaicode-token') ?? '';
  } catch {
    return '';
  }
})();

async function postCommand(body: WebCommand) {
  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok?: boolean; text?: string; error?: string };
}

async function command(body: WebCommand): Promise<boolean> {
  return (await postCommand(body)).ok === true;
}

/** Sends `text`, first keeping `files` with the server so the agent can read them from the project. */
async function sendPrompt(text: string, files: File[] = []): Promise<void> {
  const ids: string[] = [];
  for (const file of files) {
    // One that fails is left out: the server says why in the chat.
    const kept = await fetch(`/api/upload?name=${encodeURIComponent(file.name || 'file')}`, {
      method: 'POST',
      headers: { 'x-genaicode-token': token, 'content-type': 'application/octet-stream' },
      body: file,
    }).then(
      (res) => (res.ok ? (res.json() as Promise<{ id?: string }>) : undefined),
      () => undefined,
    );
    if (kept?.id) ids.push(kept.id);
  }
  if (!text.trim() && files.length && !ids.length) return;
  await command(ids.length ? { type: 'submit', text, files: ids } : { type: 'submit', text });
}

/** A prompt as its bubble shows it: the files sent with it as thumbnails and names, not as paths. */
function promptBubble(text: string) {
  const { text: said, files } = splitAttached(text);
  if (!files.length) return text;
  return (
    <>
      {said}
      <span className="sent-files">
        {files.map((file) =>
          file.id && /\.(png|jpe?g|gif|webp)$/i.test(file.name) ? (
            <img key={file.path} src={`/uploads/${file.id}`} alt={file.name} title={file.name} />
          ) : (
            <span key={file.path} className="chip" title={file.path}>
              {file.name}
            </span>
          ),
        )}
      </span>
    </>
  );
}

/** How often the limits last seen are asked for again. */
const LIMITS_EVERY_MS = 60_000;

/**
 * The limits last seen of `agent`'s plan (`/api/limits`): asked when the agent changes, when a turn
 * ends, and every minute. `codexLive` and `codex` draw on one account.
 */
function usePlanLimits(agent: string | undefined, running: boolean): RateLimit[] {
  const [limits, setLimits] = useState<RateLimit[]>([]);
  useEffect(() => {
    if (!agent || !token) return;
    let current = true;
    const account = agent.replace(/Live$/, '');
    const ask = () =>
      fetch('/api/limits', { headers: { 'x-genaicode-token': token } })
        .then((res) => (res.ok ? (res.json() as Promise<{ limits?: Array<RateLimit & { agent: string }> }>) : {}))
        .then(
          (found: { limits?: Array<RateLimit & { agent: string }> }) => {
            if (!current) return;
            setLimits((found.limits ?? []).filter((limit) => limit.agent === account));
          },
          () => undefined,
        );
    setLimits([]);
    void ask();
    const timer = window.setInterval(ask, LIMITS_EVERY_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [agent, running]);
  return limits;
}

interface PageConfig {
  cwd: string;
  sessions: boolean;
  uploads?: boolean;
}

function useView(): { view?: ChatView; config?: PageConfig; connected: boolean; rejected: boolean } {
  const [view, setView] = useState<ChatView>();
  const [config, setConfig] = useState<PageConfig>();
  const [connected, setConnected] = useState(false);
  const [rejected, setRejected] = useState(!token);
  useEffect(() => {
    if (!token) return;
    const abort = new AbortController();
    let timer: number | undefined;
    const connect = async () => {
      try {
        const res = await fetch('/api/events', {
          headers: { 'x-genaicode-token': token },
          signal: abort.signal,
        });
        if (res.status === 403) {
          setConnected(false);
          setRejected(true);
          try {
            sessionStorage.removeItem('genaicode-token');
          } catch {
            // Storage unavailable.
          }
          return;
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (let sep = buffer.indexOf('\n\n'); sep !== -1; sep = buffer.indexOf('\n\n')) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            let event = 'message';
            const data: string[] = [];
            for (const line of block.split(/\r?\n/)) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if (!data.length) continue;
            const payload = data.join('\n');
            if (event === 'view') {
              setView(JSON.parse(payload) as ChatView);
              setConnected(true);
            } else if (event === 'config') {
              setConfig(JSON.parse(payload) as PageConfig);
            }
          }
        }
      } catch {
        if (abort.signal.aborted) return;
      }
      setConnected(false);
      if (!abort.signal.aborted) timer = window.setTimeout(() => void connect(), 1500);
    };
    void connect();
    return () => {
      abort.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  return { view, config, connected, rejected };
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

/** As many files as the server takes with one prompt. */
const ATTACH = { max: 8 };

const IDEAS = ['Explain how this project is organized', 'Find and fix a failing test', 'Add a --verbose flag'];

function App() {
  const root = document.getElementById('root')!;
  const { view, config, connected, rejected } = useView();
  const cwd = config?.cwd ?? (root.dataset.cwd || view?.session.cwd || '');
  const hasSessions = config?.sessions ?? !!root.dataset.sessions;
  useBark(view);
  const [model, setModel] = useState<string>();
  // The Sessions view takes the chat's place; the chat keeps running behind it.
  const [panel, setPanel] = useState<'chat' | 'sessions' | 'inbox'>('chat');
  const showSessions = panel === 'sessions';
  // The topic picked on the start screen: the Sessions view shows only it.
  const [topic, setTopic] = useState<string>();
  const session = view?.session;
  const running = session?.status === 'running';
  root.classList.toggle('has-turns', !!session?.turns.length);
  const plan = usePlanLimits(session?.agent, running);
  // What the session's own runs reported wins; until then, what was last seen of the agent's plan.
  const rateLimits = session?.rateLimits?.length ? session.rateLimits : plan;
  // On a plan the measure is the plan's own: a price there would be an estimate nobody pays.
  const onPlan = rateLimits.some((limit) => limit.window !== 'quota');
  const usage = session ? formatUsage(session.usage, onPlan ? undefined : session.costUsd) : '';
  const limits = session ? limitChips({ ...session, rateLimits }) : [];
  const submit = (text: string, files?: File[]) => void sendPrompt(text, files);

  // What the next prompt runs with sits where it is typed, not in a bar above the conversation.
  const controls =
    view && session ? (
      <div className="run-with">
        {limits.map((chip) => (
          <span key={chip.key} className="chip" data-level={chip.level} title={chip.title}>
            {chip.text}
          </span>
        ))}
        <select
          aria-label="Agent"
          title="The agent the next prompt goes to"
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
        <input
          aria-label="Model"
          title="The model id, or empty for the agent's default"
          placeholder="default model"
          size={Math.max(12, (model ?? session.model ?? '').length)}
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
        <button
          type="button"
          title={
            view.autoApprove
              ? 'Every permission request is approved without asking'
              : 'The agent asks before commands and edits it needs permission for'
          }
          aria-pressed={view.autoApprove}
          onClick={() => submit(`/auto ${view.autoApprove ? 'off' : 'on'}`)}
        >
          {view.autoApprove ? 'Auto-approve' : 'Ask first'}
        </button>
        <button
          type="button"
          aria-label={view.bark ? 'Bark on' : 'Bark off'}
          title={view.bark ? 'The wolf barks when the agent needs you or finishes' : 'The wolf is quiet'}
          aria-pressed={view.bark}
          onClick={() => submit(`/bark ${view.bark ? 'off' : 'on'}`)}
        >
          {view.bark ? '🔊' : '🔇'}
        </button>
      </div>
    ) : null;

  return (
    <>
      <header className="bar">
        <div className="brand">
          <img src="/assets/wolf-64.png" alt="" /> genaicode <small>{root.dataset.version}</small>
        </div>
        {cwd ? (
          <span className="cwd" title={cwd}>
            {cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd}
          </span>
        ) : null}
        <span className="spacer" />
        {view && session ? (
          <>
            {session.sessionId ? <span className="chip">session {shortId(session.sessionId)}</span> : null}
            {usage ? <span className="chip">{usage}</span> : null}
            {hasSessions ? (
              <button
                className={`chip${showSessions ? '' : ' off'}`}
                title="What every agent on this machine has going on, by project"
                aria-pressed={showSessions}
                onClick={() => {
                  setTopic(undefined);
                  setPanel(showSessions ? 'chat' : 'sessions');
                }}
              >
                {showSessions ? '← Chat' : 'Sessions'}
              </button>
            ) : null}
            {view.tower && (
              <button
                className={`chip${view.tower.items.length ? ' waits' : ''}`}
                aria-pressed={panel === 'inbox'}
                onClick={() => setPanel(panel === 'inbox' ? 'chat' : 'inbox')}
              >
                {panel === 'inbox' ? '← Chat' : `Tower inbox · ${view.tower.items.length}`}
              </button>
            )}
          </>
        ) : null}
        <span className={`conn${connected ? '' : ' off'}`} title={connected ? 'Connected' : 'Disconnected'} />
      </header>
      {showSessions ? (
        <Sessions
          token={token}
          cwd={cwd}
          topic={topic}
          onAllTopics={() => setTopic(undefined)}
          onContinue={(found) => {
            // The chat says what happened, also when it could not.
            void command({ type: 'continue', id: found.id });
            setPanel('chat');
          }}
        />
      ) : null}
      {panel === 'inbox' && view?.tower && (
        <TowerInboxPanel
          view={view.tower}
          connected={connected}
          decide={(id, decision) => command({ type: 'tower', id, decision })}
        />
      )}
      <AgentChat
        state={session}
        style={panel !== 'chat' ? { display: 'none' } : undefined}
        header={null}
        // The work in one line that opens on click: a long run of tool calls buries the answer.
        foldSteps
        autoFocus
        disabled={!connected}
        notices={view?.notices}
        artifactUrl={(artifact) => `/artifacts/${artifact.id}?v=${artifact.version}`}
        completions={SLASH_COMMANDS}
        composerExtras={controls}
        attachments={config?.uploads ? ATTACH : undefined}
        renderPrompt={promptBubble}
        onSend={submit}
        onStop={() => void command({ type: 'stop' })}
        canStop={!!view?.shells}
        onApprove={(id, decision) => void command({ type: 'approve', id, decision })}
        onAutoApprove={view?.autoApprove ? undefined : () => submit('/auto on')}
        onPackAction={async (turnId, id, action) => {
          const reply = await postCommand({ type: 'pack-task', turnId, id, action });
          if (!reply.ok) throw new Error(reply.error ?? 'The task action failed.');
          return reply.text ?? '';
        }}
        hint={
          <>
            <span>Enter to send · Shift+Enter for a new line · Esc stops</span>
            <span>/ for commands{config?.uploads ? ' · paste or drop files' : ''}</span>
          </>
        }
        emptyState={
          session ? (
            <div className="gc-empty">
              <div className="wolf" role="img" aria-label="genaicode wolf" />
              <h1>What should {session.agent} work on?</h1>
              <div>It works in {cwd}, with its own login, tools and permissions.</div>
              {hasSessions ? (
                <Home
                  token={token}
                  onTopic={(id) => {
                    setTopic(id);
                    setPanel('sessions');
                  }}
                />
              ) : null}
              <div className="ideas">
                {IDEAS.map((idea) => (
                  <button key={idea} onClick={() => submit(idea)}>
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          ) : rejected ? (
            <div className="gc-empty">Open the link genaicode printed in your terminal (it carries a token).</div>
          ) : (
            <div className="gc-empty">Connecting…</div>
          )
        }
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
