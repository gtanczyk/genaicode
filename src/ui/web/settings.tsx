import { chatFetch } from './chat-route.js';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_ARTIFACT_CDN_HOSTS } from '../../agents/cdn.js';
import type { ProjectTeam } from '../../agents/pack-profile.js';
import type { AgentToolsListing } from '../agent-tools.js';
import type { AgentShares } from '../../agents/sessions/shares.js';
import type { AgentInspection } from '../../agents/status.js';
import type { RateLimit } from '../../agents/types.js';
import { limitChips } from '../../react/format.js';
import { BUG_REPORT_URL, SUPPORT_URL } from '../../support.js';
import { agentCardState, CARD_STATE_LABEL, CopyCommand, type AgentCardState } from './onboarding.js';
import { holdsTypedText } from './shell.js';
import { Icon, StateGlyph, TERMS_URL } from './sidebar.js';
import type { ThemeChoice } from './theme.js';

/** The sections of the Settings page, in the order of its navigation. */
export const SETTINGS_SECTIONS = ['general', 'agents', 'team', 'artifacts', 'usage', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SECTION_LABEL: Record<SettingsSection, string> = {
  general: 'General',
  agents: 'Agents',
  team: 'Team',
  artifacts: 'Artifacts',
  usage: 'Usage',
  about: 'About and updates',
};

const SECTION_ICON = {
  general: 'gear',
  agents: 'spark',
  team: 'users',
  artifacts: 'doc',
  usage: 'layers',
  about: 'help',
} as const;

/** An on/off setting: a switch that says its state to assistive technology. */
function Switch({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

function Row({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set">
      <span className="grow">
        <b>{title}</b>
        {note ? <small>{note}</small> : null}
      </span>
      {children}
    </div>
  );
}

export interface GeneralSectionProps {
  maxChats?: number;
  onMaxChats?(limit: number): void;
  theme: ThemeChoice;
  onTheme(theme: ThemeChoice): void;
  /** Whether the wolf barks (`/bark`). Absent until the page is connected. */
  bark?: boolean;
  onBark?(on: boolean): void;
}

const THEMES: ReadonlyArray<[ThemeChoice, string]> = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/*
 * Two rows of the design are not here yet. "Open the work panel when work starts" comes with the
 * work panel (step 5), which is where that choice is kept. "Auto-approve all by default" needs a
 * default the server keeps between launches: today auto-approve is set per conversation (`/auto`)
 * or for a whole launch (`--yes`), and the composer's switch covers the first.
 */
export function GeneralSection({ theme, onTheme, bark, onBark, maxChats, onMaxChats }: GeneralSectionProps) {
  return (
    <>
      <h3>General</h3>
      <p>How the window looks and behaves.</p>
      <div className="card">
        <Row title="Theme" note="Follows the system unless you choose.">
          <span className="seg" role="group" aria-label="Theme">
            {THEMES.map(([value, label]) => (
              <button type="button" key={value} aria-pressed={theme === value} onClick={() => onTheme(value)}>
                {label}
              </button>
            ))}
          </span>
        </Row>
        {maxChats && (
          <Row title="Chats running at once" note="Extra chats wait for a free slot.">
            <select
              aria-label="Chats running at once"
              value={maxChats}
              onChange={(event) => onMaxChats?.(Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Row>
        )}
        {bark !== undefined && onBark ? (
          <Row
            title="Bark when an agent needs you"
            note={
              <>
                A sound and a count in the title while the window is in the background (<code>/bark</code>).
              </>
            }
          >
            <Switch label="Bark when an agent needs you" on={bark} onChange={onBark} />
          </Row>
        ) : null}
      </div>
    </>
  );
}

export interface AgentsSectionProps {
  agents: readonly AgentInspection[];
  /** True while the first check after the page opened still runs. */
  loading: boolean;
  /** True while Check again runs. */
  checking: boolean;
  /** The agent of the open chat. */
  current?: string;
  /** The agent to scroll to (opened from the agent picker or a sign-in card). */
  focusAgent?: string;
  onCheckAgain(): Promise<AgentInspection[] | undefined>;
  /** Makes the agent the one of the open chat. Absent: no Use button. */
  onUse?(name: string): void;
  /** The window is moving to another chat: Use waits, as it would reach the chat being left. */
  holding?: boolean;
  /** The page's token, where the server offers the session tools to the agents (`/api/agent-tools`). */
  agentTools?: { token: string };
}

const STATE_GLYPH: Record<AgentCardState, 'ok' | 'ask' | 'err' | 'idle'> = {
  ready: 'ok',
  installed: 'ok',
  'signed-out': 'ask',
  broken: 'err',
  missing: 'idle',
  checking: 'idle',
};

/** How many agents are installed and cannot run as they are: signed out, or broken. */
export function agentsNeedingYou(agents: readonly AgentInspection[]): number {
  return agents.filter((agent) => ['signed-out', 'broken'].includes(agentCardState(agent))).length;
}

export function AgentsSection({
  agents,
  loading,
  checking,
  current,
  focusAgent,
  onCheckAgain,
  onUse,
  holding,
  agentTools,
}: AgentsSectionProps) {
  const [note, setNote] = useState<string>();
  const focused = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusAgent) focused.current?.scrollIntoView?.({ block: 'center' });
  }, [focusAgent]);
  const check = async () => {
    setNote(undefined);
    if (!(await onCheckAgain())) setNote('Could not reach genaicode to check agents.');
  };
  return (
    <>
      <h3>Agents</h3>
      <p>The coding agent CLIs on this machine. Install or sign in from Terminal, then check again.</p>
      <div className="card">
        {agents.map((agent) => {
          const { guide } = agent;
          const state = agentCardState(agent, loading);
          const usable = state === 'ready' || state === 'installed';
          const facts = [
            CARD_STATE_LABEL[state],
            agent.version,
            usable && agent.plan ? `${agent.plan} plan` : undefined,
            usable ? agent.path : undefined,
          ].filter(Boolean);
          const commands =
            state === 'missing' || state === 'broken'
              ? guide.install
              : state === 'signed-out' && guide.loginCommand
                ? [guide.loginCommand]
                : [];
          const what = state === 'signed-out' ? `sign in to ${guide.title}` : `install ${guide.title}`;
          return (
            <div
              key={agent.name}
              ref={focusAgent === agent.name ? focused : undefined}
              className={`set col agent-row${focusAgent === agent.name ? ' focused' : ''}`}
              data-agent={agent.name}
              data-state={state}
            >
              <div className="agent-line">
                <StateGlyph state={STATE_GLYPH[state]} decorative />
                <span className="grow">
                  <b>{guide.title}</b>
                  <small>{facts.join(' · ')}</small>
                </span>
                {agent.name === current ? (
                  <span className="pill ok">In use</span>
                ) : usable && onUse ? (
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`Use ${guide.title}`}
                    disabled={holding}
                    onClick={() => onUse(agent.name)}
                  >
                    Use
                  </button>
                ) : state === 'signed-out' ? (
                  <span className="pill warn">Sign in</span>
                ) : state === 'broken' ? (
                  <span className="pill err">Reinstall</span>
                ) : null}
              </div>
              {state === 'signed-out' && guide.loginNote ? <small>{guide.loginNote}</small> : null}
              {agent.hint ? <small className={state === 'broken' ? 'problem' : undefined}>{agent.hint}</small> : null}
              {commands.map((command) => (
                <CopyCommand key={command} command={command} label={what} />
              ))}
              {(state === 'missing' || state === 'broken') && guide.docsUrl ? (
                <small>
                  {commands.length ? 'Install guide: ' : 'Install from the vendor, then check again: '}
                  <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer">
                    {guide.docsUrl}
                  </a>
                </small>
              ) : null}
            </div>
          );
        })}
        {agents.length ? null : (
          <div className="set">
            <small>{loading ? 'Checking…' : 'No supported agent is known to this page.'}</small>
          </div>
        )}
      </div>
      <div className="set-actions">
        <button type="button" className="btn" disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {note ? <span role="status">{note}</span> : null}
      </div>
      {agentTools ? <AgentToolsCard token={agentTools.token} agents={agents} /> : null}
    </>
  );
}

/**
 * The session index as an MCP server of each agent found here (`genaicode mcp install`): their own
 * chats then answer "what waits for me?" too. Nothing is added until the person clicks Add.
 */
export function AgentToolsCard({ token, agents }: { token: string; agents: readonly AgentInspection[] }) {
  const [listing, setListing] = useState<AgentToolsListing>();
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState('');
  const call = async (init?: RequestInit) => {
    const response = await chatFetch('/api/agent-tools', {
      ...init,
      headers: { 'x-genaicode-token': token, ...(init?.body ? { 'content-type': 'application/json' } : {}) },
    });
    const data = (await response.json()) as AgentToolsListing & { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Could not reach genaicode.');
    return data;
  };
  useEffect(() => {
    let live = true;
    void call()
      .then((data) => live && setListing(data))
      .catch((error: Error) => live && setProblem(error.message));
    return () => {
      live = false;
    };
    // The token does not change while the page is open.
  }, [token]);
  const change = async (agent: string, add: boolean) => {
    setBusy(agent);
    setProblem('');
    try {
      setListing(await call({ method: 'POST', body: JSON.stringify({ agent, add }) }));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  };
  if (!listing && !problem) return null;
  const title = (name: string) => agents.find((agent) => agent.name === name)?.guide.title ?? name;
  return (
    <>
      <h3>Session tools in your agents</h3>
      <p>
        Lets Claude Code, Codex and the others answer from their own chats which sessions wait for you and what your
        other agents said. They get the read-only tools of this app's chat, as <code>genaicode mcp install</code> gives
        them.
      </p>
      <div className="card agent-tools">
        {listing && !listing.durable ? (
          <div className="set col">
            <small>
              This genaicode runs from a temporary place (npx's cache or an AppImage), so the agents could not start it
              later. Install the command, then add the tools from it:
            </small>
            <CopyCommand command="npx genaicode install && genaicode mcp install" label="install the command" />
          </div>
        ) : (
          listing?.agents.map((entry) => {
            const state = !entry.installed ? 'Not added' : entry.current ? 'Added' : 'Added by another genaicode';
            const label = !entry.installed ? 'Add' : entry.current ? 'Remove' : 'Update';
            return (
              <div key={entry.agent} className="set agent-line" data-agent={entry.agent}>
                <StateGlyph state={entry.installed && entry.current ? 'ok' : 'idle'} decorative />
                <span className="grow">
                  <b>{title(entry.agent)}</b>
                  <small>
                    {[state, entry.send ? 'with sessions_send' : undefined, entry.installed ? entry.file : undefined]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <button
                  type="button"
                  className="btn sm"
                  aria-label={`${label} session tools in ${title(entry.agent)}`}
                  disabled={busy !== undefined}
                  onClick={() => void change(entry.agent, label !== 'Remove')}
                >
                  {busy === entry.agent ? '…' : label}
                </button>
              </div>
            );
          })
        )}
        {listing?.durable && !listing.agents.length ? (
          <div className="set">
            <small>None of Claude Code, Codex, Gemini CLI, Copilot or Cursor is found here.</small>
          </div>
        ) : null}
      </div>
      {problem ? (
        <div className="set-actions">
          <span role="status">{problem}</span>
        </div>
      ) : null}
      <small>New sessions of an agent get the tools. Already open ones keep what they started with.</small>
    </>
  );
}

export interface TeamSectionProps {
  token: string;
  /**
   * The folder of the open chat, where it names a project. The team is that project's then, as
   * `/api/pack-profile` answers only for it: the folder is shown, not chosen. Absent: a folder is
   * typed, picked from recent ones or chosen.
   */
  cwd?: string;
  /** Folders of earlier sessions (`/api/sessions`) are offered as recent ones. */
  sessions: boolean;
  /** The host's folder dialog. Absent: no Choose… button. */
  choose?(): Promise<string | undefined>;
}

/** The lead and workers saved for one project (`.genaicode/pack.json`), at `/api/pack-profile`. */
export function TeamSection({ token, cwd, sessions, choose }: TeamSectionProps) {
  const id = useId();
  const [folder, setFolder] = useState(cwd ?? '');
  const [directory, setDirectory] = useState<string | undefined>(cwd);
  const [folders, setFolders] = useState<string[]>([]);
  const [profile, setProfile] = useState<ProjectTeam>();
  const [lead, setLead] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState(false);
  const url = (project: string) => '/api/pack-profile?project=' + encodeURIComponent(project);

  const fixed = cwd !== undefined;

  useEffect(() => {
    if (!sessions || fixed) return;
    const controller = new AbortController();
    void chatFetch('/api/sessions', { headers: { 'x-genaicode-token': token }, signal: controller.signal })
      .then((res) => res.json())
      .then((result: { sessions?: { cwd?: string }[] }) => {
        setFolders([...new Set(result.sessions?.flatMap((s) => (s.cwd ? [s.cwd] : [])) ?? [])].sort());
      })
      .catch(() => {});
    return () => controller.abort();
  }, [sessions, fixed, token]);

  useEffect(() => {
    if (!directory) return;
    const controller = new AbortController();
    setProfile(undefined);
    setBusy(true);
    setSaved(false);
    setProblem('');
    void (async () => {
      try {
        const response = await chatFetch(url(directory), {
          headers: { 'x-genaicode-token': token },
          signal: controller.signal,
        });
        const data = (await response.json()) as ProjectTeam & { error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Could not read the project team.');
        if (controller.signal.aborted) return;
        const choices = data.choices.filter((c) => c.installed);
        setProfile(data);
        setLead(
          choices.find((c) => c.name === data.team?.lead && c.canLead)?.name ??
            choices.find((c) => c.canLead)?.name ??
            '',
        );
        setMembers(data.team?.members.filter((name) => choices.some((c) => c.name === name)) ?? []);
        setProblem(data.problem ?? '');
      } catch (error) {
        if (!controller.signal.aborted)
          setProblem(error instanceof Error ? error.message : 'Could not open the project.');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [directory, token]);

  const edit = (value: string) => {
    setFolder(value);
    setDirectory(undefined);
    setProfile(undefined);
    setSaved(false);
    setProblem('');
  };
  const save = async () => {
    if (!profile || !directory) return;
    setBusy(true);
    setSaved(false);
    setProblem('');
    try {
      const response = await chatFetch(url(directory), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ lead, members }),
      });
      if (!response.ok)
        throw new Error(((await response.json()) as { error?: string }).error ?? 'Could not save the team.');
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save the team.');
    } finally {
      setBusy(false);
    }
  };
  const installed = profile?.choices.filter((c) => c.installed) ?? [];

  return (
    <>
      <h3>Team</h3>
      <p>
        Who leads and who takes delegated tasks in one project (a directory). Saved in that directory’s{' '}
        <code>.genaicode/pack.json</code>.
      </p>
      <div className="card">
        {fixed ? (
          <Row title="Project folder" note="The folder of this chat.">
            <span className="mono" aria-label="Project folder">
              {profile?.project ?? cwd}
            </span>
          </Row>
        ) : (
          <form
            className="set col"
            onSubmit={(event) => {
              event.preventDefault();
              if (folder.trim()) setDirectory(folder.trim());
            }}
          >
            <span>
              <b>Project folder</b>
              <small>
                {choose ? 'Type a path, pick a recent one, or choose a folder.' : 'Type a path or pick a recent one.'}
              </small>
            </span>
            <div className="set-line">
              <input
                className="field mono grow"
                aria-label="Project folder"
                list={`${id}-folders`}
                placeholder="/path/to/project"
                value={folder}
                disabled={busy}
                onChange={(event) => edit(event.target.value)}
              />
              <datalist id={`${id}-folders`}>
                {folders.map((dir) => (
                  <option key={dir} value={dir} />
                ))}
              </datalist>
              <button className="btn" disabled={busy || !folder.trim() || folder.trim() === directory}>
                Open
              </button>
              {choose ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void choose().then(
                      (path) => {
                        if (!path) return;
                        setFolder(path);
                        setDirectory(path);
                      },
                      () => undefined,
                    )
                  }
                >
                  Choose…
                </button>
              ) : null}
            </div>
            {profile && profile.project !== folder.trim() ? <small className="mono">{profile.project}</small> : null}
          </form>
        )}
        {profile ? (
          <>
            <Row title="Lead" note="Plans the work, delegates and merges.">
              <select
                className="field"
                aria-label="Lead"
                disabled={busy}
                value={lead}
                onChange={(event) => {
                  setLead(event.target.value);
                  setSaved(false);
                }}
              >
                {installed
                  .filter((c) => c.canLead)
                  .map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
              </select>
            </Row>
            <div className="set col">
              <span>
                <b>Workers</b>
                <small>Installed agents the lead may delegate to.</small>
              </span>
              <fieldset className="checks" aria-label="Workers" disabled={busy}>
                {installed.map((c) => (
                  <label className="check" key={c.name}>
                    <input
                      type="checkbox"
                      checked={members.includes(c.name)}
                      onChange={(event) => {
                        setMembers(
                          event.target.checked ? [...members, c.name] : members.filter((name) => name !== c.name),
                        );
                        setSaved(false);
                      }}
                    />
                    {c.name}
                  </label>
                ))}
              </fieldset>
            </div>
          </>
        ) : null}
      </div>
      <div className="set-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy || !profile || !lead || !members.length}
          onClick={() => void save()}
        >
          Remember this team for the project
        </button>
        {problem ? (
          <span role="alert" className="problem">
            {problem}
          </span>
        ) : null}
        {saved ? <span role="status">Team saved in .genaicode/pack.json for the next project pack.</span> : null}
      </div>
    </>
  );
}

export interface ArtifactsSectionProps {
  token: string;
  /** The origins HTML artifacts may load libraries from now. */
  hosts: readonly string[];
}

const PRESET_CDN_ORIGINS = DEFAULT_ARTIFACT_CDN_HOSTS.map((host) => `https://${host}`);

/** What the switch and the field show for an allow-list: the preset only when all of it is allowed. */
export function cdnChoice(hosts: readonly string[]): { preset: boolean; custom: string } {
  const preset = PRESET_CDN_ORIGINS.every((origin) => hosts.includes(origin));
  const rest = preset ? hosts.filter((host) => !PRESET_CDN_ORIGINS.includes(host)) : hosts;
  return { preset, custom: rest.map((host) => host.replace(/^https:\/\//, '')).join('\n') };
}

/** The CDN allow-list of HTML artifacts, saved with `POST /api/settings`. */
export function ArtifactsSection({ token, hosts }: ArtifactsSectionProps) {
  const [preset, setPreset] = useState(() => cdnChoice(hosts).preset);
  const [custom, setCustom] = useState(() => cdnChoice(hosts).custom);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // The list changed elsewhere (the app's menu, another window): the form shows what holds now.
  const stamp = hosts.join('\n');
  const shown = useRef(stamp);
  useEffect(() => {
    if (shown.current === stamp) return;
    shown.current = stamp;
    const now = cdnChoice(hosts);
    setPreset(now.preset);
    setCustom(now.custom);
  }, [stamp]);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    setSaved(false);
    // A paste may separate hosts with spaces or tabs too.
    const extra = custom.split(/[\s,]+/).filter(Boolean);
    try {
      const res = await chatFetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ artifactCdn: [...(preset ? DEFAULT_ARTIFACT_CDN_HOSTS : []), ...extra] }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; artifactCdn?: string[] };
      if (!res.ok) setError(body.error ?? 'Could not save settings.');
      else {
        // The form shows what the server keeps now. The config broadcast of this save, before or
        // after this reply, carries the same list and leaves the form alone.
        if (body.artifactCdn) {
          shown.current = body.artifactCdn.join('\n');
          const now = cdnChoice(body.artifactCdn);
          setPreset(now.preset);
          setCustom(now.custom);
        }
        setSaved(true);
      }
    } catch {
      setError('Could not reach genaicode.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h3>Artifacts</h3>
      <p>HTML artifacts run in a sandbox with no network. You can let them load libraries from CDNs you trust.</p>
      <div className="card">
        <Row title="Allow common library CDNs" note={DEFAULT_ARTIFACT_CDN_HOSTS.join(', ')}>
          <Switch
            label="Allow common library CDNs"
            on={preset}
            disabled={saving}
            onChange={(on) => {
              setPreset(on);
              setSaved(false);
            }}
          />
        </Row>
        <div className="set col">
          <span>
            <b>Extra allowed hosts</b>
            <small>One per line, or separated by commas or spaces.</small>
          </span>
          <textarea
            className="field mono"
            rows={3}
            placeholder="e.g. cdn.skypack.dev"
            aria-label="Extra allowed hosts"
            value={custom}
            // Until the reply, what is sent is what the form shows.
            disabled={saving}
            onChange={(event) => {
              setCustom(event.target.value);
              setSaved(false);
            }}
          />
        </div>
      </div>
      <p className="set-note">
        Off by default. Allowed hosts can serve scripts, styles and fonts inside HTML artifacts; fetch, images and forms
        stay blocked. Loaded scripts run with the artifact’s data.
      </p>
      <div className="set-actions">
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {error ? (
          <span role="alert" className="problem">
            {error}
          </span>
        ) : null}
        {saved ? <span role="status">Settings saved.</span> : null}
      </div>
    </>
  );
}

export interface UsageSectionProps {
  token: string;
  /** The plan limits last seen of every agent (`/api/limits`). */
  limits: readonly (RateLimit & { agent: string })[];
  /** Whether the page has a session index: where the work went is read from it (`/api/shares`). */
  shares: boolean;
  /** Opens the sessions of a topic. */
  onTopic?(id: string): void;
  now?: number;
}

/**
 * The plan limits of every agent as the window knows them: for the open chat's agent (`agent`, with
 * the account it draws on), what its runs here reported (`own`) wins over what was last seen (`all`).
 * The sidebar and Settings › Usage show the same; without `/api/limits` only the chat's own are known.
 */
export function chatLimits(
  all: readonly (RateLimit & { agent: string })[],
  own: readonly RateLimit[],
  agent?: string,
): (RateLimit & { agent: string })[] {
  if (!agent) return [...all];
  const account = agent.replace(/Live$/, '');
  return [
    ...all.filter((limit) => limit.agent.replace(/Live$/, '') !== account),
    ...own.map((limit) => ({ ...limit, agent })),
  ];
}

/** A part smaller than this is not listed, and no more than this many parts are. */
const LEAST_SHARE = 0.05;
const MOST_SHARES = 4;

const PILL_LEVEL = { ok: 'ok', warning: 'warn', exceeded: 'err' } as const;

export function UsageSection({ token, limits, shares: readShares, onTopic, now = Date.now() }: UsageSectionProps) {
  const [shares, setShares] = useState<AgentShares[]>([]);
  useEffect(() => {
    if (!readShares) return;
    const controller = new AbortController();
    void chatFetch('/api/shares?days=7', { headers: { 'x-genaicode-token': token }, signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ shares?: AgentShares[] }>) : {}))
      .then((found: { shares?: AgentShares[] }) => setShares(found.shares ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [readShares, token]);
  const agents = [...new Set([...limits.map((limit) => limit.agent), ...shares.map((one) => one.agent)])].sort();
  return (
    <>
      <h3>Usage</h3>
      <p>
        Plan limits last seen for each agent
        {readShares ? ', and where its work went in the last 7 days (by topic)' : ''}.
      </p>
      <div className="card">
        {agents.map((agent) => {
          const chips = limitChips({ usage: {}, rateLimits: limits.filter((limit) => limit.agent === agent) }, now);
          const went = shares
            .find((one) => one.agent === agent)
            ?.shares.filter((part) => part.share >= LEAST_SHARE)
            .slice(0, MOST_SHARES);
          return (
            <div className="set col" key={agent} data-agent={agent}>
              <b className="usage-head">
                {agent}
                {chips.length ? (
                  chips.map((chip) => (
                    <span key={chip.key} className={`pill ${PILL_LEVEL[chip.level]}`} title={chip.title}>
                      {chip.text}
                    </span>
                  ))
                ) : (
                  <span className="pill">reports no plan limits</span>
                )}
              </b>
              {went?.length ? (
                <ul className="bars" aria-label={`Where ${agent}'s work went in the last 7 days`}>
                  {went.map((part) => {
                    const percent = Math.round(part.share * 100);
                    return (
                      <li className="bar" key={part.topic ?? part.name} title={`${part.sessions} sessions`}>
                        {part.topic && onTopic ? (
                          <button type="button" onClick={() => onTopic(part.topic!)}>
                            {part.name}
                          </button>
                        ) : (
                          <span>{part.name}</span>
                        )}
                        <span className="meter">
                          <i style={{ width: `${percent}%` }} />
                        </span>
                        <span>{percent}%</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
        {agents.length ? null : (
          <div className="set">
            <small>No agent has reported a plan limit yet. They show here after an agent’s first turn.</small>
          </div>
        )}
      </div>
    </>
  );
}

export interface AboutSectionProps {
  version?: string;
  /** A newer version of the app: downloading, or ready to install on a relaunch. */
  update?: { version: string; ready: boolean; installing?: boolean };
  relaunching?: boolean;
  onRelaunch?(): void;
  /** Opens the release notes bundled with this version. */
  onWhatsNew?(): void;
}

export function AboutSection({ version, update, relaunching, onRelaunch, onWhatsNew }: AboutSectionProps) {
  const installing = relaunching || update?.installing;
  return (
    <>
      <h3>About and updates</h3>
      <p>Genaicode{version ? ` ${version}` : ''}.</p>
      <div className="card">
        {update ? (
          <Row
            title={
              installing
                ? `Version ${update.version} is being installed`
                : update.ready
                  ? `Version ${update.version} is downloaded`
                  : `Version ${update.version} is downloading`
            }
            note={
              installing
                ? 'The app starts again in a moment.'
                : update.ready
                  ? 'Relaunching installs it and stops the agents this app runs.'
                  : 'Nothing installs before you choose it.'
            }
          >
            <button
              type="button"
              className="btn primary sm"
              disabled={!update.ready || installing || !onRelaunch}
              onClick={onRelaunch}
            >
              {installing ? 'Relaunching…' : 'Install and relaunch'}
            </button>
          </Row>
        ) : null}
        {onWhatsNew ? (
          <Row title={`What’s new${version ? ` in ${version}` : ''}`} note="Release notes bundled with this version.">
            <button type="button" className="btn sm" onClick={onWhatsNew}>
              Read
            </button>
          </Row>
        ) : null}
        <Row title="Help" note="Get help, report a bug, read the terms.">
          <a className="btn sm ghost" href={SUPPORT_URL} target="_blank" rel="noreferrer">
            Get help
          </a>
          <a className="btn sm ghost" href={BUG_REPORT_URL} target="_blank" rel="noreferrer">
            Report a bug
          </a>
          <a className="btn sm ghost" href={TERMS_URL} target="_blank" rel="noreferrer">
            Terms
          </a>
        </Row>
      </div>
    </>
  );
}

export interface SettingsPageProps {
  /** The section shown. One the page does not have falls back to General. */
  section: SettingsSection;
  onSection(section: SettingsSection): void;
  general: GeneralSectionProps;
  /** Absent where the page cannot inspect agents (`/api/agents`). */
  agents?: AgentsSectionProps;
  /** Absent where project teams are not served (`/api/pack-profile`). */
  team?: TeamSectionProps;
  /** Absent where the allow-list cannot be changed from the page. */
  artifacts?: ArtifactsSectionProps;
  /** Absent where no plan limit is served or reported and no session index is read. */
  usage?: UsageSectionProps;
  about: AboutSectionProps;
}

/** The sections this page has, in order: those whose data the server gives. */
export function settingsSections(props: {
  [Key in 'agents' | 'team' | 'artifacts' | 'usage']?: unknown;
}): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(
    (section) =>
      (section !== 'agents' || !!props.agents) &&
      (section !== 'team' || !!props.team) &&
      (section !== 'artifacts' || !!props.artifacts) &&
      (section !== 'usage' || !!props.usage),
  );
}

/**
 * The Settings page (docs/design/desktop-layout.md): it takes the chat's place, the sidebar stays,
 * and Escape or the back arrow of the top bar returns to the chat (from a field with text in it,
 * Escape leaves the field first). General, Agents, Team, Artifacts, Usage, About and updates.
 */
export function SettingsPage(props: SettingsPageProps) {
  const sections = settingsSections(props);
  const section = sections.includes(props.section) ? props.section : 'general';
  const waiting = props.agents ? agentsNeedingYou(props.agents.agents) : 0;
  return (
    <main
      className="settings-page"
      aria-label="Settings"
      onKeyDown={(event) => {
        // The window keeps a page open while Escape is pressed in a field with text in it, so what
        // was typed is not lost with the page. Here the press leaves the field: the next one goes back.
        if (event.key === 'Escape' && holdsTypedText(event.target)) event.target.blur();
      }}
    >
      <div className="pg">
        <div className="pg-h">
          <h2>Settings</h2>
        </div>
        <div className="settings">
          <nav aria-label="Settings sections">
            {sections.map((name) => (
              <button
                type="button"
                key={name}
                className="nav"
                aria-current={name === section ? 'true' : undefined}
                onClick={() => props.onSection(name)}
              >
                <Icon name={SECTION_ICON[name]} />
                <span className="grow">{SECTION_LABEL[name]}</span>
                {name === 'agents' && waiting ? (
                  <span className="count hot" title={`${waiting} installed, not usable yet`}>
                    {waiting}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
          <section className="sec" data-section={section} aria-label={SECTION_LABEL[section]}>
            {section === 'general' ? <GeneralSection {...props.general} /> : null}
            {section === 'agents' && props.agents ? <AgentsSection {...props.agents} /> : null}
            {/* Another chat's folder is another project: the section starts over with it. */}
            {section === 'team' && props.team ? <TeamSection key={props.team.cwd ?? ''} {...props.team} /> : null}
            {section === 'artifacts' && props.artifacts ? <ArtifactsSection {...props.artifacts} /> : null}
            {section === 'usage' && props.usage ? <UsageSection {...props.usage} /> : null}
            {section === 'about' ? <AboutSection {...props.about} /> : null}
          </section>
        </div>
      </div>
    </main>
  );
}
