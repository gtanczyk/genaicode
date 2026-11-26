import { useState } from 'react';
import type { SessionEntry, SessionState, SessionTurn } from '../../agents/session.js';
import { turnFoldStretches } from '../../react/agent-chat.js';
import { useEscape } from '../../react/escape.js';
import { relativePath, toolArgument, toolDiff, toolLabel, toolPath, type FileDiff } from '../../react/format.js';
import type { FilePosition } from '../../react/markdown.js';

export interface StepsPanelProps {
  turn: SessionTurn;
  stretch: number;
  cwd: string;
  pending: SessionState['approvals'];
  renderPrompt?: (text: string) => unknown;
  onOpenFile?(path: string, position?: FilePosition): void;
  back: { label: string; onBack(): void };
  expanded?: boolean;
  onExpand?(expanded: boolean): void;
}

/**
 * Side-panel viewer for a turn's folded steps: shows all tool calls, edits and progress notes
 * of one stretch in a dedicated scrollable pane instead of expanding inline inside the chat.
 */
export function StepsPanel({
  turn,
  stretch,
  cwd,
  pending,
  renderPrompt,
  onOpenFile,
  back,
  expanded = false,
  onExpand,
}: StepsPanelProps) {
  const [onlyErrors, setOnlyErrors] = useState(false);

  useEscape(true, () => {
    if (expanded && onExpand) onExpand(false);
    else back.onBack();
  });

  const { stretchSteps } = turnFoldStretches(turn, pending, renderPrompt as ((text: string) => never) | undefined);
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
          <div className="steps-list">
            {shown.map(([item, index]) => (
              <StepRow key={index} entry={item} cwd={cwd} onOpenFile={onOpenFile} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function StepRow({
  entry,
  cwd,
  onOpenFile,
}: {
  entry: SessionEntry;
  cwd: string;
  onOpenFile?(path: string, position?: FilePosition): void;
}) {
  if (entry.kind === 'tool') {
    const argument = toolArgument(entry.input, cwd);
    const diff = toolDiff(entry.input);
    const file = onOpenFile ? toolPath(entry.input) : undefined;
    const output = entry.output?.trim();
    return (
      <details className="gc-tool">
        <summary title={argument || undefined}>
          <span className={`gc-state${entry.done ? (entry.isError ? ' gc-err' : ' gc-ok') : ''}`}>
            {entry.done ? entry.isError ? '✗' : '✓' : <span className="gc-spin" />}
          </span>
          <span className="gc-tool-name">{toolLabel(entry.name)}</span>
          <span className="gc-tool-arg">{argument}</span>
          {diff ? <StepDiffStat diff={diff} /> : null}
        </summary>
        {file && onOpenFile ? (
          <button
            type="button"
            className="gc-open-file"
            data-gc-file={file}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile(file);
            }}
          >
            Open {relativePath(file, cwd)}
          </button>
        ) : null}
        {diff ? <StepDiffLines diff={diff} /> : null}
        {output ? <pre className={entry.isError ? 'gc-tool-err' : undefined}>{output}</pre> : null}
        {!output && !diff && !file ? (
          <span className="gc-tool-empty">{entry.done ? 'No output.' : 'Running…'}</span>
        ) : null}
      </details>
    );
  }
  if (entry.kind === 'files') {
    return (
      <div className="gc-files">
        <span>✎ Edited</span>
        {entry.paths.map((path) =>
          onOpenFile ? (
            <button key={path} type="button" className="gc-open-file" onClick={() => onOpenFile(path)}>
              {relativePath(path, cwd)}
            </button>
          ) : (
            <code key={path}>{relativePath(path, cwd)}</code>
          ),
        )}
      </div>
    );
  }
  if (entry.kind === 'progress') {
    return <div className="steps-note">{entry.message}</div>;
  }
  if (entry.kind === 'text') {
    return <div className="steps-note">{entry.text}</div>;
  }
  return null;
}

function StepDiffStat({ diff }: { diff: FileDiff }) {
  return (
    <span className="gc-diff-stat">
      {diff.added ? <span className="gc-add">+{diff.added}</span> : null}
      {diff.removed ? <span className="gc-del">−{diff.removed}</span> : null}
    </span>
  );
}

function StepDiffLines({ diff }: { diff: FileDiff }) {
  return (
    <div className="gc-diff" role="region" aria-label={diff.path ? `Diff for ${diff.path}` : 'Diff'}>
      {diff.lines.map((line, i) => (
        <div key={i} className={`gc-diff-${line.kind}`}>
          <span>{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
          {line.text || '\u00a0'}
        </div>
      ))}
    </div>
  );
}
