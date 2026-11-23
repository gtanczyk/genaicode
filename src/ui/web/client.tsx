import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentChat } from '../../react/agent-chat.js';
import styles from '../../react/agent-chat.css';
import type { ChatView } from '../controller.js';
import {
  firstLine,
  formatUsage,
  limitChips,
  needsAttention,
  parseSlash,
  shortId,
  SLASH_COMMANDS,
  splitAttached,
} from '../format.js';
import type { WebCommand } from './server.js';
import type { RateLimit } from '../../agents/types.js';
import { Sessions } from './sessions.js';
import { FilePanel } from './file-view.js';
import { Home } from './home.js';
import { ProjectTeamDialog } from './project-team.js';
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

/**
 * Sends `text`, first keeping `files` with the server so the agent can read them from the project.
 * Resolves to what went wrong when nothing was sent: a prompt never goes without one of its files.
 */
async function sendPrompt(text: string, files: File[], dropped: AbortSignal): Promise<string | undefined> {
  const ids: string[] = [];
  for (const file of files) {
    if (dropped.aborted) return STOPPED;
    const name = file.name || 'file';
    const res = await fetch(`/api/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'x-genaicode-token': token, 'content-type': 'application/octet-stream' },
      body: file,
      signal: dropped,
    }).catch(() => undefined);
    if (dropped.aborted) return STOPPED;
    const kept = res?.ok ? ((await res.json().catch(() => undefined)) as { id?: string } | undefined) : undefined;
    if (!kept?.id) {
      const why = !res ? 'genaicode did not answer' : res.status === 413 ? 'it is over 20 MB' : 'it could not be kept';
      return `Not sent: ${name} could not be attached (${why}).`;
    }
    ids.push(kept.id);
  }
  // Stop drops what waits, as it does the prompts queued with the agent.
  if (dropped.aborted) return STOPPED;
  const sent = await command(ids.length ? { type: 'submit', text, files: ids } : { type: 'submit', text }).catch(
    () => false,
  );
  return sent ? undefined : 'Not sent: genaicode did not take the message.';
}

const STOPPED = 'Not sent: stopped, or the conversation changed, before it left.';

/**
 * Aborted when the user stops the agent or moves to another agent or conversation: a prompt still
 * waiting here does not leave, its upload ends, and the next prompt does not wait behind it.
 */
let waiting = new AbortController();

function dropWaiting() {
  waiting.abort();
  waiting = new AbortController();
  sending = Promise.resolve();
}

/** Prompts leave in the order they were sent, also while the files of an earlier one upload. */
let sending: Promise<unknown> = Promise.resolve();

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
  /** False when the page names no project (`ui --no-project` or `ui --home`). */
  project?: boolean;
  /** True in `--home` mode: per-conversation working directory, no fixed project folder. */
  home?: boolean;
  sessions: boolean;
  uploads?: boolean;
  projectTeams?: boolean;
  files?: boolean;
  /** A newer version of the app that shows this page: downloading, or ready to install on a relaunch. */
  update?: { version: string; ready: boolean; installing?: boolean };
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
  const seen = useRef<ChatView>(undefined);
  const audio = useRef<HTMLAudioElement>(undefined);
  const unread = useRef(0);
  const topic = view?.conversation?.topic?.name;
  const baseTitle = topic ? `${topic} · genaicode` : 'genaicode';
  const baseTitleRef = useRef(baseTitle);
  baseTitleRef.current = baseTitle;
  useEffect(() => {
    document.title = unread.current ? `(${unread.current}) ${baseTitle}` : baseTitle;
  }, [baseTitle]);
  useEffect(() => {
    const hush = () => {
      if (document.visibilityState !== 'visible') return;
      unread.current = 0;
      document.title = baseTitleRef.current;
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
    seen.current = view;
    if (
      !needsAttention(before?.session, view.session, before?.notices, view.notices) ||
      (document.hasFocus() && document.visibilityState === 'visible')
    )
      return;
    unread.current += 1;
    document.title = `(${unread.current}) ${baseTitleRef.current}`;
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
/** Without a project the chat is about the work of every agent. */
const IDEAS_ANYWHERE = ['What is waiting for me?', 'What are my agents working on?', 'Sum up what got done today'];

function App() {
  const root = document.getElementById('root')!;
  const { view, config, connected, rejected } = useView();
  const cwd = config?.cwd ?? (root.dataset.cwd || view?.session.cwd || '');
  // Said at once: installing takes a few seconds before the app goes away.
  const [relaunching, setRelaunching] = useState(false);
  // An install that failed leaves the update waiting again: the button can be pressed once more.
  const waits = config?.update;
  useEffect(() => {
    if (waits?.ready) setRelaunching(false);
  }, [waits]);
  const hasProject = config ? config.project !== false : !root.dataset.noProject;
  const isHome = config ? config.home === true : !!root.dataset.home;
  const hasSessions = config?.sessions ?? !!root.dataset.sessions;
  useBark(view);
  const [model, setModel] = useState<string>();
  const [showTeam, setShowTeam] = useState(false);
  // The Sessions view takes the chat's place; the chat keeps running behind it.
  const [panel, setPanel] = useState<'chat' | 'sessions' | 'inbox'>('chat');
  const showSessions = panel === 'sessions';
  // Only the conversations this chat had itself, not every agent's sessions.
  const [own, setOwn] = useState(false);
  // The topic picked on the start screen: the Sessions view shows only it.
  const [topic, setTopic] = useState<string>();
  const session = view?.session;
  const conversation = view?.conversation;
  const activeCwd = conversation?.cwd || session?.cwd || cwd;
  const teamFolder = hasProject || (isHome && activeCwd !== cwd) ? activeCwd : undefined;
  const running = session?.status === 'running';
  const startTopicChat = (topicId: string) => {
    dropWaiting();
    setOpenFile(undefined);
    void command({ type: 'topic-chat', topic: topicId });
    setPanel('chat');
  };
  const startHomeChat = () => {
    dropWaiting();
    setOpenFile(undefined);
    void command(isHome ? { type: 'home-chat' } : { type: 'submit', text: '/clear' });
    setPanel('chat');
  };
  const convTopic = conversation?.topic?.name;
  const convTitle =
    conversation?.title || (session?.turns.length ? firstLine(session.turns[0]!.prompt) : undefined) || convTopic;
  root.classList.toggle('has-turns', !!session?.turns.length);
  // The Mac app draws the window's buttons over the page: the header leaves them room.
  root.classList.toggle('mac-app', '__TAURI_INTERNALS__' in window && /Mac/.test(navigator.platform));
  const plan = usePlanLimits(session?.agent, running);
  // What the session's own runs reported wins; until then, what was last seen of the agent's plan.
  const rateLimits = session?.rateLimits?.length ? session.rateLimits : plan;
  // On a plan the measure is the plan's own: a price there would be an estimate nobody pays.
  const onPlan = rateLimits.some((limit) => limit.window !== 'quota');
  const usage = session ? formatUsage(session.usage, onPlan ? undefined : session.costUsd) : '';
  const limits = session ? limitChips({ ...session, rateLimits }) : [];
  // A setting takes effect now: it does not wait behind a prompt whose files still upload.
  const control = (text: string) => void command({ type: 'submit', text });
  // Why the last message did not leave, shown under the transcript until the next one does.
  const [unsent, setUnsent] = useState<{ problem: string; text: string }>();
  // The file open beside the chat, by the path the agent named.
  const [openFile, setOpenFile] = useState<string>();
  const submit = (text: string, files?: File[]): Promise<boolean> => {
    // A command of genaicode's own takes effect now, also while an earlier prompt's files upload.
    const own = parseSlash(text);
    if (own) {
      if (files?.length) {
        setUnsent({ problem: 'Not sent: files go with a prompt, not with a command.', text: text.trim() });
        return Promise.resolve(false);
      }
      // Stopping or leaving the conversation drops what still waits here, as the buttons do.
      if (['stop', 'new', 'clear', 'continue', 'agent', 'quit'].includes(own.kind)) dropWaiting();
      return command({ type: 'submit', text }).then(
        () => true,
        () => true,
      );
    }
    const dropped = waiting.signal;
    const mine = sending.then(() => sendPrompt(text, files ?? [], dropped));
    sending = mine;
    return mine.then((problem) => {
      // With its words: the composer takes them back only while it is empty.
      setUnsent(problem ? { problem, text: text.trim() } : undefined);
      return !problem;
    });
  };

  const efforts = view?.agents.find((agent) => agent.name === session?.agent)?.effort ?? [];
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
          onChange={(event) => {
            // What still waits here was meant for the other agent.
            dropWaiting();
            void command({ type: 'agent', name: event.target.value });
          }}
        >
          {view.agents.map((agent) => (
            <option key={agent.name} value={agent.name}>
              {agent.name}
              {!agent.installed ? ' (not installed)' : agent.canAsk === false ? ' (no questions)' : ''}
            </option>
          ))}
        </select>
        <input
          aria-label="Model"
          title="The model id, or empty for the agent's default"
          placeholder="model"
          size={Math.max(5, (model ?? session.model ?? '').length)}
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
        {efforts.length > 0 && (
          <select
            aria-label="Effort"
            title="How hard the agent thinks, from the next prompt"
            value={session.effort ?? 'default'}
            onChange={(event) => control(`/effort ${event.target.value}`)}
          >
            <option value="default">effort</option>
            {efforts.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          title={
            view.autoApprove
              ? 'Every permission request is approved without asking'
              : 'The agent asks before commands and edits it needs permission for'
          }
          aria-pressed={view.autoApprove}
          onClick={() => control(`/auto ${view.autoApprove ? 'off' : 'on'}`)}
        >
          {view.autoApprove ? '✓ Auto-approve' : 'Ask first'}
        </button>
      </div>
    ) : null;

  return (
    <>
      {/* In the desktop app the header is the window's title bar: it moves the window. */}
      <header className="bar" data-tauri-drag-region="deep">
        <div className="brand">
          <img src="/assets/wolf-64.png" alt="" /> genaicode <small>{root.dataset.version}</small>
        </div>
        {cwd && hasProject ? (
          <span className="cwd" title={cwd}>
            {cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd}
          </span>
        ) : !hasProject && (convTitle || convTopic) ? (
          <div className="conv-head" title={activeCwd || undefined}>
            <span className="conv-title">{convTitle ?? convTopic}</span>
            {convTopic && convTopic !== convTitle ? <small className="conv-topic">{convTopic}</small> : null}
          </div>
        ) : null}
        <span className="spacer" />
        {view && session ? (
          <>
            {session.sessionId ? <span className="chip">session {shortId(session.sessionId)}</span> : null}
            {usage ? <span className="chip">{usage}</span> : null}
            {(session.turns.length || (isHome && conversation && conversation.origin !== 'home')) && !showSessions ? (
              <button
                className="chip off"
                title="Start a new conversation: a fresh agent session and an empty screen. This one stays in the list."
                onClick={startHomeChat}
              >
                New chat
              </button>
            ) : null}
            {hasSessions && !hasProject && !showSessions ? (
              <button
                className="chip off"
                title="The conversations you had in this app"
                onClick={() => {
                  setTopic(undefined);
                  setOwn(true);
                  setPanel('sessions');
                }}
              >
                Chats
              </button>
            ) : null}
            {hasSessions ? (
              <button
                className={`chip${showSessions ? '' : ' off'}`}
                title="What every agent on this machine has going on, by project"
                aria-pressed={showSessions}
                onClick={() => {
                  setTopic(undefined);
                  setOwn(false);
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
        {config?.projectTeams && (
          <button type="button" className="chip off" aria-haspopup="dialog" onClick={() => setShowTeam(true)}>
            Project team
          </button>
        )}
        {config?.update ? (
          <button
            className="chip update"
            disabled={!config.update.ready || relaunching}
            title={
              config.update.installing
                ? `Version ${config.update.version} is being installed. The app starts again in a moment.`
                : config.update.ready
                  ? `Version ${config.update.version} is downloaded. Relaunching installs it and stops the agents this app runs.`
                  : `Version ${config.update.version} is downloading. Nothing installs before you choose it.`
            }
            onClick={() => {
              setRelaunching(true);
              fetch('/api/relaunch', { method: 'POST', headers: { 'x-genaicode-token': token } })
                .then((reply) => reply.ok || setRelaunching(false))
                .catch(() => setRelaunching(false));
            }}
          >
            {relaunching || config.update.installing
              ? 'Relaunching…'
              : config.update.ready
                ? 'Relaunch to update'
                : 'Downloading update…'}
          </button>
        ) : null}
        <span className={`conn${connected ? '' : ' off'}`} title={connected ? 'Connected' : 'Disconnected'} />
      </header>
      {showTeam && (
        <ProjectTeamDialog
          token={token}
          key={activeCwd}
          chooseProject={!teamFolder}
          cwd={teamFolder}
          sessions={hasSessions}
          onClose={() => setShowTeam(false)}
        />
      )}
      {showSessions ? (
        <Sessions
          token={token}
          cwd={activeCwd}
          home={isHome}
          topic={topic}
          onAllTopics={() => setTopic(undefined)}
          own={own}
          onAllSessions={() => setOwn(false)}
          onNewTopicChat={isHome ? startTopicChat : undefined}
          onContinue={(found) => {
            // The chat says what happened, also when it could not.
            // What still waits here was meant for the conversation that is left.
            dropWaiting();
            setOpenFile(undefined);
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
        onOpenFile={config?.files ? setOpenFile : undefined}
        renderPrompt={promptBubble}
        renderFooter={() =>
          unsent ? (
            <div className="gc-notice gc-err">
              {unsent.problem}
              {unsent.text ? <blockquote className="unsent">{unsent.text}</blockquote> : null}
            </div>
          ) : null
        }
        onSend={submit}
        onStop={() => {
          dropWaiting();
          void command({ type: 'stop' });
        }}
        canStop={!!view?.shells}
        onApprove={(id, decision) => void command({ type: 'approve', id, decision })}
        onAnswer={(id, answers) => void command({ type: 'answer', id, answers })}
        onAutoApprove={view?.autoApprove ? undefined : () => control('/auto on')}
        onPackAction={async (turnId, id, action) => {
          const reply = await postCommand({ type: 'pack-task', turnId, id, action });
          if (!reply.ok) throw new Error(reply.error ?? 'The task action failed.');
          return reply.text ?? '';
        }}
        hint={null}
        composerTitle={`Enter sends, Shift+Enter starts a new line, Esc stops. / lists the commands${config?.uploads ? '; paste or drop files to attach them' : ''}.`}
        emptyState={
          session ? (
            <div className="gc-empty">
              <div className="wolf" role="img" aria-label="genaicode wolf" />
              <h1>
                {hasProject
                  ? `What should ${session.agent} work on?`
                  : isHome && conversation?.topic
                    ? conversation.origin === 'unresolved'
                      ? `Where should ${session.agent} work for ${conversation.topic.name}?`
                      : `What should ${session.agent} work on in ${conversation.topic.name}?`
                    : isHome && conversation?.origin === 'project'
                      ? `What should ${session.agent} work on?`
                      : `What should ${session.agent} look into?`}
              </h1>
              <div>
                {hasProject
                  ? `It works in ${cwd}, with its own login, tools and permissions.`
                  : isHome && conversation?.topic
                    ? conversation.origin === 'unresolved'
                      ? 'No local folder was found for this topic. Mention a directory (e.g. ~/src/…) to move there.'
                      : "Working in this topic's workspace. Hover the header or type /where to see the directory."
                    : isHome && conversation?.origin === 'project'
                      ? 'Hover the header or type /where to see the directory.'
                      : 'It sees the sessions of your agents in every project, and can pass them a message.'}
              </div>
              {hasSessions && (!isHome || !conversation || conversation.origin === 'home') ? (
                <Home
                  token={token}
                  onTopic={(id) => {
                    setTopic(id);
                    setOwn(false);
                    setPanel('sessions');
                  }}
                  onNewTopicChat={isHome ? startTopicChat : undefined}
                />
              ) : null}
              <div className="ideas">
                {(hasProject || (isHome && conversation && conversation.origin !== 'home')
                  ? IDEAS
                  : IDEAS_ANYWHERE
                ).map((idea) => (
                  <button key={idea} onClick={() => void submit(idea)}>
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
      {openFile ? <FilePanel path={openFile} token={token} onClose={() => setOpenFile(undefined)} /> : null}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
