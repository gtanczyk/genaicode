import { useState } from 'react';
import type { SessionState, SessionTurn } from '../../agents/session.js';
import type { Artifact } from '../../agents/types.js';
import { TurnStepEntries, turnFoldStretches, type AgentChatProps } from '../../react/agent-chat.js';
import { useEscape } from '../../react/escape.js';
import type { FilePosition } from '../../react/markdown.js';

export interface StepsPanelProps {
  turn: SessionTurn;
  stretch: number;
  cwd: string;
  pending: SessionState['approvals'];
  renderPrompt?: AgentChatProps['renderPrompt'];
  onOpenFile?(path: string, position?: FilePosition): void;
  imageUrl?: AgentChatProps['imageUrl'];
  artifactUrl?(artifact: Artifact): string | undefined;
  onOpenArtifact?(artifact: Artifact): void;
  back: { label: string; onBack(): void };
  expanded?: boolean;
  onExpand?(expanded: boolean): void;
}

/**
 * Side-panel viewer for a turn's folded steps: renders all tool calls, edits, answered approvals
 * and progress plans of one stretch through the transcript's own `TurnStepEntries` renderer.
 */
export function StepsPanel({
  turn,
  stretch,
  cwd,
  pending,
  renderPrompt,
  onOpenFile,
  imageUrl,
  artifactUrl,
  onOpenArtifact,
  back,
  expanded = false,
  onExpand,
}: StepsPanelProps) {
  const [onlyErrors, setOnlyErrors] = useState(false);

  useEscape(true, () => {
    if (expanded && onExpand) onExpand(false);
    else back.onBack();
  });

  const { stretchSteps } = turnFoldStretches(turn, pending, renderPrompt);
  const steps = stretchSteps[stretch] ?? [];
  const toolCount = steps.filter(([item]) => item.kind === 'tool').length;
  const errorCount = steps.filter(([item]) => item.kind === 'tool' && item.isError).length;
  const count = toolCount || steps.length;
  const shown = onlyErrors && errorCount > 0 ? steps.filter(([item]) => item.kind === 'tool' && item.isError) : steps;
  const speaker = turn.pack?.lead ?? turn.agent;
  const running = !turn.result;

  return (
    <section
      className="viewer-panel steps-panel"
      data-viewer-kind="steps"
      data-expanded={expanded ? 'true' : undefined}
      aria-label={`Steps for ${speaker}`}
    >
      <header>
        <button
          type="button"
          className="chip viewer-back"
          title={back.label === 'Close' ? 'Close (Esc)' : `Back to ${back.label} (Esc)`}
          onClick={back.onBack}
        >
          <span aria-hidden="true">‹</span>
          {back.label}
        </button>
        <span className="viewer-title">
          {running ? <span className="gc-spin" /> : null}
          {count} {count === 1 ? 'step' : 'steps'}
        </span>
        <small>{speaker}</small>
        <span className="spacer" />
        {errorCount > 0 ? (
          <button
            type="button"
            className="chip"
            aria-pressed={onlyErrors}
            onClick={() => setOnlyErrors((value) => !value)}
          >
            Errors ({errorCount})
          </button>
        ) : null}
        {onExpand ? (
          <button
            type="button"
            className="chip"
            aria-pressed={expanded}
            title={expanded ? 'Dock beside the chat (Esc)' : 'Expand over the chat'}
            onClick={() => onExpand(!expanded)}
          >
            {expanded ? 'Dock' : 'Expand'}
          </button>
        ) : null}
      </header>
      <div className="viewer-body steps-panel-body">
        {shown.length === 0 ? (
          <p className="steps-empty">No steps to show.</p>
        ) : (
          <TurnStepEntries
            turn={turn}
            entries={shown}
            cwd={cwd}
            pending={pending}
            renderPrompt={renderPrompt}
            onOpenFile={onOpenFile}
            imageUrl={imageUrl}
            artifactUrl={artifactUrl}
            onOpenArtifact={onOpenArtifact}
          />
        )}
      </div>
    </section>
  );
}
