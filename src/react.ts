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
export { AgentChat, artifactSubmission } from './react/agent-chat.js';
export type { AgentChatProps, ChatCompletion, ChatNotice } from './react/agent-chat.js';
export type { ChatSessionRelay } from './react/session-relay.js';
export { ArtifactPanel } from './react/artifact-panel.js';
export type { ArtifactPanelProps } from './react/artifact-panel.js';
export { matchesAccept } from './react/attachments.js';
export type { ChatAttachments } from './react/attachments.js';
export { formatFilePosition, Markdown, parseFileTarget, readFileLinkPosition } from './react/markdown.js';
export type { FilePosition, MarkdownProps } from './react/markdown.js';
export { AppAgentChat, useAppAgent } from './react/app-agent-chat.js';
export type { AppAgentChatProps, AppAgentClient, AppAgentClientOptions } from './react/app-agent-chat.js';
export { PageAgentChat, usePageAgent } from './react/page-agent-chat.js';
export type { PageAgentChatProps } from './react/page-agent-chat.js';
export type { PageAgent, PageAgentState, PageModelStatus } from './browser/page-agent.js';
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
  budgetStatus,
  formatDuration,
  formatResetIn,
  formatUsage,
  limitChips,
  relativePath,
  shortId,
  toolLabel,
  toolArgument,
  toolDiff,
  toolPath,
  toolSummary,
  turnFooter,
} from './react/format.js';
export type { BudgetRow, LimitChip, LimitLevel } from './react/format.js';
export type { InputDelivery, SessionEntry, SessionState, SessionTurn, TurnAttachment } from './agents/session.js';
export type { AgentBudget, ApprovalDecision, ApprovalRequest, RateLimit } from './agents/types.js';
export { WorkPanel } from './react/work-panel.js';
export type { WorkActionHandler, WorkPanelProps } from './react/work-panel.js';
export {
  readWorkView,
  WORK_CHAT_MIN,
  WORK_PANEL_DEFAULT,
  WORK_PANEL_MIN,
  workNeedsYou,
  workPanelLayout,
  workTasks,
  writeWorkView,
} from './react/work.js';
export type { PullRequestState, WorkGroup, WorkPanelView, WorkTask } from './react/work.js';
export { MissionStrip } from './react/mission-strip.js';
export type { MissionStripProps } from './react/mission-strip.js';
export type { PackActionHandler } from './react/pack-tasks.js';
export type { PackAction, PackPullRequest, PackTask } from './agents/pack.js';
export { useFollowScroll } from './react/follow-scroll.js';
export { installResizeHandle, storedSize } from './react/resize-handle.js';
export type { ResizeHandle, ResizeHandleOptions, StoredSize } from './react/resize-handle.js';
