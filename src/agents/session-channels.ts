import type { McpServer } from './types.js';

// Registry symbols: the CLI and bundled UI can load separate copies of these modules in one process.
// No Node imports here, so code bundled into the browser UI (failover) can tell the channels apart.
export const PROGRESS_CHANNEL = Symbol.for('genaicode.turnProgress');
export const QUESTION_CHANNEL = Symbol.for('genaicode.questionChannel');

/**
 * Whether `server` is a channel the session adds to a turn for a local MCP agent (progress,
 * `ask_user`): a remote agent or one without MCP gets none, whatever agent the turn started on.
 */
export function isSessionChannel(server: McpServer): boolean {
  const marks = server as Record<symbol, unknown>;
  return Boolean(marks[PROGRESS_CHANNEL] || marks[QUESTION_CHANNEL]);
}
