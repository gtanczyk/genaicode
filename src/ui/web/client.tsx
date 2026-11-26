import type { ChatSummary } from '../hub.js';
import {
  chatFetch,
  chatUrl,
  pageChat,
  showChat,
  savedDraft,
  rememberDraft,
  uploadedFiles,
  restoreQueued,
} from './chat-route.js';
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { ReleaseNotes } from './release-notes.js';
import { takeEvents } from './sse.js';
import { createRoot } from 'react-dom/client';
import { personText } from '../../agents/host-text.js';
import { AgentChat, artifactSubmission } from '../../react/agent-chat.js';
import styles from '../../react/agent-chat.css';
import { EscapeActive, useEscape } from '../../react/escape.js';
import { storedSize } from '../../react/resize-handle.js';
import { WorkPanel } from '../../react/work-panel.js';
import {
  pullRequestSettled,
  readWorkView,
  WORK_PANEL_MIN,
  WORK_PANEL_VIEWER,
  WORK_TABS,
  WORK_WIDTH_KEY,
  workArtifacts,
  workChanges,
  workNeedsYou,
  workPanelLayout,
  workTasks,
  writeWorkView,
  type PullRequestStatus,
  type WorkPanelView,
  type WorkTask,
} from '../../react/work.js';
import { submitAction } from '../../react/format.js';
import { extractLocalImagePaths, isPathWithin, resolveFilePath, type FilePosition } from '../../react/markdown.js';
import type { SessionInfo } from '../../agents/sessions/group.js';
import type { SessionTurn } from '../../agents/session.js';
import type { Artifact, RateLimit } from '../../agents/types.js';
import type { ChatView } from '../controller.js';
import { agentGuide, agentOrder } from '../../agents/drivers/catalog.js';
import type { AgentInspection } from '../../agents/status.js';
import {
  firstLine,
  formatUsage,
  needsAttention,
  parseSlash,
  SLASH_COMMANDS,
  splitAttached,
  type SlashCommand,
} from '../format.js';
import type { UiRelease } from './release.js';
import type { WebCommand, WebFolder, WebSwitchCommand } from './server.js';
import {
  chatKey as chatKeyOf,
  chatProjects,
  folderName,
  chatTitle,
  HOME_FOLDER,
  liveGlyph,
  needsYou,
  OPEN_CHAT_SOURCE,
  isOpenChat,
  otherSessions,
  quotaRows,
  sessionKey,
  withOpenChat,
} from '../sidebar.js';
import { holdsTypedText, Shell } from './shell.js';
import { Icon } from './sidebar.js';
import { AgentChip, ComposerHint, ModelRejected, PermissionSwitch, PlanToggle, StartsIn } from './composer.js';
import { forgetModel, modelSuggestions, readRecentModels, rememberModel, rejectsModel } from '../models.js';
import { SessionReplies } from './session-reply.js';
import { setSessionArchive, Sessions } from './sessions.js';
import { VIEWER_WIDTH_KEY, ViewerPanel, type ViewerTarget } from './file-view.js';
import { Home } from './home.js';
import { Onboarding, SignInCard } from './onboarding.js';
import { needsItems, needsSessions, type NeedsDecision } from '../needs-you.js';
import { LIMITS_EVERY_MS, NO_SESSIONS, useChats } from './chats.js';
import { NeedsYouPage, useFirstSeen } from './needs-you.js';
import { chatLimits, SECTION_LABEL, SettingsPage, settingsSections, type SettingsSection } from './settings.js';
import { applyTheme, readTheme, useTheme } from './theme.js';
import { TranscriptMenu } from './transcript-menu.js';

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

/**
 * This page among the pages the server talks to, new with every load: the requests for another
 * chat are numbered within it (`SwitchOrder`), so the server can tell an overtaken one by its number.
 */
let navigationSequence = 0;
const WINDOW_ID = `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(3)), (part) => part.toString(36)).join('')}`;

async function postCommand(body: WebCommand, owner = pageChat(), turn?: number) {
  const res = await fetch(chatUrl(turn === undefined ? '/api/command' : '/api/command?turn=' + turn, owner), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok?: boolean;
    draft?: string;
    chat?: string;
    text?: string;
    error?: string;
    reason?: string;
  };
}

async function command(body: WebCommand): Promise<boolean> {
  return (await postCommand(body)).ok === true;
}

/**
 * Sends `text`, first keeping `files` with the server so the agent can read them from the project.
 * Resolves to what went wrong when nothing was sent: a prompt never goes without one of its files.
 */
async function sendPrompt(
  text: string,
  files: File[],
  dropped: AbortSignal,
  generation?: number,
): Promise<string | undefined> {
  const ids: string[] = [];
  for (const file of files) {
    if (dropped.aborted) return STOPPED;
    const existing = uploadedFiles.get(file);
    if (existing) {
      ids.push(existing);
      continue;
    }
    const name = file.name || 'file';
    const res = await chatFetch(`/api/upload?name=${encodeURIComponent(name)}`, {
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
  const sent = await command({ type: 'submit', text, generation, ...(ids.length ? { files: ids } : {}) }).catch(
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
            <img key={file.path} src={chatUrl(`/uploads/${file.id}`)} alt={file.name} title={file.name} />
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

/**
 * The limits last seen of every agent's plan (`/api/limits`): asked when the page opens, when a
 * turn starts or ends, and every minute. The sidebar shows each agent's worst window.
 */
function useAllLimits(running: boolean): Array<RateLimit & { agent: string }> {
  const [limits, setLimits] = useState<Array<RateLimit & { agent: string }>>([]);
  useEffect(() => {
    if (!token) return;
    let current = true;
    const ask = () =>
      chatFetch('/api/limits', { headers: { 'x-genaicode-token': token } })
        .then((res) => (res.ok ? (res.json() as Promise<{ limits?: Array<RateLimit & { agent: string }> }>) : {}))
        .then(
          (found: { limits?: Array<RateLimit & { agent: string }> }) => {
            if (current) setLimits(found.limits ?? []);
          },
          () => undefined,
        );
    void ask();
    const timer = window.setInterval(ask, LIMITS_EVERY_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [running]);
  return limits;
}

interface PageConfig {
  multiChat?: boolean;
  maxChats?: number;
  initialChat?: string;
  cwd: string;
  /** False when the page names no project (`ui --no-project` or `ui --home`). */
  project?: boolean;
  /** True in `--home` mode: per-conversation working directory, no fixed project folder. */
  home?: boolean;
  sessions: boolean;
  agents?: boolean;
  uploads?: boolean;
  projectTeams?: boolean;
  agentTools?: boolean;
  /** True when the plan limits last seen of every agent are served (`/api/limits`). */
  limits?: boolean;
  files?: boolean;
  /** True when the desktop host app opens a native Save dialog via `POST /api/save-transcript`. */
  nativeSave?: boolean;
  reveal?: boolean;
  /** True when the host app has a folder dialog (`POST /api/choose-folder`). */
  chooseFolder?: boolean;
  artifactCdn?: string[];
  canConfigureCdn?: boolean;
  /** A newer version of the app that shows this page: downloading, or ready to install on a relaunch. */
  update?: { version: string; ready: boolean; installing?: boolean };
}

function fallbackAgents(choices: ChatView['agents'] | undefined): AgentInspection[] {
  if (!choices?.length) return [];
  return choices
    .map((choice, index) => ({
      index,
      item: {
        name: choice.name,
        command: choice.command,
        installed: choice.installed,
        ...(choice.path ? { path: choice.path } : {}),
        ...(choice.version ? { version: choice.version } : {}),
        auth: choice.auth ?? 'unknown',
        ...(choice.broken ? { broken: true } : {}),
        ...(choice.plan ? { plan: choice.plan } : {}),
        ...(choice.hint ? { hint: choice.hint } : {}),
        guide: agentGuide(choice.name, choice.command),
      } satisfies AgentInspection,
    }))
    .sort(
      (a, b) => agentOrder(a.item.name, a.item.command) - agentOrder(b.item.name, b.item.command) || a.index - b.index,
    )
    .map(({ item }) => item);
}

/** How often the onboarding screen quietly re-checks PATH / sign-in while visible. */
const AGENTS_POLL_MS = 4_000;

function useAgents(
  enabled: boolean,
  viewAgents: ChatView['agents'] | undefined,
  pollActive: boolean,
  viewSetup: boolean,
): {
  agents: AgentInspection[];
  loading: boolean;
  checking: boolean;
  inspectedAt: number;
  checkAgain(options?: { env?: boolean; quiet?: boolean }): Promise<AgentInspection[] | undefined>;
} {
  const [inspected, setInspected] = useState<AgentInspection[]>();
  const [loading, setLoading] = useState(enabled);
  const [checking, setChecking] = useState(false);
  const [inspectedAt, setInspectedAt] = useState(0);
  const inFlightRef = useRef(false);
  const checkingRef = useRef(false);

  const fetchAgents = async (query: string): Promise<AgentInspection[] | undefined> => {
    if (!token) return undefined;
    inFlightRef.current = true;
    try {
      const res = await chatFetch(`/api/agents${query}`, { headers: { 'x-genaicode-token': token } });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { agents?: AgentInspection[] };
      if (!Array.isArray(body.agents)) return undefined;
      setInspected(body.agents);
      setInspectedAt(Date.now());
      return body.agents;
    } catch {
      return undefined;
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!enabled || !token) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    void fetchAgents('').finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [enabled]);

  // When another tab updates the shared controller out of/into setup, refresh the cached inspection list.
  const prevSetup = useRef(viewSetup);
  useEffect(() => {
    if (prevSetup.current === viewSetup) return;
    prevSetup.current = viewSetup;
    if (enabled && token && !inFlightRef.current) void fetchAgents('');
  }, [enabled, viewSetup]);

  useEffect(() => {
    if (!enabled || !pollActive || !token) return;
    const timer = window.setInterval(() => {
      if (!checkingRef.current && !inFlightRef.current) void fetchAgents('?refresh=1');
    }, AGENTS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, pollActive]);

  const checkAgain = async (options?: { env?: boolean; quiet?: boolean }): Promise<AgentInspection[] | undefined> => {
    if (!enabled || !token) return undefined;
    if (options?.quiet) {
      if (checkingRef.current || inFlightRef.current) return undefined;
      return fetchAgents(options.env ? '?refresh=1&env=1' : '?refresh=1');
    }
    checkingRef.current = true;
    setChecking(true);
    try {
      return await fetchAgents(options?.env ? '?refresh=1&env=1' : '?refresh=1');
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  };

  return {
    agents: inspected ?? fallbackAgents(viewAgents),
    loading: enabled && loading,
    checking,
    inspectedAt,
    checkAgain,
  };
}

/** Keep completed turn references stable across SSE snapshots so memoized turns skip re-rendering while streaming. */
function reuseCompletedTurns(prev: ChatView | undefined, next: ChatView): ChatView {
  if (!prev || prev.generation !== next.generation || !prev.session.turns.length || !next.session.turns.length) {
    return next;
  }
  const prevTurns = prev.session.turns;
  let reused = false;
  const turns = next.session.turns.map((turn, i) => {
    const old = prevTurns[i];
    if (
      old &&
      old.id === turn.id &&
      old.result &&
      turn.result &&
      old.endedAt === turn.endedAt &&
      !old.pack &&
      !turn.pack &&
      old.entries.length === turn.entries.length
    ) {
      reused = true;
      return old;
    }
    return turn;
  });
  return reused ? { ...next, session: { ...next.session, turns } } : next;
}

function useView(
  route: string | undefined,
  onToast?: (text: string) => void,
): {
  loaded: ChatSummary[];
  view?: ChatView;
  config?: PageConfig;
  release?: UiRelease;
  connected: boolean;
  rejected: boolean;
} {
  const [release, setRelease] = useState<UiRelease>();
  const [loaded, setLoaded] = useState<ChatSummary[]>([]);
  const snapshots = useRef(new Map<string | undefined, ChatView>());
  const [live, setLive] = useState<{ route?: string; view: ChatView }>();
  const view = live && live.route === route ? live.view : snapshots.current.get(route);
  const [config, setConfig] = useState<PageConfig>();
  const [connected, setConnected] = useState(false);
  const [rejected, setRejected] = useState(!token);
  const toastRef = useRef(onToast);
  toastRef.current = onToast;
  useEffect(() => {
    if (!token) return;
    const abort = new AbortController();
    let timer: number | undefined;
    const connect = async () => {
      try {
        const path = '__TAURI_INTERNALS__' in window ? '/api/events?desktop=1' : '/api/events';
        const res = await fetch(chatUrl(path, route), {
          headers: { 'x-genaicode-token': token },
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        if (res.status === 404 && pageChat()) {
          history.replaceState(history.state, '', location.pathname + location.search);
          location.reload();
          return;
        }
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
          if (done || abort.signal.aborted) break;
          buffer += decoder.decode(value, { stream: true });
          const taken = takeEvents(buffer);
          buffer = taken.rest;
          for (const { event, data: payload } of taken.events) {
            if (event === 'view') {
              const parsed = JSON.parse(payload) as ChatView;
              const id = route ?? parsed.conversation?.id;
              const view = reuseCompletedTurns(snapshots.current.get(id), parsed);
              snapshots.current.delete(id);
              snapshots.current.set(id, view);
              if (snapshots.current.size > 8) snapshots.current.delete(snapshots.current.keys().next().value);
              setLive({ route, view });
              setConnected(true);
            } else if (event === 'chats') {
              setLoaded(JSON.parse(payload) as ChatSummary[]);
            } else if (event === 'open') {
              showChat((JSON.parse(payload) as { chat: string }).chat);
            } else if (event === 'release') {
              setRelease(JSON.parse(payload) as UiRelease);
            } else if (event === 'config') {
              const config = JSON.parse(payload) as PageConfig;
              if (config.initialChat && !pageChat())
                history.replaceState(history.state, '', '#chat=' + encodeURIComponent(config.initialChat));
              setConfig(config);
            } else if (event === 'toast') {
              const parsed = JSON.parse(payload) as { text?: string };
              if (parsed.text) toastRef.current?.(parsed.text);
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
  }, [route]);
  return { view, config, release, connected: connected && live?.route === route, rejected, loaded };
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
  const ring = () => {
    if (document.hasFocus() && document.visibilityState === 'visible') return;
    unread.current += 1;
    document.title = `(${unread.current}) ${baseTitleRef.current}`;
    if (!view?.bark) return;
    audio.current ??= new Audio('/assets/bark.mp3');
    audio.current.currentTime = 0;
    audio.current.volume = 0.5;
    // Browsers may refuse sound before the first click on the page; the title still counts.
    audio.current.play().catch(() => {});
  };
  useEffect(() => {
    if (!view) return;
    const before = seen.current;
    seen.current = view;
    if (
      before?.conversation?.id !== view.conversation?.id ||
      !needsAttention(before?.session, view.session, before?.notices, view.notices)
    )
      return;
    ring();
  }, [view]);
  return ring;
}

/** Refresh cached local-image capability URLs before the server's 15-minute inactivity TTL. */
const IMAGE_CAPABILITY_REFRESH_MS = 10 * 60_000;

interface CachedImage {
  url: string;
  resolvedAt: number;
}

/** Resolve local image paths referenced in agent and relay replies to short-lived capability URLs. */
/** Built outside the component, so the resolver holds the images and nothing else of that render's view. */
function imageResolver(images: Record<string, string>) {
  return (path: string) => images[path];
}

function useLocalImages(
  turns: ChatView['session']['turns'] | undefined,
  notices: ChatView['notices'] | undefined,
  enabled: boolean,
  cwd: string,
): Record<string, string> {
  const scopeKey = JSON.stringify([pageChat(), cwd]);
  const [cache, setCache] = useState<{ scope: string; map: Record<string, CachedImage> }>(() => ({
    scope: scopeKey,
    map: {},
  }));
  const [tick, setTick] = useState(0);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const scopeEpochRef = useRef(0);
  const checkedRootKey = useRef('');
  const attempted = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const retriedUrl = useRef(new Map<string, string>());
  const controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scopeEpochRef.current += 1;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      inFlight.current.clear();
    };
  }, []);

  // Switching conversations / working directories invalidates cached relative capabilities and in-flight batches.
  useEffect(() => {
    scopeEpochRef.current += 1;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    inFlight.current.clear();
    attempted.current.clear();
    retriedUrl.current.clear();
    checkedRootKey.current = '';
    const empty = { scope: scopeKey, map: {} };
    cacheRef.current = empty;
    setCache(empty);
  }, [scopeKey]);

  const pathsKey = useMemo(() => {
    if (!enabled) return '';
    const found: string[] = [];
    for (const turn of turns ?? []) {
      for (const entry of turn.entries) {
        if (entry.kind !== 'text' || !entry.text.includes('![')) continue;
        for (const path of extractLocalImagePaths(entry.text)) {
          if (!found.includes(path)) found.push(path);
        }
      }
    }
    for (const notice of notices ?? []) {
      const relay = notice.relay;
      if (relay?.status !== 'answered' || !relay.reply || !relay.reply.includes('![')) continue;
      for (const rawPath of extractLocalImagePaths(relay.reply)) {
        const path = relay.cwd ? resolveFilePath(rawPath, relay.cwd) : rawPath;
        const allowed = (relay.cwd && isPathWithin(path, relay.cwd)) || (cwd && isPathWithin(path, cwd));
        if (allowed && !found.includes(path)) found.push(path);
      }
    }
    return found.join('\n');
  }, [turns, notices, enabled, scopeKey]);
  const rootKey = useMemo(() => {
    const settled = (notices ?? [])
      .filter((notice) => notice.relay?.status === 'answered' || notice.relay?.status === 'failed')
      .map((notice) => notice.id)
      .join(',');
    return `${turns?.length ?? 0}:${settled}`;
  }, [turns?.length, notices]);

  // Refresh expired image capabilities proactively when returning to the tab or when their TTL elapses.
  useEffect(() => {
    if (!enabled || !pathsKey || cache.scope !== scopeKey) return;
    const active = pathsKey.split('\n').filter(Boolean);
    const now = Date.now();
    let earliest = Infinity;
    for (const path of active) {
      const cached = cache.map[path];
      if (!cached) continue;
      const due = cached.resolvedAt + IMAGE_CAPABILITY_REFRESH_MS;
      if (due < earliest) earliest = due;
    }
    const timer =
      earliest < Infinity ? window.setTimeout(() => setTick((n) => n + 1), Math.max(1000, earliest - now)) : undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, pathsKey, cache, scopeKey]);

  // If a lazy-loaded or remounted thumbnail fails (e.g. its capability expired), invalidate and re-resolve once.
  useEffect(() => {
    if (!enabled) return;
    const onImageError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !target.classList.contains('gc-md-image')) return;
      const path = target.closest('[data-gc-file]')?.getAttribute('data-gc-file');
      if (!path || cacheRef.current.scope !== scopeKey) return;
      const cached = cacheRef.current.map[path];
      if (!cached || retriedUrl.current.get(path) === cached.url) return;
      retriedUrl.current.set(path, cached.url);
      attempted.current.delete(path);
      setCache((prev) => {
        if (prev.scope !== scopeKey || !prev.map[path] || prev.map[path].url !== cached.url) return prev;
        const nextMap = { ...prev.map };
        delete nextMap[path];
        return { scope: prev.scope, map: nextMap };
      });
      setTick((n) => n + 1);
    };
    window.addEventListener('error', onImageError, true);
    return () => window.removeEventListener('error', onImageError, true);
  }, [enabled, scopeKey]);

  useEffect(() => {
    if (!enabled || !token || !pathsKey) return;
    const epoch = scopeEpochRef.current;
    const currentMap = cacheRef.current.scope === scopeKey ? cacheRef.current.map : {};
    const now = Date.now();
    // New turns or settled relays may have opened new session roots: retry previously unresolved paths.
    if (rootKey !== checkedRootKey.current) {
      checkedRootKey.current = rootKey;
      for (const path of [...attempted.current]) {
        if (!currentMap[path] && !inFlight.current.has(path)) attempted.current.delete(path);
      }
    }
    const all = pathsKey.split('\n').filter(Boolean);
    const missing = all.filter((path) => {
      if (inFlight.current.has(path)) return false;
      const cached = currentMap[path];
      if (cached) return now - cached.resolvedAt >= IMAGE_CAPABILITY_REFRESH_MS;
      return !attempted.current.has(path);
    });
    if (!missing.length) return;
    const batch = missing.slice(0, 100);
    for (const path of batch) {
      attempted.current.add(path);
      inFlight.current.add(path);
    }
    const controller = new AbortController();
    controllers.current.add(controller);
    // Keep in-flight batches alive across streaming updates; only scope change or unmount aborts them.
    chatFetch('/api/file/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
      body: JSON.stringify({ paths: batch }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ urls?: Record<string, string> }>;
      })
      .then((body) => {
        if (!mounted.current || scopeEpochRef.current !== epoch) return;
        const resolvedAt = Date.now();
        const returned = body?.urls ?? {};
        setCache((prev) => {
          if (prev.scope !== scopeKey) return prev;
          const nextMap = { ...prev.map };
          let changed = false;
          for (const path of batch) {
            const url = returned[path];
            if (url) {
              if (retriedUrl.current.get(path) !== url) retriedUrl.current.delete(path);
              nextMap[path] = { url, resolvedAt };
              changed = true;
            } else if (prev.map[path]) {
              delete nextMap[path];
              changed = true;
            }
          }
          return changed ? { scope: prev.scope, map: nextMap } : prev;
        });
      })
      .catch(() => {
        // Release failed or aborted paths so they can be retried instead of sticking unresolved.
        if (scopeEpochRef.current !== epoch) return;
        for (const path of batch) attempted.current.delete(path);
      })
      .finally(() => {
        controllers.current.delete(controller);
        if (scopeEpochRef.current !== epoch) return;
        for (const path of batch) inFlight.current.delete(path);
        if (mounted.current && missing.length > batch.length) setTick((n) => n + 1);
      });
  }, [enabled, pathsKey, rootKey, tick, scopeKey]);

  return useMemo(() => {
    if (cache.scope !== scopeKey) return {};
    const out: Record<string, string> = {};
    for (const [path, entry] of Object.entries(cache.map)) out[path] = entry.url;
    return out;
  }, [cache, scopeKey]);
}

/** The message field, for the focus: a new chat and the way back from a page start there. */
/** A chat asked for while the open chat's turn runs, and what was chosen about it. */
interface HeldSwitch {
  request: WebSwitchCommand;
  what: string;
  /** The chat asked for, as the message names it. */
  label: string;
  /** Asked: the message offers Stop and open, and Wait. Stopping or waiting: it opens when the turn is over. */
  step: 'ask' | 'stopping' | 'waiting';
  /** The conversation shown when it was asked for (`shownChat`): only from there does it open. */
  from: string;
}

const SHORT_TITLE = 48;

/** A chat's title in quotes, short enough for a sentence; "that chat" without one. */
function quotedTitle(chat: Partial<SessionInfo> | undefined): string {
  if (!chat) return 'that chat';
  const title = chatTitle({ ...chat, id: chat.id ?? '' } as SessionInfo);
  if (!title || title === 'New chat') return 'that chat';
  return `“${title.length > SHORT_TITLE ? `${title.slice(0, SHORT_TITLE - 1)}…` : title}”`;
}

/** What a failed turn said went wrong: its result's error and the errors it reported on the way. */
function turnErrorText(turn: SessionTurn): string {
  return [turn.result?.error ?? '', ...turn.entries.map((entry) => (entry.kind === 'error' ? entry.message : ''))]
    .filter(Boolean)
    .join('\n');
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function heldLabel(request: WebSwitchCommand): string {
  switch (request.type) {
    case 'home-chat':
      return 'a new chat';
    case 'project-chat':
      return `a new chat in ${folderName(request.cwd)}`;
    case 'topic-chat':
      return 'a new chat for that topic';
    default:
      return 'that chat';
  }
}

function focusComposer() {
  window.requestAnimationFrame(() =>
    document.querySelector<HTMLTextAreaElement>('.workspace .gc-composer textarea')?.focus(),
  );
}

/**
 * What the server knows of a folder (`GET /api/folder`); undefined when the path is not one. A
 * typed path is taken as typed in (`~`, spaces around it); `exact`, the chat's own, as it is.
 */
/**
 * The commands that move the window: they still go while it waits for another chat or a folder,
 * and are asked for after that request, which they supersede (`/continue` with no id moves nothing).
 */
function navigates(own: SlashCommand): boolean {
  return own.kind === 'clear' || own.kind === 'new' || (own.kind === 'continue' && !!own.id);
}

async function inspectFolder(path: string, exact = false): Promise<WebFolder | undefined> {
  const res = await chatFetch(`/api/folder?${exact ? 'cwd' : 'path'}=${encodeURIComponent(path)}`, {
    headers: { 'x-genaicode-token': token },
  });
  return res.ok ? ((await res.json()) as WebFolder) : undefined;
}

/** The host's folder dialog (`POST /api/choose-folder`); undefined when nothing was chosen. */
async function chooseFolder(): Promise<WebFolder | undefined> {
  const res = await chatFetch('/api/choose-folder', { method: 'POST', headers: { 'x-genaicode-token': token } });
  return res.ok ? ((await res.json()) as { folder?: WebFolder }).folder : undefined;
}

/** As many files as the server takes with one prompt. */
const ATTACH = { max: 8 };

const IDEAS = ['Explain how this project is organized', 'Find and fix a failing test', 'Add a --verbose flag'];
/** Without a project the chat is about the work of every agent. */
const IDEAS_ANYWHERE = ['What is waiting for me?', 'What are my agents working on?', 'Sum up what got done today'];

/** Where the version whose notes were opened is kept: the dot on Help shows until then. */
const WHATS_NEW_KEY = 'genaicode-whatsnew';

/** The release notes, opened from Help › What's new, and by itself once after an update. */
function WhatsNewDialog({ release, ref, onSeen }: { release: UiRelease; ref: Ref<HTMLDialogElement>; onSeen(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (release.announce && !dialog.current?.open) dialog.current?.showModal();
  }, [release]);
  // Opened either way, the notes count as seen.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const watch = new MutationObserver(() => {
      if (element.open) onSeen();
    });
    watch.observe(element, { attributes: true, attributeFilter: ['open'] });
    if (element.open) onSeen();
    return () => watch.disconnect();
  }, [release.version]);

  return (
    <dialog
      ref={(element) => {
        dialog.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      className="release-dialog"
      aria-labelledby="release-heading"
    >
      <div className="release-heading">
        <h2 id="release-heading">What’s new in Genaicode {release.version}</h2>
        <form method="dialog">
          <button className="chip" autoFocus>
            Close
          </button>
        </form>
      </div>
      {release.previous && (
        <p>
          Updated from {release.previous} to <strong>{release.version}</strong>.
        </p>
      )}
      {release.notes ? <ReleaseNotes notes={release.notes} /> : <p>No release notes bundled for this version.</p>}
      <a
        href={`https://github.com/gtanczyk/genaicode/releases/tag/v${encodeURIComponent(release.version)}`}
        target="_blank"
        rel="noreferrer"
      >
        View release on GitHub
      </a>
    </dialog>
  );
}

/** How often a pull request not merged yet (or not answered for) is asked about again. */
const PULL_REQUESTS_EVERY_MS = 60_000;

/**
 * What the server learned of the pull requests the delegated tasks' replies link to, by task
 * (`WorkTask.key`): its state, and whether the task opened it. Asked when such a task first shows,
 * and again every minute while `watching` for those not merged yet (a closed one can be reopened)
 * and for those whose task still has a worktree to merge or discard: an edit there after the pull
 * request merged makes the worktree more than the pull request, so it is no longer only a link.
 * Only the tasks of `chat`, the conversation shown, are asked about.
 */
function usePullRequests(
  chat: string,
  tasks: readonly WorkTask[],
  watching: boolean,
): Record<string, PullRequestStatus | undefined> {
  const [found, setFound] = useState<{ chat: string; states: Record<string, PullRequestStatus | undefined> }>({
    chat,
    states: {},
  });
  const asked = useRef({ chat, keys: new Set<string>() });
  if (asked.current.chat !== chat) asked.current = { chat, keys: new Set() };
  const stamp = tasks
    .filter((item) => item.task.pullRequest)
    .map((item) => item.key)
    .join('\n');
  const states = found.chat === chat ? found.states : {};
  const latest = useRef(states);
  latest.current = states;
  // Tasks whose worktree is still there: whether it is still the pull request is asked again.
  const unmerged = useRef(new Set<string>());
  unmerged.current = new Set(
    tasks.filter((item) => item.task.mode === 'worktree' && item.task.state === 'unmerged').map((item) => item.key),
  );
  useEffect(() => {
    if (!stamp) return;
    let stopped = false;
    const ask = (again: boolean) => {
      for (const key of stamp.split('\n')) {
        if (again ? pullRequestSettled(latest.current[key]) && !unmerged.current.has(key) : asked.current.keys.has(key))
          continue;
        asked.current.keys.add(key);
        const [turn = '', ...id] = key.split(':');
        const query = new URLSearchParams({ conversation: chat, turn, task: id.join(':') });
        chatFetch(`/api/pull-request?${query}`, { headers: { 'x-genaicode-token': token } })
          .then((reply) => (reply.ok ? (reply.json() as Promise<PullRequestStatus>) : undefined))
          .then((body) => {
            if (stopped || !body) return;
            const status: PullRequestStatus = {
              ...(body.state ? { state: body.state } : {}),
              ours: body.ours === true,
            };
            const known = latest.current[key];
            if (known?.state === status.state && known?.ours === status.ours) return;
            setFound((current) => ({
              chat,
              states: { ...(current.chat === chat ? current.states : {}), [key]: status },
            }));
          })
          .catch(() => undefined);
      }
    };
    ask(false);
    if (!watching) {
      return () => {
        stopped = true;
      };
    }
    const timer = window.setInterval(() => ask(true), PULL_REQUESTS_EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [chat, stamp, watching]);
  return states;
}

function workStore(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return localStorage;
  } catch {
    // Storage blocked: the panel's state lasts until the page is closed.
    return { getItem: () => null, setItem: () => undefined };
  }
}

// Per window, as the design asks: two windows of the app each keep their own width.
const workWidth = storedSize(WORK_WIDTH_KEY, [WORK_PANEL_MIN, 4000], () => sessionStorage);
// The panel's width while a file or an artifact is open in it: wider, and kept apart from the lists'.
const viewerWidth = storedSize(VIEWER_WIDTH_KEY, [WORK_PANEL_MIN, 4000]);

function App({ selected }: { selected?: string }) {
  const route = selected ?? pageChat();
  const root = document.getElementById('root')!;
  const [toast, setToast] = useState<{ text: string; error?: boolean; chat?: string }>();
  const toastTimer = useRef<number>(undefined);
  const showToast = (text: string, error = false, chat?: string) => {
    setToast({ text, error, chat });
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 2600);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const { view, config, release, connected, rejected, loaded } = useView(selected, (text) => showToast(text));
  const [deleting, setDeleting] = useState<{ row: SessionInfo; chat?: string }>();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const askDelete = (row: SessionInfo) => {
    const owner = loaded.find((entry) => sessionKey(entry) === sessionKey(row));
    setDeleting({ row: owner ?? row, chat: owner?.chat });
    deleteDialog.current?.showModal();
  };
  const [returnedDraft, setReturnedDraft] = useState<{ chat: string; stamp: string }>();
  const currentRow = loaded.find((row) => row.chat === pageChat());
  const cancelQueue = () => postCommand({ type: 'stop' });
  useEffect(() => {
    const id = pageChat();
    if (!id || !view?.recoveredDraft) return;
    const draft = restoreQueued(id, view.recoveredDraft);
    if (draft) {
      rememberDraft(id, draft);
      setReturnedDraft({ chat: id, stamp: view.recoveredDraft.id });
    }
  }, [view?.recoveredDraft?.id]);
  const ring = useBark(view);
  const prior = useRef<ChatSummary[]>([]);
  useEffect(() => {
    for (const chat of loaded) {
      const old = prior.current.find((row) => row.chat === chat.chat);
      if (!old || chat.chat === pageChat()) continue;
      const approval = chat.approvals.some((request) => !old.approvals.some((prior) => prior.id === request.id));
      const finished =
        !chat.turnInProgress &&
        (old.turnInProgress || (old.turn !== chat.turn && (chat.glyph === 'ok' || chat.glyph === 'err')));
      if (!approval && !finished) continue;
      const text = (approval ? 'Needs you: ' : 'Finished: ') + chat.title;
      ring();
      showToast(text, false, chat.chat);
      if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notice = new Notification(text);
        notice.onclick = () => {
          window.focus();
          showChat(chat.chat);
        };
      }
    }
    prior.current = loaded;
  }, [loaded]);
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
  const hasAgentsApi = config?.agents === true;
  const [theme, setTheme] = useTheme();
  // The Sessions and Settings pages take the chat's place; the chat keeps running behind them.
  const [panel, navigate] = useState<'chat' | 'sessions' | 'needs' | 'settings'>('chat');
  const [openedSession, setOpenedSession] = useState<SessionInfo>();
  const setPanel = (page: typeof panel) => {
    setOpenedSession(undefined);
    navigate(page);
  };
  const [section, setSection] = useState<SettingsSection>('general');
  const [focusAgent, setFocusAgent] = useState<string>();
  const showSessions = panel === 'sessions';
  const showAgents = panel === 'settings' && section === 'agents';
  // What the Sessions view lists: every agent's sessions, those with the ones that ask now on top
  // ("Open session" on the Needs you page), or this app's own chats of all time, the archived too
  // (from "All chats").
  const [listed, setListed] = useState<'all' | 'needs' | 'own'>('all');
  const needsOnly = listed === 'needs';
  // The window is moving to another chat (a new one in a folder or a topic, or one picked from a
  // list). Until the server answers the request made last, nothing is sent: a prompt would start
  // in the chat, and the folder, that is being left. The message field keeps what is typed.
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  // Numbers the requests: each is sent with its number, the server drops one that arrives after a
  // later one, and only the answer to the last gives the message field back. The answer of an
  // earlier one says nothing about where the window is.
  const switchSeq = useRef(0);
  // The project line looks a folder up (a typed path, the host's dialog): until it is found and
  // asked for, or dropped, prompts wait as they do while switching, as they may be for that folder.
  // Each lookup holds only while no later chat was asked for: a later request (another folder,
  // `/clear`, a row in the sidebar) decides where the window goes, and its own answer releases it.
  const [lookingUp, setLookingUp] = useState(0);
  const lookingUpRef = useRef(0);
  const lookups = useRef(new Map<number, number>());
  const lookupId = useRef(0);
  const refreshLookups = () => {
    let held = 0;
    for (const mark of lookups.current.values()) if (mark === switchSeq.current) held += 1;
    lookingUpRef.current = held;
    setLookingUp(held);
  };
  const lookUp = <T,>(found: Promise<T>): Promise<T> => {
    const id = ++lookupId.current;
    lookups.current.set(id, switchSeq.current);
    refreshLookups();
    return found.finally(() => {
      lookups.current.delete(id);
      refreshLookups();
    });
  };
  // Prompts wait; the commands that move the window (`navigates`) still go, and are ordered after it.
  const holding = switching || lookingUp > 0;
  const whatsNew = useRef<HTMLDialogElement>(null);
  const [seenRelease, setSeenRelease] = useState(() => {
    try {
      return localStorage.getItem(WHATS_NEW_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });
  // The topic picked on the start screen: the Sessions view shows only it.
  const [topic, setTopic] = useState<string>();
  const session = view?.session;
  const conversation = view?.conversation;
  const activeCwd = conversation?.cwd || session?.cwd || cwd;
  const teamFolder = hasProject || (isHome && activeCwd !== cwd) ? activeCwd : undefined;
  const running = session?.status === 'running';
  const runningRef = useRef(running);
  runningRef.current = running;
  const inSetup = view?.setup === true;
  const {
    agents: agentList,
    loading: loadingAgents,
    checking: checkingAgents,
    inspectedAt,
    checkAgain: checkAgents,
  } = useAgents(hasAgentsApi, view?.agents, inSetup || showAgents, inSetup);
  const allLimits = useAllLimits(config?.multiChat ? loaded.some((chat) => chat.turnInProgress) : running);
  // Refresh agent status when a turn newly fails with an auth error so the picker updates too.
  const seenAuthFail = useRef(new Set<number>());
  useEffect(() => {
    if (!hasAgentsApi || !session) return;
    let trigger = false;
    for (const turn of session.turns) {
      if (turn.result?.failure?.kind === 'auth' && !seenAuthFail.current.has(turn.id)) {
        seenAuthFail.current.add(turn.id);
        trigger = true;
      }
    }
    if (trigger) void checkAgents({ env: false, quiet: true });
  }, [hasAgentsApi, session?.turns]);
  const openSettings = (which: SettingsSection = 'general') => {
    setFocusAgent(undefined);
    setSection(which);
    setPanel('settings');
  };
  const openSetup = (agent?: string) => {
    openSettings('agents');
    setFocusAgent(agent);
  };
  // When onboarding opened as a panel during setup finishes, return straight to the conversation.
  const wasSetupRef = useRef(inSetup);
  useEffect(() => {
    if (wasSetupRef.current && !inSetup && showAgents) setPanel('chat');
    wasSetupRef.current = inSetup;
  }, [inSetup, showAgents]);
  /**
   * Asks for another chat in this window. `what` names it when no answer comes at all. Resolves to
   * whether that chat is the one open now: false when the server refused or did not answer,
   * undefined when another chat was asked for meanwhile.
   */
  const switchChat = (request: WebSwitchCommand, what: string, label?: string): Promise<boolean | undefined> => {
    // The window has one session: another chat opens only when this one's turn is over. Said here,
    // with a way to stop the turn or wait for it, rather than refused by the server after the fact;
    // the focus stays where it is.
    if (!config?.multiChat && request.type !== 'stay-chat' && runningRef.current) {
      setPanel('chat');
      setHeld({ request, what, label: label ?? heldLabel(request), step: 'ask', from: shownChatRef.current });
      return Promise.resolve(false);
    }
    setHeld(undefined);
    // What still waits here was meant for the conversation that is left.
    dropWaiting();
    closeViewer();
    setPanel('chat');
    // The composer stays, and the next key goes to it.
    focusComposer();
    const mine = ++switchSeq.current;
    refreshLookups();
    switchingRef.current = true;
    setSwitching(true);
    return postCommand({
      generation: view?.generation,
      ...request,
      order: { window: WINDOW_ID, seq: ++navigationSequence },
    })
      .catch(() => undefined)
      .then((done) => {
        // Another chat was asked for meanwhile: its answer decides.
        if (mine !== switchSeq.current || route !== pageChat()) return undefined;
        switchingRef.current = false;
        setSwitching(false);
        // The chat says why when the server refused; no answer at all is said here.
        if (done === undefined) showToast(`Could not ${what}.`, true);
        if (done?.chat) showChat(done.chat);
        return done?.ok === true;
      });
  };
  const [held, setHeld] = useState<HeldSwitch>();
  // The conversation the window shows: another one (a command from another window, the server
  // moving the window) drops what was held, so Wait never opens a chat over one the person left.
  const shownChat = `${conversation?.id ?? ''}:${view?.generation ?? ''}`;
  const shownChatRef = useRef(shownChat);
  shownChatRef.current = shownChat;
  useEffect(() => {
    setHeld((was) => (was && was.from !== shownChat ? undefined : was));
  }, [shownChat]);
  // The turn is over (stopped, or finished while waited for): the chat asked for opens now. Asked
  // only, the question is moot: every chat can open again.
  useEffect(() => {
    if (running || !held) return;
    setHeld(undefined);
    if (held.step !== 'ask' && held.from === shownChat) void switchChat(held.request, held.what, held.label);
  }, [running, held, shownChat]);
  const startTopicChat = (topicId: string) =>
    void switchChat({ type: 'topic-chat', topic: topicId }, 'start a chat for that topic');
  const startHomeChat = () => void switchChat({ type: 'home-chat' }, 'start a new chat');
  // The row's store goes with its id: another store may hold a session with the same one.
  const continueChat = (chat: Pick<SessionInfo, 'id' | 'source'> & Partial<SessionInfo>) =>
    void switchChat({ type: 'continue', id: chat.id, source: chat.source }, 'open that chat', quotedTitle(chat));
  // "Continue here" brings a session into the chat: in a project its turns join the conversation.
  const takeOverChat = (chat: Pick<SessionInfo, 'id' | 'source'> & Partial<SessionInfo>) =>
    void switchChat(
      { type: 'continue', id: chat.id, source: chat.source, takeover: true },
      'open that chat',
      quotedTitle(chat),
    );
  const startProjectChat = (path: string, name = folderName(path)) =>
    switchChat({ type: 'project-chat', cwd: path }, `start a chat in ${name}`, `a new chat in ${name}`);
  /**
   * The project line's choice of a folder, made at `mark` (`chatMark()`) and found only now (a typed
   * path looked up, the host's dialog answered): dropped, resolving undefined, when another chat was
   * asked for since, so a slow answer never takes the window back from a later choice.
   */
  const latestGeneration = useRef(view?.generation);
  latestGeneration.current = view?.generation;
  const chatMark = () => switchSeq.current;
  const startChosenProject = (path: string, mark: number) =>
    route === pageChat() && mark === switchSeq.current && latestGeneration.current === view?.generation
      ? startProjectChat(path)
      : Promise.resolve(undefined);
  /**
   * The chat stays where it is (its folder picked again, `/clear`): a choice still under way is
   * dropped. A request the server has not answered yet is dropped there too.
   */
  const stayInChat = () => {
    if (switchingRef.current) void switchChat({ type: 'stay-chat' }, 'stay in this chat');
    else {
      switchSeq.current += 1;
      refreshLookups();
    }
  };
  // A new chat: no prompt yet, so where it starts can still be chosen.
  const newChat = !!session && session.turns.length === 0 && !inSetup;
  const [folder, setFolder] = useState<WebFolder>();
  useEffect(() => {
    setFolder(undefined);
    if (!newChat || !activeCwd || !token) return;
    let current = true;
    inspectFolder(activeCwd, true).then(
      (found) => current && setFolder(found),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [newChat, activeCwd, conversation?.id]);
  const convTopic = conversation?.topic?.name;
  const convTitle =
    (conversation?.title && personText(conversation.title)) ||
    (session?.turns.length ? firstLine(personText(session.turns[0]!.prompt)) : undefined) ||
    convTopic;
  // The chat whose turn keeps the others from opening, as messages and tooltips name it.
  const runningName = convTitle ? quotedTitle({ title: convTitle }) : 'this chat';
  root.classList.toggle('has-turns', !!session?.turns.length);
  // The Mac app draws the window's buttons over the page: the header leaves them room.
  root.classList.toggle('mac-app', '__TAURI_INTERNALS__' in window && /Mac/.test(navigator.platform));
  // `codexLive` and `codex` draw on one account.
  const account = session?.agent.replace(/Live$/, '');
  const plan = useMemo(() => allLimits.filter((limit) => limit.agent === account), [allLimits, account]);
  const chats = useChats(
    token,
    hasSessions,
    config?.multiChat
      ? JSON.stringify(
          loaded
            .filter((chat) => chat.turn !== undefined || !chat.source.startsWith('genaicode:open:'))
            .map((chat) => [chat.chat, chat.id, chat.turn, chat.turnInProgress]),
        )
      : `${session?.sessionId ?? ''}:${conversation?.id ?? ''}:${session?.turns.length ?? 0}:${running}`,
  );
  // What the session's own runs reported wins; until then, what was last seen of the agent's plan.
  const rateLimits = session?.rateLimits?.length ? session.rateLimits : plan;
  // On a plan the measure is the plan's own: a price there would be an estimate nobody pays.
  const onPlan = rateLimits.some((limit) => limit.window !== 'quota');
  const usage = session ? formatUsage(session.usage, onPlan ? undefined : session.costUsd) : '';
  const deleteHistory = async () => {
    if (!deleting) return;
    const { row, chat } = deleting;
    deleteDialog.current?.close();
    try {
      const res = await fetch('/api/delete-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ source: row.source, id: row.id, updatedAt: row.updatedAt, chat }),
      });
      if (!res.ok)
        throw new Error(
          res.status === 409 ? 'The chat changed or still has active work.' : `The server answered ${res.status}.`,
        );
      if (chat) rememberDraft(chat, { text: '', files: [] });
      window.dispatchEvent(new Event('genaicode-history-changed'));
      showToast('Chat history deleted.');
    } catch (error) {
      showToast(`Could not delete chat history: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      chats.refresh();
    }
  };
  // A setting takes effect now: it does not wait behind a prompt whose files still upload.
  const inChat = (body: Exclude<WebCommand, { type: 'auto' }>) => command({ ...body, generation: view?.generation });
  const control = (text: string) => void inChat({ type: 'submit', text });
  // Auto-approve is for the conversation shown when it is clicked: the server refuses it once
  // another is shown (a click that arrives after this window, or another one, opened a new chat).
  const setAutoApprove = (on: boolean) =>
    view?.generation === undefined
      ? control(`/auto ${on ? 'on' : 'off'}`)
      : void command({ type: 'auto', on, generation: view.generation });
  // Mode toggles wait behind any prompt whose attachments are still uploading, so an earlier
  // submitted prompt keeps the mode that was active when the user sent it.
  const orderedControl = (text: string): Promise<boolean> => {
    const mine = sending.then(() =>
      inChat({ type: 'submit', text }).then(
        () => true,
        () => true,
      ),
    );
    sending = mine;
    return mine;
  };
  // Why the last message did not leave, shown under the transcript until the next one does.
  const [unsent, setUnsent] = useState<{ problem: string; text: string }>();
  // The work panel: this chat's delegated tasks, changed files and artifacts, beside the chat where
  // it fits. A file or an artifact opens inside it (`workView.viewing`).
  const tasks = useMemo(() => workTasks(session), [session?.turns, session?.approvals]);
  const sessionArtifacts = useMemo(() => workArtifacts(session), [session?.turns]);
  const changes = useMemo(() => workChanges(session, tasks), [session?.turns, session?.cwd]);
  const workCounts = {
    tasks: tasks.length,
    changes: changes.lead.length + changes.tasks.length,
    artifacts: sessionArtifacts.length,
    // Live shows what the tasks do: it has something when Tasks has.
    live: tasks.length,
  };
  const hasWork = WORK_TABS.some((tab) => workCounts[tab] > 0);
  // The viewer over the whole chat area (Expand), until Dock.
  const [expanded, setExpanded] = useState(false);
  // A link in the chat opened the viewer while the panel was closed: closing the viewer closes it again.
  const viewerOpenedPanel = useRef(false);
  // A chat has no id of its own until its agent names the session.
  const chatKey = chatKeyOf({ conversation, session });
  // The full-width view is opened by hand each time: it covers the chat, so it is not remembered.
  const [workFullOpen, setWorkFullOpen] = useState(false);
  const [work, setWork] = useState<{ chat: string; generation?: number; view: WorkPanelView }>(() => ({
    generation: view?.generation,
    chat: chatKey,
    view: readWorkView(workStore(), chatKey),
  }));
  if (work.chat !== chatKey || work.generation !== view?.generation) {
    // The chat got its id: what was chosen in it meanwhile stays. Another chat: what was remembered for it.
    const carried = work.chat === '' && work.generation === view?.generation && !!chatKey;
    if (carried) writeWorkView(workStore(), chatKey, work.view);
    setWork({
      chat: chatKey,
      generation: view?.generation,
      view: carried ? work.view : readWorkView(workStore(), chatKey),
    });
    if (!carried) {
      setWorkFullOpen(false);
      setExpanded(false);
      viewerOpenedPanel.current = false;
    }
  }
  const workView = work.view;
  const setWorkView = (next: WorkPanelView) => {
    setWork({ chat: chatKey, generation: view?.generation, view: next });
    if (chatKey) writeWorkView(workStore(), chatKey, next);
  };
  useEffect(() => {
    if (
      sessionArtifacts.length &&
      !tasks.length &&
      workView.open === undefined &&
      workView.tab === 'tasks' &&
      !workView.viewing &&
      !workView.task
    ) {
      setWorkView({ ...workView, tab: 'artifacts' });
    }
  }, [view?.generation, sessionArtifacts.length]);
  const viewing = workView.viewing;
  const [room, setRoom] = useState(() => ({ room: window.innerWidth, window: window.innerWidth }));
  const [savedWidth, setSavedWidth] = useState(() => workWidth.get());
  const [savedViewerWidth, setSavedViewerWidth] = useState(() => viewerWidth.get());
  // The docked viewer has its own preferred width and resize setting.
  const workLayout = workPanelLayout({
    ...room,
    viewer: !!viewing,
    saved: viewing ? (savedViewerWidth ?? WORK_PANEL_VIEWER) : savedWidth,
  });
  const latestLayout = useRef(workLayout);
  latestLayout.current = workLayout;
  // Beside the chat it opens by itself on delegated tasks until the person closes it (remembered
  // per chat). Where it would cover the chat it opens only by hand.
  const workOpen =
    panel === 'chat' &&
    (hasWork || !!viewing) &&
    (workLayout.docks ? (workView.open ?? (tasks.length > 0 || sessionArtifacts.length > 0)) : workFullOpen);
  // In the chat's place: no room beside it, or the viewer was expanded over it.
  const workFull = workOpen && (!workLayout.docks || (expanded && !!viewing));
  const workNeeds = workNeedsYou(tasks);
  // Work the person has not opened: tasks delegated since the panel was last looked at.
  const workNews = !workOpen && tasks.length > (workView.seen ?? 0);
  useEffect(() => {
    if (workOpen && workView.seen !== tasks.length) setWorkView({ ...workView, seen: tasks.length });
  }, [workOpen, tasks.length, workView.seen]);
  const pullRequests = usePullRequests(chatKey, tasks, workOpen);
  const closeWork = () => {
    setExpanded(false);
    viewerOpenedPanel.current = false;
    if (!workLayout.docks) setWorkFullOpen(false);
    // What was open in the viewer goes with the panel: opened again, it shows its tab.
    setWorkView({ ...workView, ...(workLayout.docks ? { open: false } : {}), viewing: undefined });
    // The panel's view covered the chat, or held the focus: the next key goes to the message field.
    if (workFull || document.activeElement?.closest('.gc-work')) focusComposer();
  };
  /** The tab the panel opens on: the one it had, or the first with something in it. */
  const landingTab = () =>
    workCounts[workView.tab] ? workView.tab : (WORK_TABS.find((tab) => workCounts[tab] > 0) ?? workView.tab);
  const toggleWork = () => {
    if (workOpen) return closeWork();
    if (!hasWork) return;
    setPanel('chat');
    setWorkView({
      ...workView,
      ...(workLayout.docks ? { open: true } : {}),
      tab: landingTab(),
      viewing: undefined,
      seen: tasks.length,
    });
    if (!workLayout.docks) setWorkFullOpen(true);
  };
  /** A turn's line in the chat opens the panel on that turn's tasks. */
  const openTasks = () => {
    setExpanded(false);
    viewerOpenedPanel.current = false;
    if (!workLayout.docks) setWorkFullOpen(true);
    setWorkView({
      ...workView,
      ...(workLayout.docks ? { open: true } : {}),
      tab: 'tasks',
      task: undefined,
      viewing: undefined,
      seen: tasks.length,
    });
  };
  /** Opens a file or an artifact in the panel's viewer, from the chat or from inside the viewer. */
  const openViewer = (target: ViewerTarget) => {
    setPanel('chat');
    if (!workOpen) viewerOpenedPanel.current = true;
    if (!workLayout.docks) setWorkFullOpen(true);
    setWorkView({
      ...workView,
      ...(workLayout.docks ? { open: true } : {}),
      // A link followed inside the viewer keeps the way back of what was open.
      viewing: { ...target, from: viewing?.from ?? 'chat' },
    });
  };
  /** Closes the viewer: back to the list it was opened from, or (opened from the chat) to the chat. */
  const closeViewer = (next: WorkPanelView = workView) => {
    setExpanded(false);
    if (viewerOpenedPanel.current) return closeWork();
    // Opened from the chat: a key that went to the viewer goes to the message field next.
    if (viewing?.from === 'chat' && document.activeElement?.closest('.viewer-panel')) focusComposer();
    if (next.viewing) setWorkView({ ...next, viewing: undefined });
    else if (next !== workView) setWorkView(next);
  };
  /** What the panel asks to show next. */
  const onWorkView = (next: WorkPanelView) => {
    if (!viewing || next.viewing) return setWorkView(next);
    // Back in the viewer. Another tab chosen instead keeps the panel, also one the viewer opened.
    if (next.tab !== workView.tab) viewerOpenedPanel.current = false;
    closeViewer(next);
  };
  /** A count on the mission strip opens Tasks on that group; a task id there opens that task. */
  const openWork = (change: Partial<WorkPanelView>) => {
    // What the viewer showed gives way: the strip asks for a list or a task.
    setExpanded(false);
    viewerOpenedPanel.current = false;
    if (!workLayout.docks) setWorkFullOpen(true);
    setWorkView({
      ...workView,
      ...(workLayout.docks ? { open: true } : {}),
      viewing: undefined,
      ...change,
      seen: tasks.length,
    });
  };
  // Docked, Escape inside the panel gives the keyboard back to the message field; the panel stays.
  useEscape(workOpen && !workFull, (event) => {
    // The viewer inside it goes first, whichever of the two claimed the key last (Dock claims it anew).
    if (viewing) return false;
    if (!(event.target instanceof Element) || !event.target.closest('.gc-work')) return false;
    // A field with text in it (the task filter, a message to a task) is cleared by its own Escape first.
    if (holdsTypedText(event.target)) return false;
    focusComposer();
  });
  const localImages = useLocalImages(session?.turns, view?.notices, !!config?.files, activeCwd);
  // Stable while the images are, so memoized Markdown does not re-render on every update.
  const imageUrl = useMemo(
    () => (config?.files ? imageResolver(localImages) : undefined),
    [config?.files, localImages],
  );

  // Close the viewer if the conversation was cleared and the open artifact no longer exists.
  useEffect(() => {
    if (viewing?.kind === 'artifact' && !sessionArtifacts.some((g) => g.id === viewing.id)) closeViewer();
  }, [viewing, sessionArtifacts]);

  const revealFile = (path: string) => {
    void chatFetch('/api/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
      body: JSON.stringify({ path }),
    }).catch(() => undefined);
  };

  const openArtifactInPanel = (artifact: Artifact) => {
    const group = sessionArtifacts.find((g) => g.id === artifact.id);
    const followLatest = !group || artifact.version >= group.latest.version;
    openViewer({ kind: 'artifact', id: artifact.id, ...(followLatest ? {} : { version: artifact.version }) });
  };
  const openFile = config?.files
    ? (path: string, position?: FilePosition) => openViewer({ kind: 'file', path, position })
    : undefined;
  const submit = (text: string, files?: File[]): Promise<boolean> => {
    const own = parseSlash(text);
    // Not sent, and the message field keeps it: the window is moving to another chat, or a folder
    // for one is being looked up. Only a command that moves the window itself goes, and comes after.
    if ((switchingRef.current || lookingUpRef.current > 0) && !(own && navigates(own) && !files?.length))
      return Promise.resolve(false);
    // A command of genaicode's own takes effect now, also while an earlier prompt's files upload.
    if (own) {
      if (files?.length) {
        setUnsent({ problem: 'Not sent: files go with a prompt, not with a command.', text: text.trim() });
        return Promise.resolve(false);
      }
      if (own.kind === 'plan') return orderedControl(text);
      if (own.kind === 'stop' && currentRow?.position) return cancelQueue().then(() => true);
      // As the switch: for the conversation shown now, so a chat opened meanwhile is not approved.
      if (own.kind === 'auto' && own.invalid === undefined && view?.generation !== undefined) {
        setAutoApprove(own.on ?? !view.autoApprove);
        return Promise.resolve(true);
      }
      // A chat asked for by id is numbered with those picked in the sidebar: the one asked for last wins.
      if (own.kind === 'continue' && own.id) {
        void switchChat({ type: 'continue', id: own.id, takeover: true }, 'open that chat');
        return Promise.resolve(true);
      }
      // `/clear` is the new chat of the project line's Home folder, numbered with the other requests.
      if (own.kind === 'clear') {
        void switchChat({ type: 'home-chat' }, 'start a new chat');
        return Promise.resolve(true);
      }
      // Stopping or leaving the conversation drops what still waits here, as the buttons do.
      if (['stop', 'new', 'continue', 'agent', 'quit'].includes(own.kind)) dropWaiting();
      // A new agent session in this chat: a chat or folder still asked for does not move it.
      if (own.kind === 'new') {
        const stayed = switchingRef.current
          ? switchChat({ type: 'stay-chat' }, 'stay in this chat')
          : ((switchSeq.current += 1), refreshLookups(), Promise.resolve(true));
        // Only when the window is still here: a chat opened meanwhile (`undefined`) is not reset.
        return stayed.then((here) => (here !== true ? false : inChat({ type: 'submit', text }).catch(() => false)));
      }
      return inChat({ type: 'submit', text }).then(
        () => true,
        () => true,
      );
    }
    const dropped = waiting.signal;
    const mine = sending.then(() => sendPrompt(text, files ?? [], dropped, view?.generation));
    sending = mine;
    return mine.then((problem) => {
      // With its words: the composer takes them back only while it is empty.
      if (route === pageChat() && !dropped.aborted) setUnsent(problem ? { problem, text: text.trim() } : undefined);
      return !problem;
    });
  };

  const currentAgent = view?.agents.find((agent) => agent.name === session?.agent);
  const efforts = currentAgent?.effort ?? [];
  // Invalidate outstanding local actions when navigation comes from the URL or another window.
  useEffect(() => {
    switchSeq.current++;
    switchingRef.current = false;
    setSwitching(false);
    refreshLookups();
    seenAuthFail.current.clear();
    setHeld(undefined);
    setUnsent(undefined);
    setWorkFullOpen(false);
    setExpanded(false);
    setPanel('chat');
  }, [selected]);

  // The Model field's list: picked here lately, run by this agent (the index, this chat), known to it.
  const [recentModels, setRecentModels] = useState<string[]>([]);
  useEffect(() => {
    setRecentModels(session?.agent ? readRecentModels(workStore(), session.agent) : []);
  }, [session?.agent]);
  const models = useMemo(() => {
    if (!session?.agent) return [];
    const seen = new Set<string>();
    const sessions = [...chats.own, ...chats.all].filter((one) => {
      const key = `${one.source}\u0000${one.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return modelSuggestions({
      agent: session.agent,
      ...(currentAgent?.store ? { store: currentAgent.store } : {}),
      sessions,
      reported: session.reportedModel,
      known: currentAgent?.models,
      recent: recentModels,
    });
  }, [session?.agent, session?.reportedModel, currentAgent, chats.own, chats.all, recentModels]);
  const pickModel = (model: string) => {
    if (session?.agent) setRecentModels(rememberModel(workStore(), session.agent, model));
    return inChat({ type: 'model', model });
  };
  const canPlan = !!currentAgent?.canPlan;
  const planOn = session?.mode === 'plan';
  // What the next prompt runs with sits where it is typed: one chip for the agent, then the modes.
  const controls =
    view && session ? (
      <>
        <AgentChip
          agent={session.agent}
          model={session.model}
          reportedModel={session.reportedModel}
          models={models}
          effort={session.effort}
          efforts={efforts}
          fallback={session.fallback ?? []}
          agents={agentList}
          noQuestions={new Set(view.agents.filter((agent) => agent.canAsk === false).map((agent) => agent.name))}
          running={running}
          onAgent={(name) => {
            // What still waits here was meant for the other agent.
            dropWaiting();
            void inChat({ type: 'agent', name });
          }}
          onModel={(model) => void pickModel(model)}
          onEffort={(level) => control(`/effort ${level}`)}
          onFallback={(names) => control(`/fallback ${names.length ? names.join(',') : 'off'}`)}
          onOpenSetup={hasAgentsApi ? openSetup : undefined}
        />
        <span className="grow" />
        {canPlan ? (
          <PlanToggle on={planOn} onToggle={(on) => void orderedControl(`/plan ${on ? 'on' : 'off'}`)} />
        ) : null}
        <PermissionSwitch auto={view.autoApprove} onChange={setAutoApprove} />
      </>
    ) : null;
  const stopTurn = () => {
    dropWaiting();
    void inChat({ type: 'stop' });
  };
  const canStop = running || !!view?.shells;
  // Stop has a key of its own (⌘. on a Mac, Ctrl+. elsewhere), wherever the focus is.
  const stopKey = useRef({ canStop, stopTurn });
  stopKey.current = { canStop, stopTurn };
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '.' || event.altKey || event.shiftKey) return;
      if (!(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
      if (!stopKey.current.canStop) return;
      event.preventDefault();
      stopKey.current.stopTurn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const relaunch = () => {
    setRelaunching(true);
    chatFetch('/api/relaunch', { method: 'POST', headers: { 'x-genaicode-token': token } })
      .then((reply) => reply.ok || setRelaunching(false))
      .catch(() => setRelaunching(false));
  };
  const backToChat = () => {
    setPanel('chat');
    // Back from a page, the next key goes to the message field.
    focusComposer();
  };
  const openSessions = (which: 'all' | 'needs' | 'own') => {
    setTopic(undefined);
    setListed(which);
    setPanel('sessions');
  };
  // Needs you is one page, whatever the sources are: with nothing to list it says so.
  const openNeedsYou = () => setPanel('needs');
  const pageTitle =
    panel === 'sessions'
      ? listed === 'own'
        ? 'All chats'
        : 'All sessions'
      : panel === 'needs'
        ? 'Needs you'
        : panel === 'settings'
          ? 'Settings'
          : undefined;
  const lastTurn = session?.turns.at(-1);
  // The store of the chat's agent: another store may hold a session with the same id.
  const openStore = view?.agents.find((agent) => agent.name === session?.agent)?.store;
  const openChat = useMemo(
    () =>
      session && lastTurn
        ? {
            id: session.sessionId,
            source: openStore,
            agent: session.agent,
            cwd: activeCwd,
            title: convTitle,
            updatedAt: lastTurn.endedAt ?? lastTurn.startedAt,
          }
        : undefined,
    [session?.sessionId, openStore, session?.agent, activeCwd, convTitle, lastTurn?.endedAt, lastTurn?.startedAt],
  );
  const ownChats = useMemo(
    () =>
      loaded.length
        ? [
            ...loaded,
            ...chats.own.filter(
              (row) =>
                !loaded.some(
                  (live) =>
                    live.id === row.id &&
                    (live.source === row.source ||
                      (live.source.startsWith('genaicode:open:') && live.agent === row.agent)),
                ),
            ),
          ]
        : withOpenChat(chats.own, openChat),
    [loaded, chats.own, openChat],
  );
  const projects = useMemo(() => chatProjects(ownChats, isHome ? { home: cwd } : {}), [ownChats, isHome, cwd]);
  const openRow = loaded.length
    ? loaded.find((row) => row.chat === pageChat())
    : openChat
      ? ownChats.find((chat) => isOpenChat(chat, openChat))
      : undefined;
  // The general index may answer first: none of its sessions is another agent's until this app's
  // chats are known, or an app chat would show as one (and open All sessions).
  const othersKnown = hasSessions && chats.ownKnown;
  const others = useMemo(
    () => (othersKnown ? otherSessions(chats.all, ownChats) : undefined),
    [othersKnown, chats.all, ownChats],
  );
  // Search (⌘K) looks through all of them, not the few the sidebar shows.
  const searchSessions = useMemo(
    () => (othersKnown ? otherSessions(chats.all, ownChats, Infinity).shown : NO_SESSIONS),
    [othersKnown, chats.all, ownChats],
  );
  // This app's chats that every agent's list leaves out (an automated one) ask too, and so does a
  // session a hook's question is open for, though its row was read before the question.
  const needsRows = useMemo(() => needsSessions(chats.all, ownChats, chats.asks), [chats.all, ownChats, chats.asks]);
  const liveOwner = (row: Pick<SessionInfo, 'id' | 'source' | 'agent'>) =>
    loaded.some(
      (chat) =>
        chat.id === row.id &&
        (chat.source === row.source || (chat.source.startsWith('genaicode:open:') && chat.agent === row.agent)),
    );
  const elsewhereRows = loaded.length ? needsRows.filter((row) => !liveOwner(row)) : needsRows;
  const externalOwn = loaded.length ? ownChats.filter((row) => !liveOwner(row)) : ownChats;
  const externalAsks = loaded.length
    ? chats.asks.filter(
        (ask) => !loaded.some((row) => row.approvals.length && row.agent === ask.agent && row.id === ask.session),
      )
    : chats.asks;
  const externalTower = view?.tower?.items.filter(
    (item) =>
      !item.id.startsWith('hook:') ||
      !loaded.some((row) => row.approvals.length && row.agent === item.agent && row.id === item.sessionId),
  );
  const needs = needsYou({
    approvals: session?.approvals.length ?? 0,
    tower: externalTower,
    sessions: elsewhereRows,
    open: { id: session?.sessionId, source: openStore },
  });
  // What has no time of its own waits since this window first saw it.
  const seen = useFirstSeen([
    ...(session?.approvals ?? []).map((request) => `chat:${request.id}`),
    ...(view?.tower?.items ?? []).map((item) => `tower:${item.id}`),
  ]);
  // The queue behind that count: the same sources, read the same way.
  const queue = needsItems({
    chat: session
      ? {
          approvals: session.approvals,
          owner: config?.multiChat ? pageChat() : undefined,
          turnId: lastTurn?.id,
          agent: session.agent,
          cwd: activeCwd,
          title: convTitle,
          id: session.sessionId,
          source: openStore,
          pack:
            lastTurn?.pack && !lastTurn.result ? { lead: lastTurn.pack.lead, tasks: lastTurn.pack.tasks } : undefined,
        }
      : undefined,
    tower: externalTower,
    sessions: elsewhereRows,
    own: externalOwn,
    // Until this app's chats are read, a session of the general index may be one: no Open action.
    ownKnown: chats.ownKnown,
    asks: externalAsks,
    senders: chats.senders,
    seen,
  });
  for (const row of loaded) {
    if (row.chat === pageChat() || !row.approvals.length) continue;
    const items = needsItems({ chat: { ...row, cwd: row.cwd ?? '', turnId: row.turn }, sessions: [] });
    for (const [i, item] of items.entries()) {
      const request = row.approvals[i]!;
      queue.push({
        ...item,
        source: 'app',
        key: `chat:${row.chat}:${row.turn}:${request.id}`,
        origin: row.title ?? row.agent,
        open: { to: 'own', session: row },
        note: undefined,
        ...(request.kind === 'question' ? { question: { request, owner: row.chat, turn: row.turn } } : {}),
        choices: item.choices.map((choice) => ({
          ...choice,
          decision: { ...choice.decision, owner: row.chat, turn: row.turn },
        })),
      });
    }
  }
  if (loaded.length) {
    needs.total = queue.length;
    if (!queue.length) needs.title = 'Nothing needs you now';
    else if (queue.some((item) => item.source === 'app')) needs.title = `Needs you: ${needs.total} across all projects`;
  }
  const sidebarNeeds = useMemo(
    () => ({ total: needs.total, here: needs.here, sessions: needs.sessions, title: needs.title }),
    [needs.total, needs.here, needs.sessions, needs.title],
  );
  const canNewChatIn = useCallback(
    (project: { key: string }) => isHome || project.key === cwd.replace(/(?!^)[\\/]+$/, ''),
    [isHome, cwd],
  );
  const artifactUrl = useCallback(
    (artifact: { id: string; version: number }) => chatUrl(`/artifacts/${artifact.id}?v=${artifact.version}`, route),
    [route],
  );
  const decideNeed = async (decision: NeedsDecision): Promise<boolean> => {
    if (decision.via === 'chat')
      return (
        (
          await postCommand(
            { type: 'approve', id: decision.id, decision: decision.decision },
            decision.owner ?? pageChat(),
            decision.turn ?? lastTurn?.id,
          )
        ).ok === true
      );
    if (decision.via === 'answer')
      return (
        (
          await postCommand(
            { type: 'answer', id: decision.id, answers: decision.answers },
            decision.owner,
            decision.turn,
          )
        ).ok === true
      );
    if (decision.via === 'tower') {
      const done = await inChat({ type: 'tower', id: decision.id, decision: decision.decision });
      // A hook's question the tower answered: the listing still has it, and the session waiting,
      // until it is read again.
      // The tower's card names the session, so it settles even before the listing has the questions.
      const card = view?.tower?.items.find((item) => item.id === decision.id);
      if (done && decision.id.startsWith('hook:'))
        chats.answered(
          decision.id.slice('hook:'.length),
          card?.sessionId ? { agent: card.agent, session: card.sessionId } : undefined,
        );
      else chats.refresh();
      return done;
    }
    const res = await chatFetch(`/api/asks/${decision.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
      body: JSON.stringify({ behavior: decision.behavior }),
    });
    // Answered now, or meanwhile elsewhere (409): either way it no longer waits.
    const asked = chats.asks.find((ask) => ask.id === decision.id);
    if (res.ok || res.status === 409)
      chats.answered(decision.id, asked ? { agent: asked.agent, session: asked.session } : undefined);
    else chats.refresh();
    // 409: answered meanwhile, elsewhere.
    if (!res.ok && res.status !== 409) throw new Error(`The server answered ${res.status}.`);
    return res.ok;
  };
  // Per agent: for the chat's own agent, what its runs here reported wins over what was last seen.
  // The sidebar and Settings › Usage show the same.
  const knownLimits = useMemo(
    () => chatLimits(allLimits, rateLimits, session?.agent),
    [allLimits, rateLimits, session?.agent],
  );
  const quota = useMemo(() => (session ? quotaRows(knownLimits, [session.agent]) : []), [knownLimits, session?.agent]);
  // Settings shows Usage where a limit is served or reported, or a session index tells where work went.
  const usageShown = !!(config?.limits || hasSessions || knownLimits.length);
  return (
    <>
      <Shell
        title={openedSession?.title ?? openedSession?.id ?? pageTitle ?? convTitle ?? 'New chat'}
        subtitle={!pageTitle && convTopic && convTopic !== convTitle ? convTopic : undefined}
        project={
          !pageTitle && activeCwd && (hasProject || (isHome && conversation && conversation.origin !== 'home'))
            ? { name: folderName(activeCwd), path: activeCwd }
            : undefined
        }
        backLabel={openedSession ? pageTitle : undefined}
        onBack={
          panel === 'chat'
            ? workFull
              ? // Expanded over the chat, back docks the viewer; with no room to dock, it closes the view.
                expanded && workLayout.docks
                ? () => setExpanded(false)
                : closeWork
              : undefined
            : openedSession
              ? () => setOpenedSession(undefined)
              : backToChat
        }
        onToggleWork={view && session && hasWork ? toggleWork : undefined}
        onRoom={setRoom}
        workFull={workFull}
        onStop={
          workFull && running && !switching
            ? () => {
                dropWaiting();
                // Only the turn it was pressed for: the window may be on another chat when it arrives.
                const turn = session?.turns.at(-1)?.id;
                void inChat({ type: 'stop', conversation: chatKey, ...(turn ? { turn } : {}) });
              }
            : undefined
        }
        work={
          workOpen ? (
            <WorkPanel
              state={session}
              chatId={view?.generation !== undefined ? String(view.generation) : chatKey || undefined}
              view={workView}
              onView={onWorkView}
              onClose={closeWork}
              needsYou={{ total: needs.total, onOpen: openNeedsYou }}
              mode={workFull ? 'full' : 'docked'}
              width={workLayout.width}
              bounds={() => [WORK_PANEL_MIN, latestLayout.current.max]}
              onWidth={(width, commit) => {
                if (viewing) {
                  setSavedViewerWidth(width);
                  if (commit) viewerWidth.set(width);
                  return;
                }
                setSavedWidth(width);
                if (commit) workWidth.set(width);
              }}
              viewsFiles={!!config?.files}
              renderViewer={(target, controls) => (
                <ViewerPanel
                  target={target}
                  token={token}
                  artifacts={sessionArtifacts}
                  canReveal={config?.reveal}
                  onReveal={revealFile}
                  onOpenFile={openFile}
                  imageUrl={imageUrl}
                  onSelectArtifactVersion={(version) =>
                    target.kind === 'artifact'
                      ? setWorkView({ ...workView, viewing: { ...target, version } })
                      : undefined
                  }
                  onArtifactSubmit={
                    connected && !inSetup
                      ? (artifact, data) => void submit(artifactSubmission(artifact, data))
                      : undefined
                  }
                  // The lead's own edit, opened from Changes: its diff first.
                  diff={
                    target.kind === 'file' && target.from === 'changes'
                      ? changes.lead.find((row) => row.path === target.path)?.diff
                      : undefined
                  }
                  back={{ label: controls.backLabel, onBack: controls.onBack }}
                  expanded={expanded && workLayout.docks}
                  onExpand={workLayout.docks ? setExpanded : undefined}
                />
              )}
              // While the window moves to another chat nothing here may act: it would act on the chat left.
              disabled={!connected || switching}
              onPackAction={async (turnId, id, action, intent) => {
                // The server refuses it once the window shows another conversation.
                // Discard is offered without Merge locally when the pull request held the work as the
                // confirmation opened: the server checks that again first, so an edit made since is not
                // lost, also when the panel learned of it while the confirmation was open.
                const held = action.type === 'discard' && intent?.pullRequest === true;
                const reply = await postCommand({
                  generation: view?.generation,
                  type: 'pack-task',
                  turnId,
                  id,
                  action,
                  conversation: chatKey,
                  ...(held ? { pullRequest: true as const } : {}),
                });
                if (!reply.ok)
                  throw Object.assign(new Error(reply.error ?? 'The task action failed.'), { reason: reply.reason });
                return reply.text ?? '';
              }}
              onApprove={(id, decision, confirmed) =>
                inChat({ type: 'approve', id, decision, confirmed }).catch(() => false)
              }
              onAutoApprove={view?.autoApprove ? undefined : () => setAutoApprove(true)}
              pullRequests={pullRequests}
            />
          ) : null
        }
        usage={!pageTitle && usage ? usage : undefined}
        actions={
          view && session && panel === 'chat' ? (
            <>
              {session.sessionId || session.turns.length ? (
                <TranscriptMenu
                  token={token}
                  endpoint="/api/transcript"
                  sessionId={session.sessionId}
                  nativeSave={config?.nativeSave}
                  label="⋯"
                  ariaLabel="Session menu"
                  title={
                    session.sessionId
                      ? `Session ${session.sessionId}: copy ID, file path or transcript`
                      : 'Copy or save conversation transcript'
                  }
                  buttonClassName="btn ghost icon sm"
                  onStatus={showToast}
                  extra={
                    config?.projectTeams
                      ? (close) => (
                          <>
                            <hr />
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                close();
                                openSettings('team');
                              }}
                            >
                              Team for this project…
                            </button>
                          </>
                        )
                      : undefined
                  }
                />
              ) : null}
              {hasWork ? (
                <button
                  type="button"
                  className="btn ghost sm work-toggle"
                  aria-pressed={workOpen}
                  title={`Work panel (⌘⌥B)${workNeeds ? ` · ${workNeeds} in this chat ${workNeeds === 1 ? 'needs' : 'need'} you` : ''}${workNews ? ' · new work since you last looked' : ''}`}
                  data-tauri-drag-region="false"
                  onClick={toggleWork}
                >
                  <Icon name="work" />
                  Work
                  {workNeeds ? <span className="count hot">{workNeeds}</span> : null}
                  {workNews ? <span className="badge-dot" role="img" aria-label="New work" /> : null}
                </button>
              ) : null}
            </>
          ) : null
        }
        search={{
          chats: ownChats,
          sessions: searchSessions,
          home: isHome ? cwd : undefined,
          // As its row in the sidebar: another agent's session is shown among all sessions.
          onOpenSession: () => openSessions('all'),
          // The sections the Settings page has here, each opened in its place.
          settings: settingsSections({
            agents: hasAgentsApi || undefined,
            team: config?.projectTeams || undefined,
            artifacts: config?.canConfigureCdn || undefined,
            usage: usageShown || undefined,
          }).map((which) => ({ label: SECTION_LABEL[which], onSelect: () => openSettings(which) })),
        }}
        side={{
          page:
            panel === 'chat'
              ? 'chat'
              : panel === 'settings'
                ? 'settings'
                : panel === 'needs'
                  ? 'inbox'
                  : listed === 'own'
                    ? 'chats'
                    : 'sessions',
          onNewChat: startHomeChat,
          busyWith: running && !config?.multiChat ? runningName : undefined,
          needs: sidebarNeeds,
          onNeedsYou: openNeedsYou,
          onAllSessions: hasSessions ? () => openSessions('all') : undefined,
          onAllChats: hasSessions ? () => openSessions('own') : undefined,
          projects,
          live: loaded,
          limit: config?.maxChats,
          onArchive: hasSessions
            ? (chat) => {
                void setSessionArchive(token, [chat], true)
                  .then(() => chats.refresh())
                  .catch((error: Error) => showToast(`Could not archive chat: ${error.message}`, true));
              }
            : undefined,
          onDelete: config?.multiChat ? askDelete : undefined,
          onStop: (row) => {
            void postCommand({ type: 'stop', turn: row.turn }, row.chat);
          },
          selectedChat: openRow ? sessionKey(openRow) : undefined,
          selectedGlyph: session
            ? liveGlyph({
                status: session.status,
                approvals: session.approvals.length,
                failed: lastTurn?.result?.status === 'failed',
                turns: session.turns.length,
              })
            : undefined,
          onOpenChat: (chat) => {
            const open = !!openRow && sessionKey(chat) === sessionKey(openRow);
            // Already here, and no other chat is on its way.
            if (open && !switchingRef.current) return backToChat();
            // Another chat was asked for and has not answered: this row is the later choice, so it
            // is asked for too and overtakes that one. The row of a chat no store lists yet has no
            // id to ask with: the request that waits is dropped and the window stays.
            if (chat.source === OPEN_CHAT_SOURCE) {
              return open ? switchChat({ type: 'stay-chat' }, 'stay in this chat') : backToChat();
            }
            continueChat(chat);
          },
          onNewChatIn: (project) => {
            if (!isHome || project.key === HOME_FOLDER) return startHomeChat();
            void startProjectChat(project.key, project.name);
          },
          // Outside --home the chat has one folder: a new chat starts there and nowhere else.
          canNewChatIn,
          others,
          update: config?.update,
          relaunching,
          onRelaunch: relaunch,
          quota,
          // Only where Settings has a Usage section to open: else the ring only shows the limits.
          onQuota: usageShown ? () => openSettings('usage') : undefined,
          onSettings: () => openSettings(panel === 'settings' ? section : 'general'),
          version: release?.version ?? root.dataset.version,
          whatsNewUnread: !!release && seenRelease !== release.version,
          onWhatsNew: release ? () => whatsNew.current?.showModal() : undefined,
          onCommands: () => {
            control('/help');
            backToChat();
          },
          connected,
        }}
      >
        {showSessions || openedSession ? (
          <Sessions
            onArchived={chats.refresh}
            onDelete={config?.multiChat ? askDelete : undefined}
            selected={openedSession}
            onOpen={setOpenedSession}
            key={listed}
            token={token}
            cwd={activeCwd}
            home={isHome}
            topic={topic}
            onAllTopics={() => setTopic(undefined)}
            // From the Needs you page: the sessions that ask now, as the list has them.
            initialState={needsOnly ? 'now' : undefined}
            own={showSessions && listed === 'own'}
            initialDays={listed === 'own' ? 0 : undefined}
            onAllSessions={() => openSessions('all')}
            nativeSave={config?.nativeSave}
            onStatus={showToast}
            onNewTopicChat={isHome ? startTopicChat : undefined}
            // The chat says what happened, also when it could not.
            onContinue={takeOverChat}
            onAnswered={chats.answered}
            onReplied={chats.replied}
          />
        ) : null}
        {panel === 'needs' ? (
          <NeedsYouPage
            hidden={!!openedSession}
            items={queue}
            chatTitle={convTitle}
            connected={connected}
            token={token}
            tower={view?.tower}
            unread={{ failed: chats.failed, errors: chats.errors }}
            decide={decideNeed}
            onOpen={(item) => {
              if (item.open?.to === 'chat') backToChat();
              else if (item.open?.to === 'own') continueChat(item.open.session);
              else if (item.open?.session) setOpenedSession(item.open.session);
              else if (item.open) openSessions('needs');
            }}
            sessionsPage={hasSessions}
            onReplied={chats.replied}
          />
        ) : null}
        {panel === 'settings' ? (
          <SettingsPage
            section={section}
            onSection={(which) => {
              setFocusAgent(undefined);
              setSection(which);
            }}
            general={{
              maxChats: config?.maxChats,
              onMaxChats: (limit) => {
                void chatFetch('/api/settings', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
                  body: JSON.stringify({ maxChats: limit }),
                })
                  .then((res) => {
                    if (!res.ok) showToast('Could not save the chat limit.', true);
                  })
                  .catch(() => showToast('Could not save the chat limit.', true));
              },
              theme,
              onTheme: setTheme,
              bark: view?.bark,
              onBark: (on) => control(`/bark ${on ? 'on' : 'off'}`),
            }}
            agents={
              hasAgentsApi
                ? {
                    agents: agentList,
                    loading: loadingAgents,
                    checking: checkingAgents,
                    current: session?.agent,
                    focusAgent,
                    onCheckAgain: () => checkAgents({ env: true }),
                    holding,
                    ...(config?.agentTools ? { agentTools: { token } } : {}),
                    onUse: inSetup
                      ? undefined
                      : (name) => {
                          // `agent` names no chat: while another is being opened it would reach the
                          // one being left.
                          if (switchingRef.current || lookingUpRef.current > 0) return;
                          dropWaiting();
                          void inChat({ type: 'agent', name });
                          backToChat();
                        },
                  }
                : undefined
            }
            team={
              config?.projectTeams
                ? {
                    token,
                    cwd: teamFolder,
                    sessions: hasSessions,
                    choose: config.chooseFolder ? () => chooseFolder().then((found) => found?.path) : undefined,
                  }
                : undefined
            }
            artifacts={config?.canConfigureCdn ? { token, hosts: config.artifactCdn ?? [] } : undefined}
            usage={
              // Nothing to say where no limit is served or reported, and no session index tells where work went.
              usageShown
                ? {
                    token,
                    limits: knownLimits,
                    shares: hasSessions,
                    onTopic: (id) => {
                      setTopic(id);
                      setListed('all');
                      setPanel('sessions');
                    },
                  }
                : undefined
            }
            about={{
              version: release?.version ?? root.dataset.version,
              update: config?.update,
              relaunching,
              onRelaunch: relaunch,
              onWhatsNew: release ? () => whatsNew.current?.showModal() : undefined,
            }}
          />
        ) : null}
        {/* Under the full-width work view the chat keeps running, out of reach of the keyboard. */}
        <div className="workspace" style={panel !== 'chat' ? { display: 'none' } : undefined} inert={workFull}>
          {/* Under a page the chat is hidden, and so is what is open in it: its Escape waits with it. */}
          <EscapeActive.Provider value={panel === 'chat' && !workFull}>
            {currentRow?.position && (
              <div role="status">
                Waiting for a free slot · {currentRow.position - 1} ahead{' '}
                <button type="button" onClick={() => void cancelQueue()}>
                  Cancel
                </button>
              </div>
            )}
            {currentRow &&
              loaded.some(
                (row) => row.chat !== currentRow.chat && row.cwd === currentRow.cwd && row.turnInProgress,
              ) && <div role="status">Another chat is working in this folder.</div>}
            <AgentChat
              key={
                route
                  ? route + ':' + (returnedDraft && returnedDraft.chat === route ? returnedDraft.stamp : '')
                  : 'single'
              }
              initialDraft={savedDraft(route)}
              onDraftChange={route ? (draft) => rememberDraft(route, draft) : undefined}
              state={session}
              chatId={view?.generation !== undefined ? String(view.generation) : chatKey || undefined}
              header={null}
              // The work in one line that opens on click: a long run of tool calls buries the answer.
              foldSteps
              autoFocus={!inSetup}
              theme={theme === 'system' ? undefined : theme}
              disabled={!connected || inSetup || holding}
              sendsWhileDisabled={
                connected && !inSetup && holding
                  ? (draft) => {
                      const own = parseSlash(draft);
                      return !!own && navigates(own);
                    }
                  : undefined
              }
              placeholder={inSetup ? 'Connect an agent to start' : undefined}
              notices={view?.notices}
              artifactUrl={artifactUrl}
              onOpenArtifact={openArtifactInPanel}
              imageUrl={imageUrl}
              completions={SLASH_COMMANDS}
              composerLayout="card"
              composerHeader={
                // A page that names no project (`ui --no-project`) has no folder to say.
                newChat && activeCwd && (isHome || hasProject) ? (
                  <StartsIn
                    cwd={activeCwd}
                    atHome={isHome && (!conversation || conversation.origin === 'home')}
                    folder={folder}
                    projects={projects}
                    canChange={isHome}
                    mark={chatMark}
                    onProject={startChosenProject}
                    onHome={startHomeChat}
                    onStay={stayInChat}
                    inspect={(path) => lookUp(inspectFolder(path))}
                    choose={config?.chooseFolder ? () => lookUp(chooseFolder()) : undefined}
                  />
                ) : undefined
              }
              composerExtras={inSetup ? null : controls}
              attachments={config?.uploads && !inSetup ? ATTACH : undefined}
              onOpenFile={openFile}
              onRevealFile={config?.reveal ? revealFile : undefined}
              renderPrompt={promptBubble}
              renderFailure={(turn) =>
                // The agent did not take the model set for it: said with the model and the agent.
                session?.model &&
                turn === session.turns.at(-1) &&
                turn.agent === session.agent &&
                rejectsModel(turnErrorText(turn), session.model, turn.result?.failure?.kind) ? (
                  <ModelRejected
                    agent={turn.agent}
                    model={session.model}
                    onDefault={() => {
                      // Not offered again among the picks.
                      setRecentModels(forgetModel(workStore(), turn.agent, session.model!));
                      void pickModel('').then(() => {
                        if (turn.prompt) void submit(turn.prompt);
                      });
                    }}
                  />
                ) : turn.result?.failure?.kind === 'auth' ? (
                  <SignInCard
                    agent={turn.agent}
                    inspection={agentList.find((item) => item.name === turn.agent)}
                    inspectedAt={inspectedAt}
                    failedAt={turn.endedAt ?? turn.startedAt}
                    checking={checkingAgents}
                    onCheckAgain={() => checkAgents({ env: true })}
                    onRetry={
                      turn.prompt
                        ? () => {
                            void submit(turn.prompt);
                          }
                        : undefined
                    }
                  />
                ) : undefined
              }
              renderFooter={() => {
                const setupBanner =
                  inSetup && session && session.turns.length > 0 ? (
                    <div className="setup-banner" role="region" aria-label="Connect a coding agent">
                      <div className="setup-banner-copy">
                        <strong>Connect an agent to continue this conversation</strong>
                        <span>
                          {agentList.some((agent) => agent.installed && !agent.broken && agent.auth === 'signed-out')
                            ? 'Sign in to an installed agent in Terminal, then click Check again.'
                            : 'Install a supported agent CLI in Terminal, then click Check again.'}
                        </span>
                      </div>
                      <div className="setup-banner-actions">
                        <button type="button" className="btn-primary" onClick={() => openSetup()}>
                          Connect agent
                        </button>
                        {hasAgentsApi ? (
                          <button
                            type="button"
                            className="btn-use"
                            disabled={checkingAgents}
                            onClick={() => void checkAgents({ env: true })}
                          >
                            {checkingAgents ? 'Checking…' : 'Check again'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null;
                const unsentBox = unsent ? (
                  <div className="gc-notice gc-err">
                    {unsent.problem}
                    {unsent.text ? <blockquote className="unsent">{unsent.text}</blockquote> : null}
                  </div>
                ) : null;
                const heldBox = held ? (
                  <div className="switch-held" role="status" aria-label="Another chat waits">
                    <span className="switch-held-copy">
                      {held.step === 'ask'
                        ? `A turn is running in ${runningName}. Stop it to open ${held.label} now, or wait: it opens when the turn finishes.`
                        : held.step === 'stopping'
                          ? `Stopping the turn in ${runningName}, then opening ${held.label}…`
                          : `${capitalized(held.label)} opens when ${runningName} finishes.`}
                    </span>
                    <span className="switch-held-actions">
                      {held.step === 'ask' ? (
                        <>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => {
                              setHeld({ ...held, step: 'stopping' });
                              stopTurn();
                            }}
                          >
                            Stop and open
                          </button>
                          <button
                            type="button"
                            className="btn-use"
                            onClick={() => setHeld({ ...held, step: 'waiting' })}
                          >
                            Wait
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn-use" onClick={() => setHeld(undefined)}>
                          {held.step === 'waiting' ? 'Don’t open' : 'Stay here'}
                        </button>
                      )}
                    </span>
                  </div>
                ) : null;
                if (!setupBanner && !unsentBox && !heldBox) return null;
                return (
                  <>
                    {setupBanner}
                    {heldBox}
                    {unsentBox}
                  </>
                );
              }}
              onSend={submit}
              onStop={stopTurn}
              canStop={!!view?.shells}
              onApprove={(id, decision) => inChat({ type: 'approve', id, decision }).catch(() => false)}
              onAnswer={(id, answers) => void inChat({ type: 'answer', id, answers })}
              onAutoApprove={view?.autoApprove ? undefined : () => setAutoApprove(true)}
              // The tasks are in the work panel: a turn shows them as one line that opens it.
              onOpenTasks={openTasks}
              // The team's counts and the next approval of a task, above the message box at every width.
              missionStrip={{
                pullRequests,
                dismissed: workView.dismissed,
                onOpenGroup: (group) =>
                  openWork({
                    tab: 'tasks',
                    task: undefined,
                    filter: group,
                    more: undefined,
                    folded: { ...workView.folded, [group]: false },
                  }),
                // A task's detail shows on Tasks and Live only: from Changes or Artifacts it opens on Tasks.
                onOpenTask: (key) =>
                  openWork({
                    task: key,
                    ...(workView.tab === 'changes' || workView.tab === 'artifacts' ? { tab: 'tasks' as const } : {}),
                  }),
              }}
              hint={
                inSetup ? (
                  'Connect an agent to start'
                ) : session ? (
                  <ComposerHint
                    action={submitAction(session)}
                    canStop={canStop}
                    files={!!config?.uploads}
                    quota={quota}
                  />
                ) : null
              }
              composerTitle={
                inSetup
                  ? 'Connect an agent to start'
                  : `Enter sends, Shift+Enter starts a new line, Esc here stops the agent. / lists the commands${config?.uploads ? '; paste or drop files to attach them' : ''}.`
              }
              emptyState={
                session ? (
                  inSetup ? (
                    <Onboarding
                      agents={agentList}
                      limits={allLimits}
                      loading={loadingAgents}
                      checking={checkingAgents}
                      onCheckAgain={() => checkAgents({ env: true })}
                    />
                  ) : (
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
                              : "Working in this topic's workspace. Hover the folder in the top bar or type /where to see the directory."
                            : isHome && conversation?.origin === 'project'
                              ? 'Hover the folder in the top bar or type /where to see the directory.'
                              : 'It sees the sessions of your agents in every project, and can pass them a message.'}
                      </div>
                      {hasSessions && (!isHome || !conversation || conversation.origin === 'home') ? (
                        <Home
                          token={token}
                          onTopic={(id) => {
                            setTopic(id);
                            setListed('all');
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
                  )
                ) : rejected ? (
                  <div className="gc-empty">Open the link genaicode printed in your terminal (it carries a token).</div>
                ) : (
                  <div className="gc-empty">Connecting…</div>
                )
              }
            />
          </EscapeActive.Provider>
        </div>
      </Shell>
      {release ? (
        <WhatsNewDialog
          ref={whatsNew}
          release={release}
          onSeen={() => {
            setSeenRelease(release.version);
            try {
              localStorage.setItem(WHATS_NEW_KEY, release.version);
            } catch {
              // Storage blocked: the dot is back on the next load.
            }
          }}
        />
      ) : null}
      <dialog
        ref={deleteDialog}
        className="release-dialog"
        aria-labelledby="delete-chat-title"
        onClose={() => setDeleting(undefined)}
      >
        <h2 id="delete-chat-title">Delete chat history?</h2>
        <p>
          Permanently delete “{deleting && chatTitle(deleting.row)}” from Genaicode? The agent keeps its own transcript.
        </p>
        <form method="dialog">
          <button type="submit" className="btn" autoFocus>
            Cancel
          </button>{' '}
          <button type="button" className="btn danger" onClick={() => void deleteHistory()}>
            Delete history
          </button>
        </form>
      </dialog>
      {toast ? (
        <div className={`gc-toast${toast.error ? ' err' : ''}`} role="status" aria-live="polite">
          {toast.text}
          {toast.chat ? (
            <button type="button" onClick={() => showChat(toast.chat!)}>
              Open chat
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ChatWindow() {
  const [route, setRoute] = useState(pageChat);
  useEffect(() => {
    const changed = () => {
      dropWaiting();
      setRoute(pageChat());
    };
    window.addEventListener('genaicode-chat', changed);
    window.addEventListener('hashchange', changed);
    return () => {
      window.removeEventListener('genaicode-chat', changed);
      window.removeEventListener('hashchange', changed);
    };
  }, []);
  return <App selected={route} />;
}

// Before the first paint: the theme chosen in Settings, where there is one.
applyTheme(readTheme());
createRoot(document.getElementById('root')!).render(
  <SessionReplies>
    <ChatWindow />
  </SessionReplies>,
);
