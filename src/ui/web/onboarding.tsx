import { useEffect, useRef, useState } from 'react';
import { agentGuide } from '../../agents/drivers/catalog.js';
import type { AgentInspection } from '../../agents/status.js';
import type { RateLimit } from '../../agents/types.js';
import { limitChips } from '../../react/format.js';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand when Clipboard API is unavailable (e.g. non-secure context).
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="copy-row">
      <code title={label ?? command}>{command}</code>
      <button
        type="button"
        className="copy-btn"
        aria-label={label ? `Copy ${label}` : `Copy command: ${command}`}
        onClick={() => {
          void copyText(command).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function isUsable(agent: Pick<AgentInspection, 'installed' | 'broken' | 'auth'>): boolean {
  return agent.installed && !agent.broken && agent.auth !== 'signed-out';
}

export interface OnboardingProps {
  agents: readonly AgentInspection[];
  limits: readonly (RateLimit & { agent: string })[];
  /** True while the first async check on page load is still running. */
  loading: boolean;
  /** True while an explicit Check again is in flight. */
  checking: boolean;
  /** True when no usable agent is connected yet. */
  setup: boolean;
  /** Agent name to scroll to and highlight (when opened from the agent picker). */
  focusAgent?: string;
  onCheckAgain(): Promise<AgentInspection[] | undefined>;
  onSelectAgent?(name: string): void;
  onClose?(): void;
}

/**
 * Onboarding and agent-management view: one card per supported agent showing its local state
 * (Not installed, Installed not signed in, Ready, Installed, or Needs reinstall) with exact
 * copyable Terminal commands, vendor install link, plan limits, and Check again.
 */
export function Onboarding({
  agents,
  limits,
  loading,
  checking,
  setup,
  focusAgent,
  onCheckAgain,
  onSelectAgent,
  onClose,
}: OnboardingProps) {
  const [note, setNote] = useState<string>();
  const focusedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!focusAgent) return;
    focusedRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focusAgent]);

  const now = Date.now();
  const handleCheck = async () => {
    setNote(undefined);
    const updated = await onCheckAgain();
    if (!updated) {
      setNote('Could not reach genaicode to check agents.');
      return;
    }
    if (setup && !updated.some(isUsable)) {
      const signedOut = updated.filter((item) => item.installed && !item.broken && item.auth === 'signed-out');
      if (signedOut.length) {
        const names = signedOut.map((item) => item.guide.title).join(', ');
        setNote(`${names} is installed but not signed in yet. Finish signing in in Terminal, then click Check again.`);
      } else {
        setNote('Still no ready agent found. Finish installing one in Terminal, then click Check again.');
      }
    }
  };

  return (
    <section className="onboarding" aria-label="Connect a coding agent">
      {setup ? (
        <div className="onboarding-hero">
          <div className="wolf wolf-compact" role="img" aria-label="genaicode wolf" />
          <h1>Connect a coding agent</h1>
          <p>
            genaicode works through the coding-agent CLIs you already have — it brings no model of its own and never
            handles your credentials. Install one in Terminal, sign in, and click Check again.
          </p>
        </div>
      ) : (
        <div className="onboarding-head">
          <div>
            <h1>Coding agents</h1>
            <p>genaicode drives the agent CLIs installed on this machine using your own subscriptions or keys.</p>
          </div>
          {onClose ? (
            <button type="button" className="chip" onClick={onClose}>
              ← Chat
            </button>
          ) : null}
        </div>
      )}

      <div className="onboarding-actions">
        <button type="button" className="btn-primary" disabled={checking} onClick={() => void handleCheck()}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {note ? (
          <span className="onboarding-note" role="status">
            {note}
          </span>
        ) : null}
      </div>

      <ul className="agent-cards">
        {agents.map((agent) => {
          const { guide } = agent;
          const cardState =
            loading && agent.installed && !agent.version && agent.auth === 'unknown' && !agent.broken
              ? 'checking'
              : !agent.installed
                ? 'missing'
                : agent.broken
                  ? 'broken'
                  : agent.auth === 'signed-out'
                    ? 'signed-out'
                    : agent.auth === 'ready'
                      ? 'ready'
                      : 'installed';
          const statusLabel =
            cardState === 'checking'
              ? 'Checking…'
              : cardState === 'missing'
                ? 'Not installed'
                : cardState === 'broken'
                  ? 'Needs reinstall'
                  : cardState === 'signed-out'
                    ? 'Installed, not signed in'
                    : cardState === 'ready'
                      ? 'Ready'
                      : 'Installed';
          const account = agent.name.replace(/Live$/, '');
          const agentLimits = limits.filter((limit) => limit.agent === account);
          const chips = agentLimits.length ? limitChips({ usage: {}, rateLimits: agentLimits }, now) : [];
          const isFocused = focusAgent === agent.name;
          return (
            <li
              key={agent.name}
              ref={isFocused ? focusedRef : undefined}
              className={`agent-card${isFocused ? ' focused' : ''}`}
              data-agent={agent.name}
              data-state={cardState}
            >
              <div className="card-top">
                <div className="card-title">
                  <strong>{guide.title}</strong>
                  {guide.maker ? <span className="card-maker">{guide.maker}</span> : null}
                  <code className="card-cmd">{agent.command}</code>
                  {agent.version ? <span className="card-ver">v{agent.version}</span> : null}
                </div>
                <div className="card-badges">
                  {cardState === 'ready' && agent.plan ? <span className="plan-pill">{agent.plan}</span> : null}
                  <span className="status-pill" data-state={cardState}>
                    {statusLabel}
                  </span>
                </div>
              </div>
              <p className="card-summary">{guide.summary}</p>

              {cardState === 'missing' ? (
                <div className="card-step">
                  {guide.install.length ? (
                    <div className="step-commands">
                      <span className="step-label">Install in Terminal</span>
                      {guide.install.map((cmd) => (
                        <CopyCommand key={cmd} command={cmd} label={`install ${guide.title}`} />
                      ))}
                    </div>
                  ) : (
                    <div className="step-note">
                      Install from the vendor&apos;s website or app, then click Check again.
                    </div>
                  )}
                  {guide.docsUrl ? (
                    <div className="step-docs">
                      Install guide:{' '}
                      <a className="docs-link" href={guide.docsUrl} target="_blank" rel="noopener noreferrer">
                        {guide.docsUrl}
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {cardState === 'broken' ? (
                <div className="card-step">
                  {agent.hint ? <div className="step-error">{agent.hint}</div> : null}
                  {guide.install.length ? (
                    <div className="step-commands">
                      <span className="step-label">Reinstall in Terminal</span>
                      {guide.install.map((cmd) => (
                        <CopyCommand key={cmd} command={cmd} label={`reinstall ${guide.title}`} />
                      ))}
                    </div>
                  ) : null}
                  {guide.docsUrl ? (
                    <div className="step-docs">
                      Install guide:{' '}
                      <a className="docs-link" href={guide.docsUrl} target="_blank" rel="noopener noreferrer">
                        {guide.docsUrl}
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {cardState === 'signed-out' ? (
                <div className="card-step">
                  <div className="step-note">{guide.loginNote}</div>
                  {guide.loginCommand ? (
                    <CopyCommand command={guide.loginCommand} label={`sign in to ${guide.title}`} />
                  ) : null}
                  {agent.hint ? <div className="step-hint">{agent.hint}</div> : null}
                </div>
              ) : null}

              {cardState === 'ready' || cardState === 'installed' ? (
                <div className="card-step card-ready-row">
                  <div className="card-meta">
                    {chips.length ? (
                      <div className="card-limits">
                        {chips.map((chip) => (
                          <span key={chip.key} className="chip" data-level={chip.level} title={chip.title}>
                            {chip.text}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {agent.hint ? (
                      <div className="step-hint">
                        {agent.path ? `Using ${agent.path} · ` : ''}
                        {agent.hint}
                      </div>
                    ) : null}
                  </div>
                  {!setup && onSelectAgent ? (
                    <button type="button" className="btn-use" onClick={() => onSelectAgent(agent.name)}>
                      Use {guide.title}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface SignInCardProps {
  agent: string;
  inspection?: AgentInspection;
  /** Timestamp of the most recent `/api/agents` response. */
  inspectedAt?: number;
  /** Timestamp when the failed turn ended, so stale cached `ready` does not hide the card. */
  failedAt?: number;
  checking: boolean;
  onCheckAgain(): Promise<AgentInspection[] | undefined>;
  onRetry?(): void;
}

/**
 * Shown in the conversation when a turn fails with an auth error (`failure.kind === 'auth'`),
 * replacing raw CLI output with the agent's exact sign-in command and Check again.
 */
export function SignInCard({
  agent,
  inspection,
  inspectedAt = 0,
  failedAt = 0,
  checking,
  onCheckAgain,
  onRetry,
}: SignInCardProps) {
  const guide = inspection?.guide ?? agentGuide(agent);
  const [checkedStatus, setCheckedStatus] = useState<'ready' | 'signed-out' | 'unknown'>();
  const freshlyReady = inspection?.auth === 'ready' && inspectedAt > failedAt;
  const effectiveReady = checkedStatus === 'ready' || freshlyReady;

  const handleCheck = async () => {
    const updated = await onCheckAgain();
    const match = updated?.find((item) => item.name === agent);
    setCheckedStatus(match?.auth ?? 'unknown');
  };

  if (effectiveReady) {
    return (
      <div className="signin-card ready" role="region" aria-label={`${guide.title} ready`}>
        <div className="signin-head">
          <strong>{guide.title} is signed in</strong>
          <span className="status-pill" data-state="ready">
            Ready
          </span>
        </div>
        <div className="signin-actions">
          {onRetry ? (
            <button type="button" className="btn-primary" onClick={onRetry}>
              Retry prompt
            </button>
          ) : (
            <span className="step-note">You can send your message again now.</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="signin-card" role="region" aria-label={`Sign in to ${guide.title}`}>
      <div className="signin-head">
        <strong>{guide.title} is not signed in</strong>
        <span className="status-pill" data-state="signed-out">
          Sign in required
        </span>
      </div>
      <div className="step-note">{guide.loginNote}</div>
      {guide.loginCommand ? <CopyCommand command={guide.loginCommand} label={`sign in to ${guide.title}`} /> : null}
      <div className="signin-actions">
        <button type="button" className="btn-primary" disabled={checking} onClick={() => void handleCheck()}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {checkedStatus === 'unknown' && onRetry ? (
          <button type="button" className="btn-use" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        {checkedStatus === 'signed-out' ? (
          <span className="step-hint" role="status">
            Still not signed in. Finish signing in in Terminal, then click Check again.
          </span>
        ) : null}
      </div>
    </div>
  );
}
