import { randomUUID } from 'node:crypto';
import { startScopedLocalMcpServer } from './mcp-server.js';
import type { McpTool } from './mcp-tools.js';
import type { McpServer } from './types.js';

export interface ProgressStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ProgressReport {
  message: string;
  /** Omit to keep the last plan or send an empty list to clear it. */
  plan?: ProgressStep[];
}

export interface ProgressChannel {
  openTurn(
    report: (progress: ProgressReport) => void,
    signal: AbortSignal,
    name?: string,
  ): {
    mcpServer: McpServer;
    close(): void;
  };
  close(): Promise<void>;
}

export const PROGRESS_SERVER_NAME = 'genaicode_progress';
// The CLI and bundled UI can load separate copies of this module in the same process.
const PROGRESS_CHANNEL = Symbol.for('genaicode.turnProgress');
const MAX_MESSAGE = 1000;
const MAX_STEPS = 12;
const MAX_STEP = 200;

/** A worker must not publish on its lead's turn. */
export function isTurnProgressServer(server: McpServer): boolean {
  return (server as Record<symbol, unknown>)[PROGRESS_CHANNEL] === true;
}

/** Mark `server` as a turn's progress channel, so pack keeps it from workers and failover from remote agents. */
export function markTurnProgressServer<T extends McpServer>(server: T): T {
  return Object.assign({ ...server }, { [PROGRESS_CHANNEL]: true as const });
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${field} must be nonempty text of at most ${max} characters.`);
  return value.trim();
}

function progressTool(report: (progress: ProgressReport) => void): McpTool {
  return {
    name: 'report_progress',
    description:
      'Show the user a brief progress update in the chat, in their language. For multi-step work, give the plan ' +
      'when you start and update it at milestones, changes of direction or blockers. Omit plan to keep it, ' +
      'or send the complete revised list. Give the final answer in chat.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE },
        plan: {
          type: 'array',
          maxItems: MAX_STEPS,
          items: {
            type: 'object',
            required: ['step', 'status'],
            properties: {
              step: { type: 'string', minLength: 1, maxLength: MAX_STEP },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
          },
        },
      },
    },
    async call(args) {
      const message = boundedText(args.message, 'message', MAX_MESSAGE);
      let plan: ProgressStep[] | undefined;
      if (args.plan !== undefined) {
        if (!Array.isArray(args.plan) || args.plan.length > MAX_STEPS)
          throw new Error(`plan must be a list of at most ${MAX_STEPS} steps.`);
        plan = args.plan.map((item: unknown) => {
          if (!item || typeof item !== 'object' || !('step' in item) || !('status' in item))
            throw new Error('Each plan step needs step and status.');
          const step = boundedText(item.step, 'step', MAX_STEP);
          const { status } = item;
          if (status !== 'pending' && status !== 'in_progress' && status !== 'completed')
            throw new Error('status must be pending, in_progress or completed.');
          return { step, status };
        });
      }
      report({ message, ...(plan ? { plan } : {}) });
      return 'Progress shown in chat.';
    },
  };
}

/** One loopback listener. Each turn gets its own revocable URL, including resumed and queued turns. */
export async function startProgressChannel(): Promise<ProgressChannel> {
  const scopes = new Map<string, McpTool[]>();
  const server = await startScopedLocalMcpServer(
    {
      name: PROGRESS_SERVER_NAME,
      instructions: 'Use report_progress to keep the user informed during multi-step work.',
    },
    (target) => scopes.get(target),
  );
  return {
    openTurn(report, signal, name = PROGRESS_SERVER_NAME) {
      const url = new URL(server.mcpServer.url);
      url.searchParams.set('turn', randomUUID());
      const target = url.pathname + url.search;
      const close = () => {
        scopes.delete(target);
        signal.removeEventListener('abort', close);
      };
      if (!signal.aborted) {
        scopes.set(target, [progressTool(report)]);
        signal.addEventListener('abort', close, { once: true });
      }
      const mcpServer = { ...server.mcpServer, name, url: url.href, trusted: true, [PROGRESS_CHANNEL]: true };
      return { mcpServer, close };
    },
    close() {
      scopes.clear();
      return server.close();
    },
  };
}
