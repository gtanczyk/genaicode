import { useEffect, useRef, useState } from 'react';
import type { AgentInspection } from '../../agents/status.js';

export interface AgentPickerProps {
  current: string;
  agents: readonly AgentInspection[];
  /** Agents that cannot ask clarifying questions (`AgentChoice.canAsk === false`). */
  noQuestions?: ReadonlySet<string>;
  disabled?: boolean;
  onSelect(name: string): void;
  onOpenSetup(focusAgent?: string): void;
}

/**
 * Agent switcher popover in the composer bar:
 * - Installed & Ready / unknown agents are choosable.
 * - Signed-out or broken installed agents are greyed out with Sign in / Fix actions.
 * - Not-installed agents appear under "More agents" with Install.
 * - Always offers "Connect another agent" at the bottom.
 */
export function AgentPicker({ current, agents, noQuestions, disabled, onSelect, onOpenSetup }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const installed = agents.filter((agent) => agent.installed);
  const missing = agents.filter((agent) => !agent.installed);
  const active = agents.find((agent) => agent.name === current);

  return (
    <div className="agent-picker" ref={rootRef}>
      <button
        type="button"
        className="agent-trigger"
        aria-label="Agent"
        aria-haspopup="menu"
        aria-expanded={open}
        title="The agent the next prompt goes to"
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
      >
        <span
          className="picker-dot"
          data-state={
            active?.broken
              ? 'broken'
              : active?.auth === 'ready'
                ? 'ready'
                : active?.auth === 'signed-out'
                  ? 'signed-out'
                  : 'installed'
          }
          aria-hidden="true"
        />
        <span>{current}</span>
        <span className="picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="picker-menu" role="menu" aria-label="Choose an agent">
          {installed.length ? (
            <div className="picker-section">
              {installed.map((agent) => {
                const choosable = !agent.broken && agent.auth !== 'signed-out';
                const selected = agent.name === current;
                if (choosable) {
                  return (
                    <button
                      key={agent.name}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`picker-item${selected ? ' selected' : ''}`}
                      onClick={() => {
                        setOpen(false);
                        onSelect(agent.name);
                      }}
                    >
                      <span
                        className="picker-dot"
                        data-state={agent.auth === 'ready' ? 'ready' : 'installed'}
                        aria-hidden="true"
                      />
                      <span className="picker-name">{agent.guide.title}</span>
                      <span className="picker-sub">
                        {agent.auth === 'ready' ? (agent.plan ?? 'Ready') : 'Installed'}
                        {noQuestions?.has(agent.name) ? ' · no questions' : ''}
                      </span>
                      {selected ? (
                        <span className="picker-check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                }
                return (
                  <div key={agent.name} className="picker-row muted" role="none">
                    <span
                      className="picker-dot"
                      data-state={agent.broken ? 'broken' : 'signed-out'}
                      aria-hidden="true"
                    />
                    <span className="picker-name">{agent.guide.title}</span>
                    <span className="picker-sub">{agent.broken ? 'Needs reinstall' : 'Not signed in'}</span>
                    <button
                      type="button"
                      role="menuitem"
                      className="picker-action"
                      onClick={() => {
                        setOpen(false);
                        onOpenSetup(agent.name);
                      }}
                    >
                      {agent.broken ? 'Fix' : 'Sign in'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {missing.length ? (
            <div className="picker-section">
              <div className="picker-heading">More agents</div>
              {missing.map((agent) => (
                <div key={agent.name} className="picker-row muted" role="none">
                  <span className="picker-dot" data-state="missing" aria-hidden="true" />
                  <span className="picker-name">{agent.guide.title}</span>
                  <button
                    type="button"
                    role="menuitem"
                    className="picker-action"
                    onClick={() => {
                      setOpen(false);
                      onOpenSetup(agent.name);
                    }}
                  >
                    Install
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="picker-footer">
            <button
              type="button"
              role="menuitem"
              className="picker-connect"
              onClick={() => {
                setOpen(false);
                onOpenSetup();
              }}
            >
              Connect another agent…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
