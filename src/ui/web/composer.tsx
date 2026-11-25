import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentInspection } from '../../agents/status.js';
import { useEscape } from '../../react/escape.js';
import { SUBMIT, type SubmitAction } from '../../react/format.js';
import { folderName, HOME_FOLDER, type ChatProject, type QuotaRow } from '../sidebar.js';
import { AgentList } from './agent-picker.js';
import type { WebFolder } from './server.js';

/**
 * The controls of the composer's row (docs/design/desktop-layout.md, "Composer"): the agent chip
 * with its popover, Plan, the permission switch, and the project line of a new chat. They render
 * what they are given and report what the person does; the page owns the session.
 */

/**
 * A button of the composer that opens a panel above it. A click outside or Escape closes it, and
 * Escape puts the focus back on the button and goes no further: the panel claims the key while it
 * is open (`useEscape`), so the press does not also leave the page or stop a turn.
 */
function Popover({
  label,
  title,
  className,
  panelLabel,
  panelClassName,
  disabled,
  button,
  children,
}: {
  /** The accessible name of the button. */
  label: string;
  title?: string;
  className: string;
  panelLabel: string;
  panelClassName?: string;
  disabled?: boolean;
  button: ReactNode;
  /** The panel; called with a function that closes it. */
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);
  useEscape(open, () => {
    setOpen(false);
    trigger.current?.focus();
  });
  return (
    <span className="menu-anchor" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {button}
      </button>
      {open ? (
        <div className={`pop${panelClassName ? ` ${panelClassName}` : ''}`} role="dialog" aria-label={panelLabel}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </span>
  );
}

/** A text field that reports its value when left or on Enter, and only when it changed. */
function CommitField({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit(value: string): void;
  placeholder?: string;
  title?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState<string>();
  return (
    <input
      {...rest}
      className={rest.className ?? 'field'}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== undefined && draft.trim() !== value) onCommit(draft.trim());
        setDraft(undefined);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** The agent names of a typed fallback list: `codex, agy` or `codex agy`. */
export function fallbackNames(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

export interface AgentChipProps {
  agent: string;
  /** The model set for the next prompt; empty for the agent's default. */
  model?: string;
  /** The model the agent last ran, shown while none is set. */
  reportedModel?: string;
  effort?: string;
  /** The effort levels the agent takes, in its own words. Empty: no effort control. */
  efforts: readonly string[];
  /** The agents a turn moves to when this one runs out, in order. */
  fallback: readonly string[];
  agents: readonly AgentInspection[];
  /** Agents that cannot ask clarifying questions. */
  noQuestions?: ReadonlySet<string>;
  /** A turn runs: the agent cannot be changed until it ends. */
  running?: boolean;
  onAgent(name: string): void;
  onModel(model: string): void;
  /** `default` is the agent's own choice. */
  onEffort(level: string): void;
  /** An empty list turns failover off. */
  onFallback(names: string[]): void;
  /** Opens the agents page (install, sign in). Without it those rows have no action. */
  onOpenSetup?(focusAgent?: string): void;
}

/**
 * What the next prompt runs with, as one chip: the agent and its model. Its popover holds the
 * agent, the model, the effort and the fallback agents.
 */
export function AgentChip(props: AgentChipProps) {
  const model = props.model || props.reportedModel;
  const levels = ['default', ...props.efforts];
  return (
    <Popover
      label={`Agent: ${props.agent}${model ? `, model ${model}` : ''}`}
      title={`Agent, model, effort${props.effort ? ` (${props.effort})` : ''} and fallback for the next prompt`}
      className="btn ghost sm agent-chip"
      panelLabel="Agent, model, effort and fallback"
      panelClassName="agent-pop"
      button={
        <>
          <span className="av" aria-hidden="true">
            {props.agent.slice(0, 1).toUpperCase()}
          </span>
          <span className="agent-chip-name">{props.agent}</span>
          {model ? <span className="chip-long"> · {model}</span> : null}
        </>
      }
    >
      {(close) => (
        <>
          <AgentList
            current={props.agent}
            agents={props.agents}
            noQuestions={props.noQuestions}
            disabled={props.running}
            onSelect={(name) => {
              close();
              if (name !== props.agent) props.onAgent(name);
            }}
            onOpenSetup={
              props.onOpenSetup
                ? (focus) => {
                    close();
                    props.onOpenSetup?.(focus);
                  }
                : undefined
            }
          />
          {props.running ? <span className="note">The agent can be changed when this turn ends.</span> : null}
          <label>
            Model
            <CommitField
              value={props.model ?? ''}
              placeholder={
                props.reportedModel ? `default (last ran ${props.reportedModel})` : "empty for the agent's default"
              }
              title="The model id, from the next prompt"
              onCommit={props.onModel}
            />
          </label>
          {props.efforts.length ? (
            <div className="pop-field">
              <span id="composer-effort">Effort</span>
              <span className="seg" role="group" aria-labelledby="composer-effort">
                {levels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={(props.effort ?? 'default') === level}
                    onClick={() => props.onEffort(level)}
                  >
                    {level}
                  </button>
                ))}
              </span>
            </div>
          ) : null}
          <label>
            Fallback when it runs out
            <CommitField
              value={props.fallback.join(', ')}
              placeholder="none (e.g. codex, gemini)"
              title="Agents a turn moves to, in order, when this one is out of quota or not signed in"
              onCommit={(text) => props.onFallback(fallbackNames(text))}
            />
          </label>
        </>
      )}
    </Popover>
  );
}

/** Plan mode for the next prompts: the agent plans and asks without editing. */
export function PlanToggle({ on, onToggle }: { on: boolean; onToggle(on: boolean): void }) {
  return (
    <button
      type="button"
      className="btn ghost sm"
      aria-pressed={on}
      title={
        on
          ? 'Plan mode on: the agent plans and asks without editing. Click to leave it.'
          : 'Plan mode: from the next prompt, the agent plans and asks without editing'
      }
      onClick={() => onToggle(!on)}
    >
      Plan
    </button>
  );
}

/**
 * Ask first / Auto-approve all, for this chat: another chat starts from the configured default. In a
 * narrow composer only "Auto-approve all" shows, so pressing it again goes back to asking.
 */
export function PermissionSwitch({ auto, onChange }: { auto: boolean; onChange(auto: boolean): void }) {
  return (
    <span className="seg perm" role="group" aria-label="Permission requests in this chat">
      <button
        type="button"
        aria-pressed={!auto}
        title="The agent asks before commands and edits it needs permission for"
        onClick={() => onChange(false)}
      >
        Ask first
      </button>
      <button
        type="button"
        aria-pressed={auto}
        title={
          auto
            ? 'Every permission request in this chat is approved without asking. Click for Ask first.'
            : 'Approves every permission request for the rest of this chat'
        }
        onClick={() => onChange(!auto)}
      >
        Auto-approve all
      </button>
    </span>
  );
}

export interface StartsInProps {
  /** The directory the first prompt runs in. */
  cwd: string;
  /** The chat is in the home folder, for questions across projects. */
  atHome?: boolean;
  /** What is known of `cwd`: a repository or not, and its branch. */
  folder?: WebFolder;
  /** The directories worked in lately (the sidebar's projects), newest first. */
  projects: readonly ChatProject[];
  /** Another folder can be picked (`ui --home`). Without it the line only names the folder. */
  canChange?: boolean;
  /**
   * Records that the person chose now. A choice that is found only later (a typed path looked up,
   * the host's dialog answered) passes it to `onProject`, so another choice made meanwhile wins.
   */
  mark(): number;
  /**
   * Start in this directory, an absolute path, as chosen at `mark`. Resolves false when the chat
   * could not start there, undefined when another chat was asked for since.
   */
  onProject(path: string, mark: number): Promise<boolean | undefined>;
  onHome(): void;
  /**
   * The folder the chat starts in was picked again: a choice still under way (a typed path looked
   * up, the host's dialog, a chat asked for) is dropped, so it does not move the chat after all.
   */
  onStay(): void;
  /** Looks a typed path up; undefined when it is not one. */
  inspect(path: string): Promise<WebFolder | undefined>;
  /** The host's folder dialog, where it has one. Resolves undefined when nothing was chosen. */
  choose?(): Promise<WebFolder | undefined>;
}

/** Directories the project line offers at most. */
const MOST_RECENT = 6;

/**
 * The context line of a new chat: **Starts in** the folder (recent ones, a path, the host's
 * dialog, the home folder) and where the prompt will run.
 */
export function StartsIn(props: StartsInProps) {
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const name = props.atHome ? 'Home folder' : folderName(props.cwd);
  const branch = props.folder?.branch;
  const recent = props.projects.filter((project) => project.key !== HOME_FOLDER && project.path).slice(0, MOST_RECENT);
  const here = props.cwd.replace(/(?!^)[\\/]+$/, '');
  const label = (
    <>
      <FolderIcon />
      {name}
      {branch ? <span className="chip-long"> · {branch}</span> : null}
    </>
  );
  const open = async (close: () => void) => {
    const path = typed.trim();
    if (!path || busy) return;
    const mark = props.mark();
    setBusy(true);
    const found = await props.inspect(path).catch(() => undefined);
    // Another folder or chat was picked while this one was looked up: that choice stands.
    if (mark !== props.mark()) return setBusy(false);
    if (!found?.exists) {
      setBusy(false);
      return setProblem(found ? `No folder ${found.path}.` : 'Give the full path of a folder, or one from ~.');
    }
    const started = await props.onProject(found.path, mark).catch(() => false);
    setBusy(false);
    if (started === undefined) return;
    // The chat says why. A folder nobody worked in yet is opened with the host's dialog, where there is one.
    if (!started) {
      return setProblem(
        `Could not start in ${found.path}: a typed path opens only a folder one of your sessions worked in.${props.choose ? ' Choose… opens any folder.' : ''}`,
      );
    }
    setTyped('');
    setProblem(undefined);
    close();
  };
  return (
    <>
      <span>Starts in</span>
      {props.canChange ? (
        <Popover
          label={`Starts in ${name}${branch ? `, branch ${branch}` : ''}`}
          title={props.cwd}
          className="btn sm"
          panelLabel="Project"
          panelClassName="starts-pop"
          button={
            <>
              {label} <span aria-hidden="true">▾</span>
            </>
          }
        >
          {(close) => (
            <>
              <div role="radiogroup" aria-label="Project" className="starts-list">
                {!props.atHome && !recent.some((project) => project.path === here) ? (
                  <button
                    type="button"
                    className="agent-opt"
                    role="radio"
                    aria-checked="true"
                    onClick={() => {
                      close();
                      props.onStay();
                    }}
                  >
                    <FolderIcon />
                    <span className="opt-name">{name}</span>
                    <small>{props.cwd}</small>
                  </button>
                ) : null}
                {recent.map((project) => (
                  <button
                    key={project.key}
                    type="button"
                    className="agent-opt"
                    role="radio"
                    aria-checked={!props.atHome && project.path === here}
                    onClick={() => {
                      close();
                      if (props.atHome || project.path !== here) void props.onProject(project.path!, props.mark());
                      else props.onStay();
                    }}
                  >
                    <FolderIcon />
                    <span className="opt-name">{project.name}</span>
                    <small>{project.path}</small>
                  </button>
                ))}
                <button
                  type="button"
                  className="agent-opt"
                  role="radio"
                  aria-checked={!!props.atHome}
                  onClick={() => {
                    close();
                    if (!props.atHome) props.onHome();
                    else props.onStay();
                  }}
                >
                  <FolderIcon />
                  <span className="opt-name">Home folder</span>
                  <small>questions across projects</small>
                </button>
              </div>
              <label>
                Or another folder
                <span className="starts-path">
                  <input
                    className="field mono"
                    aria-label="Folder path"
                    placeholder="~/src/another-repo"
                    value={typed}
                    aria-invalid={problem ? true : undefined}
                    onChange={(event) => {
                      setTyped(event.target.value);
                      setProblem(undefined);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void open(close);
                    }}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={!typed.trim() || busy}
                    onClick={() => void open(close)}
                  >
                    Open
                  </button>
                  {props.choose ? (
                    <button
                      type="button"
                      className="btn"
                      title="Pick a folder with the system's dialog"
                      disabled={busy}
                      onClick={async () => {
                        const mark = props.mark();
                        setBusy(true);
                        const found = await props.choose!().catch(() => undefined);
                        setBusy(false);
                        // Another folder or chat was picked while the dialog was open: that choice stands.
                        if (!found?.exists || mark !== props.mark()) return;
                        close();
                        void props.onProject(found.path, mark);
                      }}
                    >
                      Choose…
                    </button>
                  ) : null}
                </span>
              </label>
              {problem ? (
                <span className="note err" role="alert">
                  {problem}
                </span>
              ) : null}
              <span className="note">A project is a directory. The chat is listed under it in the sidebar.</span>
            </>
          )}
        </Popover>
      ) : (
        <span className="starts-fixed" title={props.cwd}>
          {label}
        </span>
      )}
      <span className="starts-where" title={props.cwd}>
        {props.cwd}
      </span>
    </>
  );
}

function FolderIcon() {
  return (
    <svg className="i" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.5H13c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The share of a plan window used from which the composer names the agent. */
const QUOTA_HOT_PERCENT = 80;

/**
 * The line under the composer: what Enter does and the other keys on the left, and on the right
 * only the agents that used 80% or more of a plan window, or all of it (the sidebar lists every
 * agent's). By the share used: an agent may still call 91% `allowed`.
 */
export function ComposerHint({
  action,
  canStop,
  files,
  quota,
}: {
  action: SubmitAction;
  canStop?: boolean;
  /** Files can be attached: they send without text. */
  files?: boolean;
  quota: readonly QuotaRow[];
}) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const verb = { send: 'sends', steer: 'steers', queue: 'queues' }[action];
  const hot = quota.filter((row) => row.level === 'exceeded' || (row.percent ?? 0) >= QUOTA_HOT_PERCENT);
  return (
    <>
      <span title={SUBMIT[action].title}>
        Enter {verb} · Shift+Enter new line · / for commands
        {canStop ? ` · ${mac ? '⌘.' : 'Ctrl+.'} or Esc stops` : ''}
        {files ? ' · files send without text' : ''}
      </span>
      <span className="grow" />
      {hot.map((row) => (
        <span key={row.agent} className="hot" title={row.title}>
          {row.agent} {row.text}
        </span>
      ))}
    </>
  );
}
