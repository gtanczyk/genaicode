import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { takeEvents } from './sse.js';
import { createRoot } from 'react-dom/client';
import { personText } from '../../agents/host-text.js';
import { AgentChat, artifactSubmission } from '../../react/agent-chat.js';
import styles from '../../react/agent-chat.css';
import { artifactKindLabel } from '../../react/artifact-panel.js';
import { EscapeActive, useEscape } from '../../react/escape.js';
import { formatBytes, submitAction } from '../../react/format.js';
import { extractLocalImagePaths, isPathWithin, Markdown, resolveFilePath } from '../../react/markdown.js';
import { DEFAULT_ARTIFACT_CDN_HOSTS } from '../../agents/cdn.js';
import type { SessionInfo } from '../../agents/sessions/group.js';
import type { Artifact, RateLimit } from '../../agents/types.js';
import type { ChatView } from '../controller.js';
import { agentGuide, agentOrder } from '../../agents/drivers/catalog.js';
import type { AgentInspection } from '../../agents/status.js';
import { firstLine, formatUsage, needsAttention, parseSlash, SLASH_COMMANDS, splitAttached } from '../format.js';
import type { UiRelease } from './release.js';
import type { WebCommand, WebFolder, WebSessionListing, WebSwitchCommand } from './server.js';
import {
  chatProjects,
  folderName,
  HOME_FOLDER,
  liveGlyph,
  needsYou,
  needsYouPage,
  OPEN_CHAT_SOURCE,
  isOpenChat,
  otherSessions,
  quotaRows,
  sessionKey,
  withOpenChat,
} from '../sidebar.js';
import { Shell } from './shell.js';
import { AgentChip, ComposerHint, PermissionSwitch, PlanToggle, StartsIn } from './composer.js';
import { Sessions } from './sessions.js';
import { ViewerPanel, type SessionArtifactGroup, type ViewerTarget } from './file-view.js';
import { Home } from './home.js';
import { Onboarding, SignInCard } from './onboarding.js';
import { ProjectTeamDialog } from './project-team.js';
import { TowerInboxPanel } from './tower-inbox.js';
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
const WINDOW_ID = `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(3)), (part) => part.toString(36)).join('')}`;

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

/** How often the limits last seen, and the lists of the sidebar, are asked for again. */
const LIMITS_EVERY_MS = 60_000;

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
      fetch('/api/limits', { headers: { 'x-genaicode-token': token } })
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

const NO_SESSIONS: SessionInfo[] = [];

/**
 * What the sidebar lists (`/api/sessions`): this app's chats of the last 30 days, and every
 * agent's sessions of the last 7. Asked again when `stamp` changes (a turn ended, another chat was
 * opened), every minute, and when the window is looked at again.
 */
function useChats(enabled: boolean, stamp: string): { own: SessionInfo[]; all: SessionInfo[] } {
  const [own, setOwn] = useState<SessionInfo[]>(NO_SESSIONS);
  const [all, setAll] = useState<SessionInfo[]>(NO_SESSIONS);
  useEffect(() => {
    if (!enabled || !token) return;
    let current = true;
    const list = (query: string, keep: (sessions: SessionInfo[]) => void) =>
      fetch(`/api/sessions?${query}`, { headers: { 'x-genaicode-token': token } })
        .then((res) => (res.ok ? (res.json() as Promise<WebSessionListing>) : undefined))
        .then(
          (found) => {
            if (current && found) keep(found.sessions ?? []);
          },
          () => undefined,
        );
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      void list('days=30&own=1', setOwn);
      void list('days=7', setAll);
    };
    ask();
    const timer = window.setInterval(ask, LIMITS_EVERY_MS);
    document.addEventListener('visibilitychange', ask);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', ask);
    };
  }, [enabled, stamp]);
  return { own, all };
}

interface PageConfig {
  cwd: string;
  /** False when the page names no project (`ui --no-project` or `ui --home`). */
  project?: boolean;
  /** True in `--home` mode: per-conversation working directory, no fixed project folder. */
  home?: boolean;
  sessions: boolean;
  agents?: boolean;
  uploads?: boolean;
  projectTeams?: boolean;
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
      const res = await fetch(`/api/agents${query}`, { headers: { 'x-genaicode-token': token } });
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

function useView(onToast?: (text: string) => void): {
  view?: ChatView;
  config?: PageConfig;
  release?: UiRelease;
  connected: boolean;
  rejected: boolean;
} {
  const [release, setRelease] = useState<UiRelease>();
  const [view, setView] = useState<ChatView>();
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
          const taken = takeEvents(buffer);
          buffer = taken.rest;
          for (const { event, data: payload } of taken.events) {
            if (event === 'view') {
              setView(JSON.parse(payload) as ChatView);
              setConnected(true);
            } else if (event === 'release') {
              setRelease(JSON.parse(payload) as UiRelease);
            } else if (event === 'config') {
              setConfig(JSON.parse(payload) as PageConfig);
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
  }, []);
  return { view, config, release, connected, rejected };
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
  scopeKey: string,
): Record<string, string> {
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
        if (entry.kind !== 'text') continue;
        for (const path of extractLocalImagePaths(entry.text)) {
          if (!found.includes(path)) found.push(path);
        }
      }
    }
    for (const notice of notices ?? []) {
      const relay = notice.relay;
      if (relay?.status !== 'answered' || !relay.reply) continue;
      for (const rawPath of extractLocalImagePaths(relay.reply)) {
        const path = relay.cwd ? resolveFilePath(rawPath, relay.cwd) : rawPath;
        const allowed = (relay.cwd && isPathWithin(path, relay.cwd)) || (scopeKey && isPathWithin(path, scopeKey));
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
    fetch('/api/file/images', {
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

/** Collect all artifacts published in the session, grouped by id with all versions, newest first. */
function collectSessionArtifacts(turns: ChatView['session']['turns'] | undefined): SessionArtifactGroup[] {
  if (!turns?.length) return [];
  const byId = new Map<string, SessionArtifactGroup>();
  for (const turn of turns) {
    for (const entry of turn.entries) {
      if (entry.kind !== 'artifact') continue;
      const art = entry.artifact;
      const existing = byId.get(art.id);
      if (existing) {
        const versions = existing.versions.some((v) => v.version === art.version)
          ? existing.versions.map((v) => (v.version === art.version ? art : v))
          : [...existing.versions, art];
        const latest = art.version >= existing.latest.version ? art : existing.latest;
        // Move to end so newest-published comes first after reversing.
        byId.delete(art.id);
        byId.set(art.id, { id: art.id, latest, versions });
      } else {
        byId.set(art.id, { id: art.id, latest: art, versions: [art] });
      }
    }
  }
  return [...byId.values()].reverse();
}

const PRESET_CDN_ORIGINS = DEFAULT_ARTIFACT_CDN_HOSTS.map((host) => `https://${host}`);

function CdnSettingsPopover({ hosts, onClose }: { hosts: readonly string[]; onClose(): void }) {
  const fullPreset = PRESET_CDN_ORIGINS.every((origin) => hosts.includes(origin));
  // Keep individually enabled preset hosts in the custom box unless the full preset is on.
  const initialCustom = (fullPreset ? hosts.filter((h) => !PRESET_CDN_ORIGINS.includes(h)) : hosts).map((h) =>
    h.replace(/^https:\/\//, ''),
  );
  const [presetOn, setPresetOn] = useState(fullPreset);
  const [customText, setCustomText] = useState(() => initialCustom.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setSaving(true);
    setError(undefined);
    const custom = customText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = [...(presetOn ? DEFAULT_ARTIFACT_CDN_HOSTS : []), ...custom];
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ artifactCdn: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Could not save settings.');
        setSaving(false);
        return;
      }
      onClose();
    } catch {
      setError('Could not reach the server.');
      setSaving(false);
    }
  };

  return (
    <div className="popover settings-popover" role="dialog" aria-label="Artifact network settings">
      <h3>HTML artifact CDNs</h3>
      <label className="settings-toggle">
        <input type="checkbox" checked={presetOn} onChange={(event) => setPresetOn(event.target.checked)} />
        <span>Allow common library CDNs ({DEFAULT_ARTIFACT_CDN_HOSTS.join(', ')})</span>
      </label>
      <label className="settings-field">
        <span>Extra allowed hosts (one per line or comma-separated)</span>
        <textarea
          rows={3}
          placeholder="e.g. cdn.skypack.dev"
          value={customText}
          onChange={(event) => setCustomText(event.target.value)}
        />
      </label>
      <p className="settings-note">
        Off by default. Allowed hosts can serve scripts, styles and fonts inside HTML artifacts; fetch, images and forms
        stay blocked. Only allow CDNs you trust — loaded scripts run with the artifact&apos;s data.
      </p>
      {error ? <div className="settings-error">{error}</div> : null}
      <div className="settings-actions">
        <button type="button" className="chip" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="chip primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** The message field, for the focus: a new chat and the way back from a page start there. */
function focusComposer() {
  window.requestAnimationFrame(() =>
    document.querySelector<HTMLTextAreaElement>('.workspace .gc-composer textarea')?.focus(),
  );
}

/** What the server knows of a folder (`GET /api/folder`); undefined when the path is not one. */
async function inspectFolder(path: string): Promise<WebFolder | undefined> {
  const res = await fetch(`/api/folder?path=${encodeURIComponent(path)}`, { headers: { 'x-genaicode-token': token } });
  return res.ok ? ((await res.json()) as WebFolder) : undefined;
}

/** The host's folder dialog (`POST /api/choose-folder`); undefined when nothing was chosen. */
async function chooseFolder(): Promise<WebFolder | undefined> {
  const res = await fetch('/api/choose-folder', { method: 'POST', headers: { 'x-genaicode-token': token } });
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
      {release.notes ? <Markdown text={release.notes} /> : <p>No release notes bundled for this version.</p>}
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

function App() {
  const root = document.getElementById('root')!;
  const [toast, setToast] = useState<{ text: string; error?: boolean }>();
  const toastTimer = useRef<number>(undefined);
  const showToast = (text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 2600);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const { view, config, release, connected, rejected } = useView((text) => showToast(text));
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
  useBark(view);
  const [showTeam, setShowTeam] = useState(false);
  // The Sessions / Agents views take the chat's place; the chat keeps running behind them.
  const [panel, setPanel] = useState<'chat' | 'sessions' | 'inbox' | 'agents'>('chat');
  const [focusAgent, setFocusAgent] = useState<string>();
  const showSessions = panel === 'sessions';
  const showAgents = panel === 'agents';
  // What the Sessions view lists: every agent's sessions, only the ones that ask now (from Needs
  // you), or this app's own chats of all time, the archived too (from "All chats").
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
  const inSetup = view?.setup === true;
  const {
    agents: agentList,
    loading: loadingAgents,
    checking: checkingAgents,
    inspectedAt,
    checkAgain: checkAgents,
  } = useAgents(hasAgentsApi, view?.agents, inSetup || showAgents, inSetup);
  const allLimits = useAllLimits(running);
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
  const openSetup = (agent?: string) => {
    setFocusAgent(agent);
    setPanel('agents');
  };
  // When onboarding opened as a panel during setup finishes, return straight to the conversation.
  const wasSetupRef = useRef(inSetup);
  useEffect(() => {
    if (wasSetupRef.current && !inSetup && showAgents) setPanel('chat');
    wasSetupRef.current = inSetup;
  }, [inSetup, showAgents]);
  /**
   * Asks for another chat in this window. `what` names it when no answer comes at all. Resolves to
   * whether that chat is the one open now: false when the server refused, did not answer, or another
   * chat was asked for meanwhile.
   */
  const switchChat = (request: WebSwitchCommand, what: string): Promise<boolean> => {
    // What still waits here was meant for the conversation that is left.
    dropWaiting();
    setViewer(undefined);
    setPanel('chat');
    // The composer stays, and the next key goes to it.
    focusComposer();
    const mine = ++switchSeq.current;
    switchingRef.current = true;
    setSwitching(true);
    return command({ ...request, order: { window: WINDOW_ID, seq: mine } })
      .catch(() => undefined)
      .then((done) => {
        // Another chat was asked for meanwhile: its answer decides.
        if (mine !== switchSeq.current) return false;
        switchingRef.current = false;
        setSwitching(false);
        // The chat says why when the server refused; no answer at all is said here.
        if (done === undefined) showToast(`Could not ${what}.`, true);
        return done === true;
      });
  };
  const startTopicChat = (topicId: string) =>
    void switchChat({ type: 'topic-chat', topic: topicId }, 'start a chat for that topic');
  const startHomeChat = () => void switchChat({ type: 'home-chat' }, 'start a new chat');
  // The row's store goes with its id: another store may hold a session with the same one.
  const continueChat = (chat: Pick<SessionInfo, 'id' | 'source'>) =>
    void switchChat({ type: 'continue', id: chat.id, source: chat.source }, 'open that chat');
  const startProjectChat = (path: string, name = folderName(path)) =>
    switchChat({ type: 'project-chat', cwd: path }, `start a chat in ${name}`);
  // A new chat: no prompt yet, so where it starts can still be chosen.
  const newChat = !!session && session.turns.length === 0 && !inSetup;
  // "New worktree" on the project line: made when the first prompt is sent, not before.
  const [worktree, setWorktree] = useState(false);
  const wantsWorktree = useRef(false);
  wantsWorktree.current = worktree && newChat && isHome && conversation?.origin !== 'home';
  const [folder, setFolder] = useState<WebFolder>();
  useEffect(() => {
    setWorktree(false);
    setFolder(undefined);
    if (!newChat || !activeCwd || !token) return;
    let current = true;
    inspectFolder(activeCwd).then(
      (found) => current && setFolder(found),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [newChat, activeCwd, conversation?.id]);
  const convTopic = conversation?.topic?.name;
  const convTitle =
    conversation?.title ||
    (session?.turns.length ? firstLine(personText(session.turns[0]!.prompt)) : undefined) ||
    convTopic;
  root.classList.toggle('has-turns', !!session?.turns.length);
  // The Mac app draws the window's buttons over the page: the header leaves them room.
  root.classList.toggle('mac-app', '__TAURI_INTERNALS__' in window && /Mac/.test(navigator.platform));
  // `codexLive` and `codex` draw on one account.
  const account = session?.agent.replace(/Live$/, '');
  const plan = useMemo(() => allLimits.filter((limit) => limit.agent === account), [allLimits, account]);
  const chats = useChats(
    hasSessions,
    `${session?.sessionId ?? ''}:${conversation?.id ?? ''}:${session?.turns.length ?? 0}:${running}`,
  );
  // What the session's own runs reported wins; until then, what was last seen of the agent's plan.
  const rateLimits = session?.rateLimits?.length ? session.rateLimits : plan;
  // On a plan the measure is the plan's own: a price there would be an estimate nobody pays.
  const onPlan = rateLimits.some((limit) => limit.window !== 'quota');
  const usage = session ? formatUsage(session.usage, onPlan ? undefined : session.costUsd) : '';
  // A setting takes effect now: it does not wait behind a prompt whose files still upload.
  const control = (text: string) => void command({ type: 'submit', text });
  // Mode toggles wait behind any prompt whose attachments are still uploading, so an earlier
  // submitted prompt keeps the mode that was active when the user sent it.
  const orderedControl = (text: string): Promise<boolean> => {
    const mine = sending.then(() =>
      command({ type: 'submit', text }).then(
        () => true,
        () => true,
      ),
    );
    sending = mine;
    return mine;
  };
  // Why the last message did not leave, shown under the transcript until the next one does.
  const [unsent, setUnsent] = useState<{ problem: string; text: string }>();
  // The file or artifact open in the side viewer panel beside the chat.
  const [viewer, setViewer] = useState<ViewerTarget>();
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sessionArtifacts = useMemo(() => collectSessionArtifacts(session?.turns), [session?.turns]);
  const localImages = useLocalImages(session?.turns, view?.notices, !!config?.files, activeCwd);
  // Stable while the images are, so memoized Markdown does not re-render on every update.
  const imageUrl = useMemo(
    () => (config?.files ? imageResolver(localImages) : undefined),
    [config?.files, localImages],
  );

  // Close the viewer if the conversation was cleared and the open artifact no longer exists.
  useEffect(() => {
    if (viewer?.kind === 'artifact' && !sessionArtifacts.some((g) => g.id === viewer.id)) {
      setViewer(undefined);
    }
  }, [viewer, sessionArtifacts]);

  // Dismiss header popovers on outside click or Escape (the popover opened last, so it is asked before the viewer).
  useEffect(() => {
    if (!artifactsOpen && !settingsOpen) return;
    const close = () => {
      setArtifactsOpen(false);
      setSettingsOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if ((event.target as Element).closest?.('.popover-anchor')) return;
      close();
    };
    window.addEventListener('mousedown', onPointerDown, true);
    return () => window.removeEventListener('mousedown', onPointerDown, true);
  }, [artifactsOpen, settingsOpen]);
  useEscape(artifactsOpen || settingsOpen, () => {
    setArtifactsOpen(false);
    setSettingsOpen(false);
  });

  const revealFile = (path: string) => {
    void fetch('/api/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
      body: JSON.stringify({ path }),
    }).catch(() => undefined);
  };

  const openArtifactInPanel = (artifact: Artifact) => {
    const group = sessionArtifacts.find((g) => g.id === artifact.id);
    const followLatest = !group || artifact.version >= group.latest.version;
    setViewer({ kind: 'artifact', id: artifact.id, ...(followLatest ? {} : { version: artifact.version }) });
    setArtifactsOpen(false);
    setPanel('chat');
  };
  const submit = (text: string, files?: File[]): Promise<boolean> => {
    // Not sent, and the message field keeps it: the window is moving to another chat.
    if (switchingRef.current) return Promise.resolve(false);
    // A command of genaicode's own takes effect now, also while an earlier prompt's files upload.
    const own = parseSlash(text);
    if (own) {
      if (files?.length) {
        setUnsent({ problem: 'Not sent: files go with a prompt, not with a command.', text: text.trim() });
        return Promise.resolve(false);
      }
      if (own.kind === 'plan') return orderedControl(text);
      // Stopping or leaving the conversation drops what still waits here, as the buttons do.
      if (['stop', 'new', 'clear', 'continue', 'agent', 'quit'].includes(own.kind)) dropWaiting();
      return command({ type: 'submit', text }).then(
        () => true,
        () => true,
      );
    }
    const dropped = waiting.signal;
    // The first prompt of a chat that starts in a new worktree makes the worktree, then goes there.
    const copy = wantsWorktree.current ? activeCwd : undefined;
    if (copy) {
      wantsWorktree.current = false;
      setWorktree(false);
    }
    const mine = sending.then(async () => {
      if (copy) {
        if (dropped.aborted) return STOPPED;
        const made = await command({ type: 'project-chat', cwd: copy, worktree: true }).catch(() => false);
        if (!made) return 'Not sent: the new worktree could not be made.';
      }
      return sendPrompt(text, files ?? [], dropped);
    });
    sending = mine;
    return mine.then((problem) => {
      // With its words: the composer takes them back only while it is empty.
      setUnsent(problem ? { problem, text: text.trim() } : undefined);
      return !problem;
    });
  };

  const currentAgent = view?.agents.find((agent) => agent.name === session?.agent);
  const efforts = currentAgent?.effort ?? [];
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
          effort={session.effort}
          efforts={efforts}
          fallback={session.fallback ?? []}
          agents={agentList}
          noQuestions={new Set(view.agents.filter((agent) => agent.canAsk === false).map((agent) => agent.name))}
          running={running}
          onAgent={(name) => {
            // What still waits here was meant for the other agent.
            dropWaiting();
            void command({ type: 'agent', name });
          }}
          onModel={(model) => void command({ type: 'model', model })}
          onEffort={(level) => control(`/effort ${level}`)}
          onFallback={(names) => control(`/fallback ${names.length ? names.join(',') : 'off'}`)}
          onOpenSetup={hasAgentsApi ? openSetup : undefined}
        />
        <span className="grow" />
        {canPlan ? (
          <PlanToggle on={planOn} onToggle={(on) => void orderedControl(`/plan ${on ? 'on' : 'off'}`)} />
        ) : null}
        <PermissionSwitch auto={view.autoApprove} onChange={(auto) => control(`/auto ${auto ? 'on' : 'off'}`)} />
      </>
    ) : null;
  const stopTurn = () => {
    dropWaiting();
    void command({ type: 'stop' });
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
  // Needs you is one place: the tower's inbox where there is a tower, else the sessions that ask now.
  const openNeedsYou = () => {
    const page = needsYouPage({ tower: !!view?.tower, sessions: hasSessions });
    if (page === 'inbox') setPanel('inbox');
    else if (page === 'sessions') openSessions('needs');
    else backToChat();
  };
  const pageTitle =
    panel === 'sessions'
      ? needsOnly
        ? 'Needs you'
        : listed === 'own'
          ? 'All chats'
          : 'All sessions'
      : panel === 'inbox'
        ? 'Needs you'
        : panel === 'agents'
          ? 'Agents'
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
  const ownChats = useMemo(() => withOpenChat(chats.own, openChat), [chats.own, openChat]);
  const projects = useMemo(() => chatProjects(ownChats, isHome ? { home: cwd } : {}), [ownChats, isHome, cwd]);
  const openRow = openChat ? ownChats.find((chat) => isOpenChat(chat, openChat)) : undefined;
  const others = useMemo(() => (hasSessions ? otherSessions(chats.all, ownChats) : undefined), [chats.all, ownChats]);
  const needs = needsYou({
    approvals: session?.approvals.length ?? 0,
    tower: view?.tower?.items,
    sessions: chats.all,
    open: { id: session?.sessionId, source: openStore },
  });
  // One row per agent: for the chat's own agent, what its runs here reported wins over what was last seen.
  const quota = useMemo(
    () =>
      session
        ? quotaRows(
            [
              ...allLimits.filter((limit) => limit.agent.replace(/Live$/, '') !== account),
              ...rateLimits.map((limit) => ({ ...limit, agent: session.agent })),
            ],
            [session.agent],
          )
        : [],
    [allLimits, rateLimits, session?.agent, account],
  );
  const settingsItems = [
    ...(hasAgentsApi ? [{ label: 'Agents', onSelect: () => openSetup() }] : []),
    ...(config?.projectTeams ? [{ label: 'Project team', onSelect: () => setShowTeam(true) }] : []),
    ...(config?.canConfigureCdn
      ? [
          {
            label: 'HTML artifact CDNs',
            ...(config.artifactCdn?.length ? { detail: String(config.artifactCdn.length) } : {}),
            onSelect: () => {
              setArtifactsOpen(false);
              setSettingsOpen(true);
            },
          },
        ]
      : []),
  ];

  return (
    <>
      <Shell
        title={pageTitle ?? convTitle ?? 'New chat'}
        subtitle={!pageTitle && convTopic && convTopic !== convTitle ? convTopic : undefined}
        project={
          !pageTitle && activeCwd && (hasProject || (isHome && conversation && conversation.origin !== 'home'))
            ? { name: folderName(activeCwd), path: activeCwd }
            : undefined
        }
        onBack={panel === 'chat' ? undefined : backToChat}
        usage={!pageTitle && usage ? usage : undefined}
        actions={
          view && session && panel === 'chat' ? (
            <>
              {sessionArtifacts.length ? (
                <div className="popover-anchor" data-tauri-drag-region="false">
                  <button
                    className="btn ghost sm"
                    aria-expanded={artifactsOpen}
                    aria-pressed={artifactsOpen}
                    title="Artifacts published in this conversation"
                    onClick={() => {
                      setSettingsOpen(false);
                      setArtifactsOpen((v) => !v);
                    }}
                  >
                    Artifacts · {sessionArtifacts.length}
                  </button>
                  {artifactsOpen ? (
                    <div className="popover artifacts-popover" role="menu" aria-label="Session artifacts">
                      {sessionArtifacts.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          role="menuitem"
                          className={`artifact-list-item${viewer?.kind === 'artifact' && viewer.id === group.id ? ' active' : ''}`}
                          onClick={() => openArtifactInPanel(group.latest)}
                        >
                          <span className="artifact-list-icon" aria-hidden="true">
                            ◆
                          </span>
                          <span className="artifact-list-title">{group.latest.title}</span>
                          <small className="artifact-list-meta">
                            {artifactKindLabel(group.latest)} · {formatBytes(group.latest.bytes)}
                            {group.latest.version > 1 ? ` · v${group.latest.version}` : ''}
                          </small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
                                setShowTeam(true);
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
            </>
          ) : null
        }
        side={{
          page:
            panel === 'chat'
              ? 'chat'
              : panel === 'agents'
                ? 'settings'
                : pageTitle === 'Needs you'
                  ? 'inbox'
                  : listed === 'own'
                    ? 'chats'
                    : 'sessions',
          onNewChat: startHomeChat,
          // The palette comes with a later step; ⌘K and the button are wired to this.
          onSearch: () => undefined,
          needs,
          onNeedsYou: openNeedsYou,
          onAllSessions: hasSessions ? () => openSessions('all') : undefined,
          onAllChats: hasSessions ? () => openSessions('own') : undefined,
          projects,
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
          canNewChatIn: (project) => isHome || project.key === cwd.replace(/(?!^)[\\/]+$/, ''),
          others,
          update: config?.update,
          relaunching,
          onRelaunch: () => {
            setRelaunching(true);
            fetch('/api/relaunch', { method: 'POST', headers: { 'x-genaicode-token': token } })
              .then((reply) => reply.ok || setRelaunching(false))
              .catch(() => setRelaunching(false));
          },
          quota,
          onQuota: hasAgentsApi ? () => openSetup() : undefined,
          settings: settingsItems,
          settingsPopover:
            settingsOpen && config?.canConfigureCdn ? (
              <div className="popover-anchor side-popover">
                <CdnSettingsPopover hosts={config.artifactCdn ?? []} onClose={() => setSettingsOpen(false)} />
              </div>
            ) : null,
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
        {showSessions ? (
          <Sessions
            key={listed}
            token={token}
            cwd={activeCwd}
            home={isHome}
            topic={topic}
            onAllTopics={() => setTopic(undefined)}
            initialState={needsOnly ? 'now' : undefined}
            own={listed === 'own'}
            initialDays={listed === 'own' ? 0 : undefined}
            onAllSessions={() => openSessions('all')}
            nativeSave={config?.nativeSave}
            onStatus={showToast}
            onNewTopicChat={isHome ? startTopicChat : undefined}
            // The chat says what happened, also when it could not.
            onContinue={continueChat}
          />
        ) : null}
        {panel === 'inbox' && view?.tower && (
          <TowerInboxPanel
            view={view.tower}
            connected={connected}
            decide={(id, decision) => command({ type: 'tower', id, decision })}
            asking={hasSessions ? { count: needs.sessions, onOpen: () => openSessions('needs') } : undefined}
          />
        )}
        {showAgents ? (
          <main className="agents-panel">
            <Onboarding
              agents={agentList}
              limits={allLimits}
              loading={loadingAgents}
              checking={checkingAgents}
              setup={inSetup}
              focusAgent={focusAgent}
              onCheckAgain={() => checkAgents({ env: true })}
              onSelectAgent={(name) => {
                dropWaiting();
                void command({ type: 'agent', name });
                setPanel('chat');
              }}
              onClose={() => setPanel('chat')}
            />
          </main>
        ) : null}
        <div className="workspace" style={panel !== 'chat' ? { display: 'none' } : undefined}>
          {/* Under a page the chat is hidden, and so is what is open in it: its Escape waits with it. */}
          <EscapeActive.Provider value={panel === 'chat'}>
            <AgentChat
              state={session}
              header={null}
              // The work in one line that opens on click: a long run of tool calls buries the answer.
              foldSteps
              autoFocus={!inSetup}
              disabled={!connected || inSetup || switching}
              placeholder={inSetup ? 'Connect an agent to start' : undefined}
              notices={view?.notices}
              artifactUrl={(artifact) => `/artifacts/${artifact.id}?v=${artifact.version}`}
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
                    worktree={worktree}
                    onWorktree={setWorktree}
                    onProject={(path) => startProjectChat(path)}
                    onHome={startHomeChat}
                    inspect={inspectFolder}
                    choose={config?.chooseFolder ? chooseFolder : undefined}
                  />
                ) : undefined
              }
              composerExtras={inSetup ? null : controls}
              attachments={config?.uploads && !inSetup ? ATTACH : undefined}
              onOpenFile={config?.files ? (path, position) => setViewer({ kind: 'file', path, position }) : undefined}
              onRevealFile={config?.reveal ? revealFile : undefined}
              renderPrompt={promptBubble}
              renderFailure={(turn) =>
                turn.result?.failure?.kind === 'auth' ? (
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
                if (!setupBanner && !unsentBox) return null;
                return (
                  <>
                    {setupBanner}
                    {unsentBox}
                  </>
                );
              }}
              onSend={submit}
              onStop={stopTurn}
              canStop={!!view?.shells}
              onApprove={(id, decision) => void command({ type: 'approve', id, decision })}
              onAnswer={(id, answers) => void command({ type: 'answer', id, answers })}
              onAutoApprove={view?.autoApprove ? undefined : () => control('/auto on')}
              onPackAction={async (turnId, id, action) => {
                const reply = await postCommand({ type: 'pack-task', turnId, id, action });
                if (!reply.ok) throw new Error(reply.error ?? 'The task action failed.');
                return reply.text ?? '';
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
                      setup={true}
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
            {viewer ? (
              <ViewerPanel
                target={viewer}
                token={token}
                artifacts={sessionArtifacts}
                canReveal={config?.reveal}
                onReveal={revealFile}
                onOpenFile={config?.files ? (path, position) => setViewer({ kind: 'file', path, position }) : undefined}
                imageUrl={imageUrl}
                onSelectArtifactVersion={(version) =>
                  setViewer((current) => (current?.kind === 'artifact' ? { ...current, version } : current))
                }
                onArtifactSubmit={
                  connected && !inSetup
                    ? (artifact, data) => void submit(artifactSubmission(artifact, data))
                    : undefined
                }
                onClose={() => setViewer(undefined)}
              />
            ) : null}
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
      {toast ? (
        <div className={`gc-toast${toast.error ? ' err' : ''}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      ) : null}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
