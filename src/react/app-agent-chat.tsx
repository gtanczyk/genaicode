import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { SessionState, SessionTurn } from '../agents/session.js';
import type { ApprovalDecision } from '../agents/types.js';
import {
  APP_NOTE,
  userText,
  type AppAction,
  type AppAgentMode,
  type AppAgentState,
  type TreeChanges,
} from '../app-agent/state.js';
import { AgentChat, type ChatNotice } from './agent-chat.js';
import { toolLabel } from './format.js';

// `mcp__app__tool` (Claude, Copilot) or `app/tool` (Codex) shows as `tool`.
const MCP_PREFIX = /^(mcp__[A-Za-z0-9_-]+__|[A-Za-z0-9_-]+\/)/;

/** The page side of `createAppAgentHandler`: live state and the calls that drive it. */
export interface AppAgentClient {
  /** Null until the first event arrives. */
  state: AppAgentState | null;
  /** The last failed call or a lost event stream. */
  error: string | null;
  send(text: string): void;
  stop(): void;
  reset(): void;
  configure(change: { agent?: string; mode?: AppAgentMode }): void;
  /** Tell the agent which page is open. */
  view(path: string): void;
  decide(id: string, decision: 'approve' | 'reject' | 'dismiss'): void;
  approve(id: string, decision: ApprovalDecision): void;
  changes(id: string): Promise<TreeChanges>;
}

export interface AppAgentClientOptions {
  /**
   * URL of the event stream. Default `<basePath>/events`. `EventSource` cannot send headers,
   * so an app that wants a key on every request puts it in this URL's query.
   */
  eventsUrl?: string;
}

/**
 * Connect to an app agent served by `createAppAgentHandler` at `basePath` (default
 * `/api/agent`, same origin). Calls send the page's cookies, so the app's `authorize` sees them.
 */
export function useAppAgent(basePath = '/api/agent', options: AppAgentClientOptions = {}): AppAgentClient {
  const base = basePath.replace(/\/$/, '');
  const eventsUrl = options.eventsUrl ?? `${base}/events`;
  const [state, setState] = useState<AppAgentState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // While the stream is up it is the truth: a POST reply can be older than its latest snapshot.
  const streaming = useRef(false);
  // Another backend: nothing from the old one may stay on screen or land late, or a card could send
  // its id to the new one.
  const current = useRef(base);
  current.current = base;
  useEffect(() => {
    setState(null);
    const source = new EventSource(eventsUrl);
    source.onmessage = (event) => {
      streaming.current = true;
      setError(null);
      setState(JSON.parse(event.data as string) as AppAgentState);
    };
    source.onerror = () => {
      streaming.current = false;
      setError('Lost the connection to the agent; retrying…');
    };
    return () => {
      streaming.current = false;
      source.close();
    };
  }, [base, eventsUrl]);

  const call = useCallback(
    (route: string, body: unknown = {}) => {
      setError(null);
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (res.status === 204) return;
          const data = (await res.json()) as AppAgentState & { error?: string };
          if (current.current !== base) return;
          if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
          if (!streaming.current) setState(data);
        })
        .catch((e: Error) => {
          if (current.current === base) setError(e.message);
        });
    },
    [base],
  );
  // Stable, so a card does not reload its diff on every streamed update.
  const changes = useCallback(
    async (id: string) => {
      const res = await fetch(`${base}/actions/${encodeURIComponent(id)}/changes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as TreeChanges;
    },
    [base],
  );

  return useMemo(
    () => ({
      state,
      error,
      send: (text) => call('/send', { text }),
      stop: () => call('/stop'),
      reset: () => call('/reset'),
      configure: (change) => call('/config', change),
      view: (path) => call('/view', { path }),
      decide: (id, decision) => call(`/actions/${encodeURIComponent(id)}`, { decision }),
      approve: (id, decision) => call(`/approvals/${encodeURIComponent(id)}`, { decision }),
      changes,
    }),
    [state, error, call, changes],
  );
}

export interface AppAgentChatProps {
  /** Where `createAppAgentHandler` is mounted. Default `/api/agent`. */
  basePath?: string;
  /** Or pass a client you already hold (`useAppAgent`), e.g. to share it with the page. */
  client?: AppAgentClient;
  /** The page the user has open, reported to the agent whenever it changes. */
  currentPath?: string;
  /** Open a page of the app: a link chip was clicked or the agent was asked to go there. */
  onNavigate?(path: string): void;
  /** Mode button labels. Default `use` and `dev`. */
  modeLabels?: Partial<Record<AppAgentMode, string>>;
  /** A line under the header, e.g. a warning that dev mode edits the running app. */
  banner?: ReactNode;
  /** How an action card describes what will run. Default: the tool and its arguments. */
  renderAction?(action: AppAction): ReactNode;
  emptyState?: ReactNode;
  placeholder?: string;
  /** Fold each turn's work into one "N steps" line; see `AgentChatProps.foldSteps`. */
  foldSteps?: boolean;
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
  style?: CSSProperties;
}

/**
 * The chat for an app agent: `<AgentChat>` plus the app agent's own parts, all drawn from
 * the state the server streams. Under each reply it shows the agent's page chips; after the
 * transcript, the actions waiting for the user (with the diff of a proposed commit); in the
 * header, the agent picker, the modes and "New". Turns from before a switch stay in place.
 */
export function AppAgentChat(props: AppAgentChatProps) {
  return props.client ? <AppAgentView {...props} client={props.client} /> : <ConnectedChat {...props} />;
}

function ConnectedChat(props: AppAgentChatProps) {
  const client = useAppAgent(props.basePath);
  return <AppAgentView {...props} client={client} />;
}

function AppAgentView(props: AppAgentChatProps & { client: AppAgentClient }) {
  const { client } = props;
  const { state } = client;
  const { onNavigate, currentPath } = props;

  // Report the open page; the agent reads it with each prompt. Once until the server's state
  // shows it, then again whenever it does not: a restarted or another backend starts without it.
  const reported = useRef<string | null>(null);
  // A lost report or a lost stream (maybe a restarted backend) leaves nothing acknowledged: report
  // again, but only on the next streamed state, so a backend that keeps refusing is not hammered.
  const retry = useRef<AppAgentState | null | undefined>(undefined);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (client.error) retry.current = latest.current;
  }, [client.error]);
  const serverView = state?.view;
  useEffect(() => {
    // No state yet: a new connection or another backend, which has heard nothing.
    if (!state) reported.current = null;
    if (!state || currentPath === undefined) return;
    if (serverView === currentPath) {
      reported.current = null;
      return;
    }
    if (retry.current !== undefined && retry.current !== state) {
      retry.current = undefined;
      reported.current = null;
    }
    if (reported.current === currentPath) return;
    reported.current = currentPath;
    client.view(currentPath);
  }, [client, state, serverView, currentPath]);

  // Follow `app_open` once per request; the first state only primes the counter.
  const handled = useRef<number | null>(null);
  const navigation = state?.navigation;
  useEffect(() => {
    if (!state) return;
    const id = navigation?.id ?? 0;
    const primed = handled.current !== null;
    if (handled.current === id) return;
    handled.current = id;
    if (primed && navigation) onNavigate?.(navigation.path);
  }, [state, navigation, onNavigate]);

  const shown = useMemo(() => merged(state), [state]);
  const notices = useMemo(() => switchNotices(state), [state]);
  // An approved action that still runs blocks switches and New on the server too.
  const running =
    state?.session?.status === 'running' || !!state?.actions.some((action) => action.status === 'running');
  const labels = { use: 'use', dev: 'dev', ...props.modeLabels };
  const pending = state?.actions.filter((action) => action.status === 'pending' || action.status === 'running');
  const settled = state?.actions.filter((action) => action.status !== 'pending' && action.status !== 'running');

  return (
    <AgentChat
      state={shown}
      onSend={client.send}
      onStop={client.stop}
      onApprove={client.approve}
      foldSteps={props.foldSteps}
      renderPrompt={(text) => {
        const typed = userText(text);
        if (!typed.startsWith(APP_NOTE)) return typed;
        return <span className="gc-app-note">{typed.slice(APP_NOTE.length).split('\n')[0]}</span>;
      }}
      formatToolName={(name) => toolLabel(name.replace(MCP_PREFIX, ''))}
      renderAfterTurn={(turn) => {
        const links = state?.links.filter((link) => link.turnId === turn.id) ?? [];
        if (!links.length) return null;
        return (
          <div className="gc-app-links">
            {links.map((link, index) => (
              <button
                key={index}
                type="button"
                className={`gc-app-link${link.path === currentPath ? ' gc-here' : ''}`}
                title={link.path}
                onClick={() => onNavigate?.(link.path)}
              >
                {link.label}
              </button>
            ))}
          </div>
        );
      }}
      renderFooter={() =>
        state?.actions.length ? (
          <div className="gc-app-actions">
            {[...(settled ?? []), ...(pending ?? [])].map((action) => (
              <ActionCard key={action.id} action={action} client={client} render={props.renderAction} />
            ))}
            {client.error && <div className="gc-error">{client.error}</div>}
          </div>
        ) : client.error ? (
          <div className="gc-error">{client.error}</div>
        ) : null
      }
      notices={notices}
      headerExtras={
        state ? (
          <div className="gc-app-controls">
            {props.banner && <div className="gc-app-banner">{props.banner}</div>}
            <select
              aria-label="Agent"
              value={state.agent}
              disabled={running}
              onChange={(e) => client.configure({ agent: e.target.value })}
            >
              {state.agents.map((choice) => (
                <option key={choice.name} value={choice.name} disabled={!choice.installed}>
                  {choice.name}
                  {choice.installed ? '' : ' (not installed)'}
                </option>
              ))}
            </select>
            {state.modes.length > 1 && (
              <div className="gc-app-modes" role="group" aria-label="Mode">
                {state.modes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={state.mode === mode ? 'gc-on' : ''}
                    aria-pressed={state.mode === mode}
                    disabled={running}
                    onClick={() => client.configure({ mode })}
                  >
                    {labels[mode]}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="gc-btn" disabled={running} onClick={client.reset} title="New conversation">
              New
            </button>
          </div>
        ) : undefined
      }
      emptyState={props.emptyState}
      placeholder={props.placeholder}
      disabled={!state}
      theme={props.theme}
      className={['gc-app', props.className].filter(Boolean).join(' ')}
      style={props.style}
    />
  );
}

function ActionCard({
  action,
  client,
  render,
}: {
  action: AppAction;
  client: AppAgentClient;
  render?: (action: AppAction) => ReactNode;
}) {
  // A loaded diff belongs to one reviewed tree: ids start over when the server restarts.
  const key = `${action.id}:${action.commit?.tree ?? ''}:${action.commit?.base ?? ''}`;
  const [loaded, setLoaded] = useState<{ key: string; changes?: TreeChanges; error?: string } | null>(null);
  const changes = loaded?.key === key ? (loaded.changes ?? null) : null;
  const loadError = loaded?.key === key ? (loaded.error ?? null) : null;
  const { changes: load } = client;
  useEffect(() => {
    if (action.kind !== 'commit' || action.status !== 'pending') return;
    // A reply for a tree the card no longer shows is dropped.
    let current = true;
    load(action.id).then(
      (result) => current && setLoaded({ key, changes: result }),
      (error: unknown) => current && setLoaded({ key, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [action.id, action.kind, action.status, key, load]);
  // A commit is approved only after its diff has been shown.
  const blocked = action.kind === 'commit' && (!changes || changes.truncated === true);

  const what =
    render?.(action) ??
    (action.kind === 'commit' ? (
      <pre>{action.commit?.message}</pre>
    ) : (
      <>
        <code>{action.tool?.name}</code>
        {action.tool && Object.keys(action.tool.args).length > 0 && (
          <pre>{JSON.stringify(action.tool.args, null, 2)}</pre>
        )}
      </>
    ));

  return (
    <div className={`gc-app-action gc-${action.status}`}>
      <div className="gc-app-action-head">
        <strong>{action.summary}</strong>
        <span className="gc-app-action-tags">
          <span className="gc-chip">{action.kind === 'commit' ? 'commit' : action.status}</span>
          {action.status !== 'pending' && action.status !== 'running' && (
            <button
              type="button"
              className="gc-app-dismiss"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => client.decide(action.id, 'dismiss')}
            >
              ×
            </button>
          )}
        </span>
      </div>
      {what}
      {changes && (
        <details>
          <summary>
            {changes.files.length} changed file{changes.files.length === 1 ? '' : 's'}
          </summary>
          <pre>{changes.files.map((file) => `${file.status.padEnd(2)} ${file.path}`).join('\n')}</pre>
          <pre className="gc-app-diff">{changes.diff}</pre>
        </details>
      )}
      {changes?.binary && (
        <div className="gc-app-diff-status">
          Binary, contents not shown: {changes.binary.join(', ')}. Check them in your editor before approving.
        </div>
      )}
      {action.status === 'pending' && blocked && (
        <div className="gc-app-diff-status">
          {changes?.truncated
            ? 'The diff is too large to review here. Reject it and commit from git yourself.'
            : loadError
              ? `Could not load the changes: ${loadError}`
              : 'Loading the changes…'}
        </div>
      )}
      {action.status === 'pending' ? (
        <div className="gc-buttons">
          <button
            type="button"
            className="gc-btn gc-primary"
            disabled={blocked}
            onClick={() => client.decide(action.id, 'approve')}
          >
            Approve
          </button>
          <button type="button" className="gc-btn gc-danger" onClick={() => client.decide(action.id, 'reject')}>
            Reject
          </button>
        </div>
      ) : (
        action.result && (
          <details>
            <summary>{action.status === 'running' ? 'Running…' : 'Result'}</summary>
            <pre>{action.result}</pre>
          </details>
        )
      )}
    </div>
  );
}

// History first, then the live session, as one transcript.
function merged(state: AppAgentState | null): SessionState | null {
  if (!state) return null;
  const { session, history } = state;
  if (!history.length) return session;
  if (session) return { ...session, turns: [...history, ...session.turns] };
  return {
    agent: state.agent,
    cwd: '',
    status: 'idle',
    turns: history,
    queued: [],
    approvals: [],
    usage: {},
    canSteer: false,
  };
}

// "Continued with <agent>" where the agent changed.
function switchNotices(state: AppAgentState | null): ChatNotice[] {
  if (!state?.history.length) return [];
  const turns: SessionTurn[] = [...state.history, ...(state.session?.turns ?? [])];
  const notices: ChatNotice[] = [];
  for (let index = 1; index < turns.length; index++) {
    const before = turns[index - 1]!;
    const after = turns[index]!;
    if ((before.id < 0 && after.id > 0) || before.agent !== after.agent) {
      notices.push({ id: `switch-${index}`, afterTurn: index, text: `Continued with ${after.agent}` });
    }
  }
  if (!state.session && state.history.length) {
    notices.push({ id: 'switch-end', afterTurn: turns.length, text: `Continued with ${state.agent} (${state.mode})` });
  }
  return notices;
}
