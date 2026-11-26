import type { AgentInspection } from '../../agents/status.js';

export interface AgentListProps {
  current: string;
  agents: readonly AgentInspection[];
  /** Agents that cannot ask clarifying questions (`AgentChoice.canAsk === false`). */
  noQuestions?: ReadonlySet<string>;
  /** No agent can be chosen now (a turn runs); the rows still say what each one is. */
  disabled?: boolean;
  onSelect(name: string): void;
  /** Opens the agents page on an agent to install, sign in or fix. Without it those rows have no button. */
  onOpenSetup?(focusAgent?: string): void;
}

function agentRowTitle(agent: AgentInspection): string {
  const version = agent.version ? ` · v${agent.version}` : '';
  if (!agent.installed) return `${agent.guide.title} — not installed`;
  if (agent.broken) return `${agent.guide.title} — ${agent.hint ?? 'needs reinstall'}`;
  if (agent.auth === 'signed-out') return `${agent.guide.title} — installed, not signed in${version}`;
  if (agent.auth === 'ready') {
    const plan = agent.plan ? ` (${agent.plan})` : '';
    return `${agent.guide.title} — signed in${plan}${version}`;
  }
  return `${agent.guide.title} — installed; sign-in is checked when you run it${version}`;
}

/**
 * The agents of the composer's agent chip popover:
 * - Installed & Ready / unknown agents are choosable.
 * - Signed-out or broken installed agents are greyed out with Sign in / Fix actions.
 * - Not-installed agents appear under "More agents" with Install.
 * - Offers "Connect another agent" at the bottom where the host has an agents page.
 */
export function AgentList({ current, agents, noQuestions, disabled, onSelect, onOpenSetup }: AgentListProps) {
  const installed = agents.filter((agent) => agent.installed);
  const missing = agents.filter((agent) => !agent.installed);
  return (
    <div className="agent-list">
      {installed.length ? (
        <div className="picker-section" role="radiogroup" aria-label="Agent">
          {installed.map((agent) => {
            const choosable = !agent.broken && agent.auth !== 'signed-out';
            const selected = agent.name === current;
            const title = agentRowTitle(agent);
            if (choosable) {
              return (
                <button
                  key={agent.name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="agent-opt"
                  title={title}
                  disabled={disabled && !selected}
                  onClick={() => onSelect(agent.name)}
                >
                  <span
                    className="picker-dot"
                    data-state={agent.auth === 'ready' ? 'ready' : 'installed'}
                    aria-hidden="true"
                  />
                  <span className="opt-name">{agent.guide.title}</span>
                  <small>
                    {agent.auth === 'ready' ? (agent.plan ?? 'Ready') : 'Installed'}
                    {noQuestions?.has(agent.name) ? ' · no questions' : ''}
                  </small>
                </button>
              );
            }
            return (
              <div key={agent.name} className="picker-row muted" role="none" title={title}>
                <span className="picker-dot" data-state={agent.broken ? 'broken' : 'signed-out'} aria-hidden="true" />
                <span className="opt-name">{agent.guide.title}</span>
                <small>{agent.broken ? 'Needs reinstall' : 'Not signed in'}</small>
                {onOpenSetup ? (
                  <button type="button" className="btn sm" onClick={() => onOpenSetup(agent.name)}>
                    {agent.broken ? 'Fix' : 'Sign in'}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {missing.length ? (
        <div className="picker-section">
          <div className="picker-heading">More agents</div>
          {missing.map((agent) => (
            <div key={agent.name} className="picker-row muted" role="none" title={agentRowTitle(agent)}>
              <span className="picker-dot" data-state="missing" aria-hidden="true" />
              <span className="opt-name">{agent.guide.title}</span>
              {onOpenSetup ? (
                <button type="button" className="btn sm" onClick={() => onOpenSetup(agent.name)}>
                  Install
                </button>
              ) : (
                <small>Not installed</small>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {onOpenSetup ? (
        <button type="button" className="agent-opt picker-connect" onClick={() => onOpenSetup()}>
          Connect another agent…
        </button>
      ) : null}
    </div>
  );
}
