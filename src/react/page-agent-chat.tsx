import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { PageAgent, PageAgentState } from '../browser/page-agent.js';
import { AgentChat, type AgentChatProps } from './agent-chat.js';

/** The live state of a page agent (`createPageAgent` from `genaicode/browser`). */
export function usePageAgent(agent: PageAgent): PageAgentState {
  return useSyncExternalStore(agent.subscribe, agent.get, agent.get);
}

export interface PageAgentChatProps {
  /** From `createPageAgent()` in `genaicode/browser`. */
  agent: PageAgent;
  /** Shown while there are no turns and the model is ready. */
  emptyState?: ReactNode;
  /** Shown instead of `emptyState` where the browser has no built-in model. */
  unavailable?: ReactNode;
  placeholder?: string;
  /** Replaces the default header; see `AgentChatProps.header`. */
  header?: ReactNode;
  /** Extra content at the end of the default header, after the context chip and "New". */
  headerExtras?: ReactNode;
  hint?: ReactNode;
  /** Tool name as shown. Default: friendlier names for common tools. */
  formatToolName?: AgentChatProps['formatToolName'];
  /** Fold each turn's tool calls into one "N steps" line. Default true. */
  foldSteps?: boolean;
  autoFocus?: boolean;
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
  style?: CSSProperties;
}

/**
 * The chat for an assistant that runs in the page (`createPageAgent`): `<AgentChat>` wired to
 * the agent, plus what an on-device model needs: a note where the browser has no model, the
 * download with its progress, approval of `write` tools, and how full the context window is.
 */
export function PageAgentChat(props: PageAgentChatProps) {
  const { agent } = props;
  const state = usePageAgent(agent);
  const { model, context, session } = state;
  const missing = model.status === 'unavailable';
  const percent = context ? Math.min(100, Math.round((context.used / context.window) * 100)) : undefined;
  const running = session.status === 'running';

  const status =
    model.status === 'downloading' ? (
      <div className="gc-notice gc-page-model" role="status">
        Downloading the on-device model{model.progress !== undefined ? ` · ${Math.round(model.progress * 100)}%` : '…'}
        <progress max={1} value={model.progress ?? undefined} />
        <small>Once per browser. After that it works offline.</small>
      </div>
    ) : model.status === 'loading' ? (
      <div className="gc-notice gc-page-model" role="status">
        Loading the on-device model…
      </div>
    ) : null;

  const empty = missing ? (
    (props.unavailable ?? (
      <div className="gc-empty">
        <div className="gc-empty-title">This assistant needs a browser with a built-in AI model</div>
        <p>It runs on your device, in Chrome 148 or newer on a desktop computer. Nothing is sent to a server.</p>
      </div>
    ))
  ) : model.status === 'downloadable' && !session.turns.length ? (
    <div className="gc-empty">
      {props.emptyState}
      <p className="gc-page-download">
        The assistant runs on your device. Your browser downloads the model once (a few GB), then it works offline.
      </p>
      <button
        type="button"
        className="gc-btn gc-primary"
        onClick={() => {
          agent.prepare().catch(() => {});
        }}
      >
        Download the model
      </button>
    </div>
  ) : (
    props.emptyState
  );

  return (
    <AgentChat
      state={session}
      onSend={agent.send}
      onStop={agent.stop}
      onApprove={agent.approve}
      foldSteps={props.foldSteps ?? true}
      formatToolName={props.formatToolName}
      onArtifactSubmit={null}
      renderFooter={() => status}
      header={props.header}
      headerExtras={
        <>
          {percent !== undefined ? (
            <span
              className="gc-chip gc-limit"
              data-level={percent >= 90 ? 'exceeded' : percent >= 70 ? 'warning' : 'ok'}
              title="How full the on-device model's context window is. When it fills up, the oldest messages are forgotten."
            >
              context {percent}%
            </span>
          ) : null}
          <button
            type="button"
            className="gc-btn"
            disabled={running || !session.turns.length}
            onClick={agent.reset}
            title="New conversation"
          >
            New
          </button>
          {props.headerExtras}
        </>
      }
      emptyState={empty}
      placeholder={props.placeholder ?? (missing ? 'Not available in this browser' : `Ask ${session.agent}…`)}
      hint={props.hint}
      disabled={missing || model.status === 'checking'}
      autoFocus={props.autoFocus}
      theme={props.theme}
      className={['gc-page', props.className].filter(Boolean).join(' ')}
      style={props.style}
    />
  );
}
