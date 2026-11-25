import type { AgentEvent } from './types.js';

/** What ends a reply that streams: its message, or the worker doing something else. */
const REPLY_ENDS = new Set<AgentEvent['type']>([
  'message',
  'tool-start',
  'tool-end',
  'file-change',
  'approval-request',
  'error',
  'failover',
]);

export function trackReply(reply: { seq: number; open: boolean }, event: AgentEvent): void {
  if ((event.type === 'text-delta' || event.type === 'message') && !reply.open) reply.seq += 1;
  if (event.type === 'text-delta') reply.open = true;
  else if (REPLY_ENDS.has(event.type)) reply.open = false;
}
