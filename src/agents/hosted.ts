import {
  managedAgent,
  UNCHECKED_FIELDS,
  type ManagedProvider,
  type ManagedSnapshot,
  type ManagedStart,
} from './managed.js';
import type { AgentCapabilities, AgentEvent, AgentTask, CodingAgent } from './types.js';

export type HostedTaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** What a hosted provider receives. `cwd` is the provider's workspace reference (a repo, a branch...). */
export type HostedTaskRequest = Omit<AgentTask, 'env' | 'signal' | 'onApproval' | 'timeoutMs'>;

export interface HostedPoll {
  state: HostedTaskState;
  /** Events since the previous poll. */
  events?: AgentEvent[];
  /** Opaque position handed back on the next poll. */
  cursor?: string;
  error?: string;
}

/**
 * A remote coding-agent service: tasks run on the vendor's machines and are polled.
 * Implement this for a hosted product and pass it to `hostedAgent()`. For approvals, usage,
 * budgets, live streams or sessions that outlive the process, implement `ManagedProvider`.
 */
export interface HostedAgentProvider {
  readonly name: string;
  readonly capabilities?: AgentCapabilities;
  start(task: HostedTaskRequest, signal: AbortSignal): Promise<{ id: string }>;
  poll(id: string, cursor: string | undefined, signal: AbortSignal): Promise<HostedPoll>;
  /** Add input to a running task (backs `AgentRun.steer`). */
  send?(id: string, text: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface HostedAgentOptions {
  /** Delay between polls. Default 5 s. */
  pollIntervalMs?: number;
}

/** Adapt a `HostedAgentProvider` to `CodingAgent`, so hosted and local agents share one API. */
export function hostedAgent(provider: HostedAgentProvider, options: HostedAgentOptions = {}): CodingAgent {
  return managedAgent(fromHosted(provider), { pollIntervalMs: options.pollIntervalMs ?? 5_000 });
}

/** A `HostedAgentProvider` as a `ManagedProvider`: polled, no approvals, usage or native budget. */
export function fromHosted(provider: HostedAgentProvider): ManagedProvider {
  const snapshot = (id: string, poll: HostedPoll): ManagedSnapshot => ({
    id,
    state: poll.state,
    ...(poll.error !== undefined ? { error: poll.error } : {}),
  });
  const managed: ManagedProvider = {
    name: provider.name,
    // A hosted provider is asked about one task at a time; it lists nothing.
    sessions: null,
    capabilities: { remote: true, ...provider.capabilities },
    async start(request: ManagedStart, signal?: AbortSignal) {
      const task: HostedTaskRequest = {
        prompt: request.prompt,
        cwd: request.workspace ?? '.',
        ...(request.model !== undefined ? { model: request.model } : {}),
        ...(request.effort !== undefined ? { effort: request.effort } : {}),
        ...(request.maxTurns !== undefined ? { maxTurns: request.maxTurns } : {}),
        ...(request.resume !== undefined ? { resume: request.resume } : {}),
        ...(request.extraArgs !== undefined ? { extraArgs: request.extraArgs } : {}),
        ...(request.mcpServers !== undefined ? { mcpServers: request.mcpServers } : {}),
        ...(request.permissions !== undefined ? { permissions: request.permissions } : {}),
        ...(request.budget !== undefined ? { budget: request.budget } : {}),
      };
      const { id } = await provider.start(task, signal ?? new AbortController().signal);
      return { id, state: 'queued' };
    },
    async get(id, signal) {
      return snapshot(id, await provider.poll(id, undefined, signal ?? new AbortController().signal));
    },
    async events(id, cursor, signal) {
      const poll = await provider.poll(id, cursor, signal ?? new AbortController().signal);
      return {
        events: poll.events ?? [],
        ...(poll.cursor !== undefined ? { cursor: poll.cursor } : {}),
        snapshot: snapshot(id, poll),
      };
    },
    ...(provider.send ? { send: (id: string, text: string) => provider.send!(id, text) } : {}),
    async interrupt(id) {
      await provider.cancel(id);
      return { enforced: true };
    },
  };
  // Hosted providers never declared resume or MCP support: keep forwarding those fields as before.
  return Object.assign(managed, { [UNCHECKED_FIELDS]: true });
}
