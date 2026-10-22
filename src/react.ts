/**
 * `genaicode/react`: the genaicode chat as a React component, for hosts that run their own
 * `AgentSession` (from `genaicode/agents`) and stream its `SessionState` to the page.
 *
 * ```tsx
 * import { AgentChat } from 'genaicode/react';
 * import 'genaicode/react/styles.css';
 *
 * <AgentChat state={state} onSend={send} onStop={stop} onApprove={approve} />
 * ```
 *
 * React (18 or newer) comes from the host; genaicode does not install it.
 */
export { AgentChat } from './react/agent-chat.js';
export type { AgentChatProps, ChatNotice } from './react/agent-chat.js';
export { Markdown } from './react/markdown.js';
export { AppAgentChat, useAppAgent } from './react/app-agent-chat.js';
export type { AppAgentChatProps, AppAgentClient, AppAgentClientOptions } from './react/app-agent-chat.js';
export { APP_NOTE, PROMPT_MARKER, userText } from './app-agent/state.js';
export type {
  AppAction,
  AppActionStatus,
  AppAgentMode,
  AppAgentState,
  AppLink,
  TreeChanges,
} from './app-agent/state.js';
export {
  formatDuration,
  formatUsage,
  relativePath,
  shortId,
  toolLabel,
  toolSummary,
  turnFooter,
} from './react/format.js';
export type { SessionEntry, SessionState, SessionTurn } from './agents/session.js';
export type { ApprovalDecision, ApprovalRequest } from './agents/types.js';
export { useFollowScroll } from './react/follow-scroll.js';
export { installResizeHandle, storedSize } from './react/resize-handle.js';
export type { ResizeHandle, ResizeHandleOptions, StoredSize } from './react/resize-handle.js';
