import {
  failureOfError,
  managedAgent,
  type ManagedProvider,
  type ManagedSnapshot,
  type ManagedStart,
  type ManagedState,
  type ManagedStopReason,
  type ManagedUpdate,
  type ManagedUsage,
} from '../managed.js';
import type { SessionInfo, SessionSource } from '../sessions/types.js';
import type { AgentEvent, CodingAgent } from '../types.js';
import { httpError, ManagedHttpError, remoteServers, sse, textOf, trimSlashes, pause } from './managed-http.js';

/** A Cloud Agent as the Cursor API reports it; the fields this driver reads. */
export interface CursorAgent {
  id: string;
  name?: string;
  /** `ACTIVE`, `IDLE` or `ARCHIVED`. */
  status: string;
  url?: string;
  latestRunId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** One run (turn) of a Cloud Agent; the fields this driver reads. */
export interface CursorRun {
  id: string;
  agentId?: string;
  /** `CREATING`, `RUNNING`, `WAITING_FOR_BACKGROUND_WORK`, then `FINISHED`, `ERROR`, `CANCELLED` or `EXPIRED`. */
  status: string;
  createdAt?: string;
  updatedAt?: string;
  durationMs?: number;
  result?: string;
  git?: { branches?: readonly { repoUrl?: string; branch?: string; prUrl?: string }[] };
}

/** Token counts of an agent, all its runs together. */
export interface CursorUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
}

export interface CursorCloudOptions {
  /** Cursor API key. Default: `CURSOR_API_KEY`. */
  apiKey?: string | (() => string | Promise<string>);
  /** Overrides the API root (up to, not including, `/v1`). Default `https://api.cursor.com`. */
  baseUrl?: string;
  /** Model id from `GET /v1/models` when the task names none. Default: the account's default model. */
  model?: string;
  /** Where new agents run: a named Cursor-hosted environment, or a self-hosted `pool` or `machine`. */
  env?: { type: 'cloud' | 'pool' | 'machine'; name?: string };
  /** Open a pull request when a run finishes. */
  autoCreatePR?: boolean;
  /** Push to the starting branch instead of a new `cursor/...` branch. */
  workOnCurrentBranch?: boolean;
  /** Do not ask the key's owner to review the pull request. */
  skipReviewerRequest?: boolean;
  /** `plan` drafts a plan before coding. Default: the platform's (`agent`). */
  mode?: 'agent' | 'plan';
  /** Environment variables for the agent's shell, deleted with the agent. */
  envVars?: Readonly<Record<string, string>>;
  /** Stream assistant text as `text-delta` events while the model writes it. Default true. */
  textDeltas?: boolean;
  /** Fallback poll interval when the stream drops. Default 5 s. */
  pollIntervalMs?: number;
  /** Default: global `fetch`. */
  fetch?: typeof fetch;
  /** Provider name in events and results. Default `cursorCloud`. */
  name?: string;
}

/** Cursor Cloud Agents as a `CodingAgent`: Cursor's agent loop in a VM with your repository. */
export function cursorCloud(options: CursorCloudOptions = {}): CodingAgent {
  return managedAgent(cursorCloudProvider(options), {
    ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
  });
}

/** `sessions.list` reads at most this many pages of 100 agents. */
const MAX_LIST_PAGES = 10;

/**
 * Cursor Cloud Agents as a `ManagedProvider`. A session is an agent (`bc-...`) and keeps its id:
 * every turn is a run on it, a snapshot reports the latest run, and `usage` the whole agent.
 * Event cursors name the run, so a stream never resumes into another turn.
 */
export function cursorCloudProvider(options: CursorCloudOptions = {}): ManagedProvider {
  const name = options.name ?? 'cursorCloud';
  const root = trimSlashes(options.baseUrl ?? 'https://api.cursor.com');
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const auth = async (): Promise<string> => {
    const key =
      (typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey) ?? process.env.CURSOR_API_KEY;
    if (!key) throw new Error(`${name} needs an API key: options.apiKey or CURSOR_API_KEY.`);
    return `Bearer ${key}`;
  };

  /** One request; `null` on 404. */
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<Response | null> => {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        authorization: await auth(),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok) throw await httpError(name, method, path, response);
    return response;
  };

  const json = async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T | null> => {
    const response = await request(method, path, body, signal);
    if (!response) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  };

  const agentPath = (id: string) => `/v1/agents/${encodeURIComponent(id)}`;

  // `GET /v1/agents`: the account's agents, newest first, without their repositories.
  const sessions: SessionSource = {
    name,
    where: 'cloud',
    async list(query = {}) {
      // A local directory names no Cloud Agent.
      if (query.cwd !== undefined) return [];
      const wanted = query.limit ?? Infinity;
      const found: SessionInfo[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES && found.length < wanted; page++) {
        const params = new URLSearchParams({ limit: '100', includeArchived: 'false' });
        if (cursor) params.set('cursor', cursor);
        const listed = await json<{ items?: readonly CursorAgent[]; nextCursor?: string }>(
          'GET',
          `/v1/agents?${params.toString()}`,
          undefined,
          query.signal,
        );
        for (const agent of listed?.items ?? []) {
          if (agent.status === 'ARCHIVED') continue;
          const started = agent.createdAt ? Date.parse(agent.createdAt) : NaN;
          const updated = agent.updatedAt ? Date.parse(agent.updatedAt) : started;
          if (!Number.isFinite(updated) || (query.since !== undefined && updated < query.since)) continue;
          found.push({
            source: name,
            agent: name,
            id: agent.id,
            where: 'cloud',
            updatedAt: updated,
            ...(Number.isFinite(started) ? { startedAt: started } : {}),
            ...(agent.name ? { title: agent.name } : {}),
            ...(agent.url ? { url: agent.url } : {}),
            state: agent.status === 'ACTIVE' ? 'active' : 'waiting',
          });
        }
        cursor = listed?.nextCursor;
        if (!cursor) break;
      }
      return found.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, query.limit);
    },
  };
  const runPath = (id: string, run: string) => `${agentPath(id)}/runs/${encodeURIComponent(run)}`;
  const getAgent = (id: string, signal?: AbortSignal) => json<CursorAgent>('GET', agentPath(id), undefined, signal);
  const getRun = (id: string, run: string, signal?: AbortSignal) =>
    json<CursorRun>('GET', runPath(id, run), undefined, signal);

  const usage = async (id: string, signal?: AbortSignal): Promise<ManagedUsage | undefined> => {
    const found = await json<{ totalUsage?: CursorUsage }>('GET', `${agentPath(id)}/usage`, undefined, signal);
    return usageOf(found?.totalUsage);
  };

  const snapshotOf = async (agent: CursorAgent, signal?: AbortSignal): Promise<ManagedSnapshot> => {
    const run = agent.latestRunId ? await getRun(agent.id, agent.latestRunId, signal) : null;
    const spent = await usage(agent.id, signal);
    const { state, stopReason }: { state: ManagedState; stopReason?: ManagedStopReason } = run
      ? stateOf(run.status)
      : agent.status === 'ARCHIVED'
        ? { state: 'completed' }
        : { state: 'idle', stopReason: 'end-turn' };
    const started = Date.parse(run?.createdAt ?? agent.createdAt ?? '');
    const updated = Date.parse(run?.updatedAt ?? '');
    const settled = state !== 'running' && state !== 'queued';
    return {
      id: agent.id,
      state,
      ...(stopReason ? { stopReason } : {}),
      vendorState: run ? run.status : agent.status,
      ...(spent ? { usage: spent } : {}),
      ...(run?.result ? { text: run.result } : {}),
      ...(state === 'failed' ? { error: run?.result || `${name} run ${run?.id ?? ''} ended in an error.` } : {}),
      ...(run ? { cursor: run.id } : {}),
      ...(Number.isFinite(started) ? { startedAt: started } : {}),
      ...(settled && Number.isFinite(updated) ? { endedAt: updated } : {}),
    };
  };

  // Per run, kept across reconnects: text not yet ended by a tool call, and tool names by call.
  const streams = new Map<string, { text: string; tools: Map<string, string> }>();
  // Steers queued as an agent's next follow-up: a run that ends is not the turn's end while one waits.
  const queued = new Set<string>();

  /** The run after `run`, once the agent has started it; undefined when none comes in time. */
  const nextRun = async (id: string, run: string, signal: AbortSignal): Promise<string | undefined> => {
    const step = Math.min(options.pollIntervalMs ?? QUEUED_POLL_MS, QUEUED_POLL_MS);
    for (let waited = 0; waited <= QUEUED_WAIT_MS && !signal.aborted; waited += step) {
      const agent = await getAgent(id, signal);
      if (agent?.latestRunId && agent.latestRunId !== run) return agent.latestRunId;
      if (!agent || agent.status !== 'ACTIVE') return undefined;
      await pause(step, signal);
    }
    return undefined;
  };

  const provider: ManagedProvider = {
    name,
    sessions,
    capabilities: {
      usage: true,
      mcp: true,
      resume: true,
      // The agent runs its tools without asking.
      permissions: { approval: ['auto-approve'] },
    },

    async start(start, signal) {
      if (start.maxTurns !== undefined) throw new Error(`${name} cannot cap turns (maxTurns).`);
      if (start.extraArgs?.length) throw new Error(`${name} takes no extra arguments.`);
      if (start.effort !== undefined) throw new Error(`${name} takes no effort setting; pick a model variant.`);
      if (start.files?.length) throw new Error(`${name} cannot take start files; give a repository workspace.`);
      const prompt = { text: start.system ? `${start.system}\n\n${start.prompt}` : start.prompt };
      const mcpServers = mcpOf(start);
      const vendor = start.vendor ?? {};

      let agentId: string;
      let runId: string | undefined;
      if (start.resume !== undefined) {
        const prior = await getAgent(start.resume, signal);
        if (!prior) throw new Error(`${name}: agent '${start.resume}' not found.`);
        if (prior.status === 'ARCHIVED') throw new Error(`${name}: agent '${start.resume}' is archived.`);
        const last = prior.latestRunId ? await getRun(prior.id, prior.latestRunId, signal) : null;
        if (last && isActive(last.status))
          throw new Error(`${name}: agent '${start.resume}' is still running; resume it once it settles.`);
        if (start.model !== undefined)
          throw new Error(`${name}: a follow-up keeps the agent's model; drop 'model' when resuming.`);
        if (start.workspace?.startsWith('https://'))
          throw new Error(`${name}: a follow-up works in the agent's own repository; drop 'workspace' when resuming.`);
        const created = await json<{ run?: CursorRun }>(
          'POST',
          `${agentPath(prior.id)}/runs`,
          {
            ...vendor,
            prompt,
            // An empty list too: it drops the servers of earlier turns, where leaving it out keeps them.
            ...(start.mcpServers !== undefined ? { mcpServers } : {}),
            ...(options.mode ? { mode: options.mode } : {}),
          },
          signal,
        );
        if (!created) throw new Error(`${name}: agent '${start.resume}' not found.`);
        agentId = prior.id;
        runId = created.run?.id;
      } else {
        const model = start.model ?? options.model;
        const repos = reposOf(start.workspace);
        // A local path is the caller's own checkout: the agent works in its own VM without it.
        if (start.workspace?.startsWith('https://') && !repos)
          throw new Error(`${name}: workspace '${start.workspace}' is not a repository or pull request URL.`);
        const created = await json<{ agent?: CursorAgent; run?: CursorRun }>(
          'POST',
          '/v1/agents',
          {
            ...vendor,
            prompt,
            ...(model ? { model: { id: model } } : {}),
            ...(start.correlationId ? { name: start.correlationId.slice(0, 100) } : {}),
            ...(options.env ? { env: { ...options.env } } : {}),
            ...(repos ? { repos } : {}),
            ...(options.workOnCurrentBranch !== undefined ? { workOnCurrentBranch: options.workOnCurrentBranch } : {}),
            ...(options.autoCreatePR !== undefined ? { autoCreatePR: options.autoCreatePR } : {}),
            ...(options.skipReviewerRequest !== undefined ? { skipReviewerRequest: options.skipReviewerRequest } : {}),
            ...(options.envVars && Object.keys(options.envVars).length ? { envVars: { ...options.envVars } } : {}),
            ...(mcpServers.length ? { mcpServers } : {}),
            ...(options.mode ? { mode: options.mode } : {}),
          },
          signal,
        );
        if (!created?.agent?.id) throw new Error(`${name} returned no agent.`);
        agentId = created.agent.id;
        runId = created.run?.id ?? created.agent.latestRunId;
      }
      if (!runId) throw new Error(`${name} returned no run.`);
      const spent = await usage(agentId, signal).catch(() => undefined);
      // Fresh from create: the run's events are read from its own stream, which ends with its result.
      return {
        id: agentId,
        state: 'queued',
        vendorState: 'CREATING',
        cursor: runId,
        ...(spent ? { usage: spent } : {}),
        ...((start.model ?? options.model) && start.resume === undefined
          ? { model: start.model ?? options.model }
          : {}),
        startedAt: Date.now(),
      };
    },

    async get(id, signal) {
      const agent = await getAgent(id, signal);
      return agent ? snapshotOf(agent, signal) : null;
    },

    async *watch(id, signal, cursor) {
      let { run, event: position } = parseCursor(cursor);
      if (!run) {
        const agent = await getAgent(id, signal);
        if (!agent?.latestRunId) return;
        run = agent.latestRunId;
      }
      const runId = run;
      const state = streams.get(runId) ?? { text: '', tools: new Map<string, string>() };
      streams.set(runId, state);
      const at = () => ({ cursor: position ? `${runId} ${position}` : runId });
      // The stream carries no usage: read it now and then, so a local budget can stop a long run.
      const usageEvery = options.pollIntervalMs ?? DEFAULT_POLL_MS;
      let usageAt = Date.now();
      let usageSeen = '';
      const usageUpdate = async (): Promise<AgentEvent | undefined> => {
        if (Date.now() - usageAt < usageEvery) return undefined;
        usageAt = Date.now();
        const spent = await usage(id, signal).catch(() => undefined);
        const key = JSON.stringify(spent ?? null);
        if (!spent || key === usageSeen) return undefined;
        usageSeen = key;
        return { type: 'usage', usage: spent };
      };
      const flush = (events: AgentEvent[]) => {
        if (state.text) events.push({ type: 'message', text: state.text });
        state.text = '';
      };

      // A drop reconnects from the last event; gives up after a few tries without progress.
      for (let tries = 0; tries < 3 && !signal.aborted; tries++) {
        if (tries) await pause(250 * tries, signal);
        let response: Response | null;
        try {
          response = await request('GET', `${runPath(id, runId)}/stream`, undefined, signal, {
            accept: 'text/event-stream',
            ...(position ? { 'last-event-id': position } : {}),
          });
        } catch (error) {
          if (signal.aborted) return;
          // Past the stream's retention: the run's end state is read with `get`.
          if (error instanceof ManagedHttpError && error.status === 410) return;
          if (failureOfError(error)?.kind === 'unavailable') continue;
          throw error;
        }
        // Gone: `get` reports it.
        if (!response?.body) return;
        try {
          for await (const message of sse(response.body)) {
            if (signal.aborted) return;
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(message.data) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (message.id && message.id !== position) {
              position = message.id;
              tries = -1;
            }
            const events: AgentEvent[] = [];
            if (message.event !== 'result' && message.event !== 'done') {
              const spent = await usageUpdate();
              if (spent) events.push(spent);
            }
            switch (message.event) {
              case 'assistant':
                if (typeof data.text === 'string' && data.text) {
                  state.text += data.text;
                  if (options.textDeltas !== false) events.push({ type: 'text-delta', text: data.text });
                }
                break;
              case 'tool_call': {
                flush(events);
                const callId = typeof data.callId === 'string' ? data.callId : undefined;
                const tool = typeof data.name === 'string' ? data.name : 'tool';
                if (data.status === 'completed') {
                  const output = data.result === undefined ? '' : textOf(data.result);
                  events.push({
                    type: 'tool-end',
                    ...(callId ? { id: callId } : {}),
                    name: (callId && state.tools.get(callId)) || tool,
                    ...(isToolError(data.result) ? { isError: true } : {}),
                    ...(output ? { output } : {}),
                  });
                  if (callId) state.tools.delete(callId);
                } else if (!callId || !state.tools.has(callId)) {
                  if (callId) state.tools.set(callId, tool);
                  events.push({
                    type: 'tool-start',
                    ...(callId ? { id: callId } : {}),
                    name: tool,
                    ...(data.args !== undefined ? { input: data.args } : {}),
                  });
                }
                break;
              }
              case 'result': {
                // The run's final reply comes with the snapshot; text before it that differs still counts.
                const final = typeof data.text === 'string' && data.text && data.text === state.text ? data.text : '';
                if (!final) flush(events);
                state.text = '';
                let found = await provider.get(id, signal);
                // A steer queued as the next follow-up: the turn goes on in the run it starts.
                if (found?.cursor === runId && isSettledRun(found.vendorState) && queued.delete(id)) {
                  const next = await nextRun(id, runId, signal);
                  if (next) found = await provider.get(id, signal);
                }
                if (found && found.cursor === runId && isSettledRun(found.vendorState)) {
                  streams.delete(runId);
                  yield { ...at(), ...(events.length ? { events } : {}), snapshot: found };
                  return;
                }
                // A steer that came too late started the next run: the turn goes on there.
                if (found?.cursor && found.cursor !== runId) {
                  // This run's own reply, which the next run's snapshot does not carry.
                  if (final) events.push({ type: 'message', text: final });
                  streams.delete(runId);
                  yield { cursor: found.cursor, ...(events.length ? { events } : {}), snapshot: found };
                  return;
                }
                break;
              }
              case 'done': {
                flush(events);
                if (events.length) yield { ...at(), events };
                return;
              }
              // `error`: the stream ends after it; `get` tells whether the run failed.
            }
            if (events.length || message.id)
              yield { ...at(), ...(events.length ? { events } : {}) } satisfies ManagedUpdate;
          }
        } catch (error) {
          if (signal.aborted) return;
          if (failureOfError(error)?.kind !== 'unavailable') throw error;
        }
      }
    },

    async send(id, text) {
      // Steers the running turn, or becomes the next one when none is running.
      const response = await request('POST', `${agentPath(id)}/runs`, { prompt: { text }, delivery: 'steer' });
      if (!response) throw new Error(`${name}: agent '${id}' not found.`);
      const answer = (await response.json().catch(() => ({}))) as { delivery?: string };
      if (answer.delivery === 'queued') queued.add(id);
    },

    async interrupt(id) {
      try {
        const agent = await getAgent(id);
        if (!agent?.latestRunId) return { enforced: !!agent };
        const response = await request('POST', `${runPath(id, agent.latestRunId)}/cancel`);
        await response?.body?.cancel().catch(() => undefined);
        return { enforced: !!response };
      } catch (error) {
        // Already ended: nothing left to stop.
        if (error instanceof ManagedHttpError && error.status === 409) return { enforced: true };
        return { enforced: false };
      }
    },

    async delete(id) {
      const response = await request('DELETE', agentPath(id));
      await response?.body?.cancel().catch(() => undefined);
    },
  };
  return provider;
}

/** `managedAgent()`'s default poll interval, which also paces usage reads during a stream. */
const DEFAULT_POLL_MS = 5_000;

/** How long a run's end waits for the run a queued steer starts, and how often it looks. */
const QUEUED_WAIT_MS = 30_000;
const QUEUED_POLL_MS = 1_000;

/** A run's status as a managed state. */
function stateOf(status: string): { state: ManagedState; stopReason?: ManagedStopReason } {
  switch (status) {
    case 'CREATING':
      return { state: 'queued' };
    case 'RUNNING':
    case 'WAITING_FOR_BACKGROUND_WORK':
      return { state: 'running' };
    case 'FINISHED':
      return { state: 'idle', stopReason: 'end-turn' };
    case 'ERROR':
      return { state: 'failed', stopReason: 'error' };
    case 'CANCELLED':
      return { state: 'cancelled' };
    case 'EXPIRED':
      return { state: 'timeout' };
    default:
      return { state: 'idle', stopReason: status.toLowerCase() };
  }
}

function isActive(status: string): boolean {
  return status === 'CREATING' || status === 'RUNNING' || status === 'WAITING_FOR_BACKGROUND_WORK';
}

function isSettledRun(status: string | undefined): boolean {
  return !!status && !isActive(status);
}

/** `run` or `run event`: the run a stream reads, and the last event read in it. */
function parseCursor(cursor: string | undefined): { run?: string; event?: string } {
  if (!cursor) return {};
  const space = cursor.indexOf(' ');
  return space < 0 ? { run: cursor } : { run: cursor.slice(0, space), event: cursor.slice(space + 1) };
}

/** A tool result that reports a failure: `{ error }` rather than `{ success }`. */
function isToolError(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'error' in result && !('success' in result);
}

function usageOf(usage: CursorUsage | undefined): ManagedUsage | undefined {
  if (!usage) return undefined;
  const read = usage.cacheReadTokens;
  const write = usage.cacheWriteTokens;
  // Input as the other drivers count it: cache reads and writes are input too.
  const input =
    usage.inputTokens !== undefined || read !== undefined || write !== undefined
      ? (usage.inputTokens ?? 0) + (read ?? 0) + (write ?? 0)
      : undefined;
  const details: Record<string, number> = {
    ...(write !== undefined ? { cacheWriteTokens: write } : {}),
  };
  const out: ManagedUsage = {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(read !== undefined ? { cachedInputTokens: read } : {}),
    ...(Object.keys(details).length ? { details } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** The task's remote MCP servers, as Cursor takes them. */
function mcpOf(start: ManagedStart): Record<string, unknown>[] {
  return remoteServers(start).map((server) => ({
    name: server.name,
    type: 'http',
    url: server.url,
    ...(server.headers && Object.keys(server.headers).length ? { headers: { ...server.headers } } : {}),
  }));
}

/**
 * A workspace as `repos`: a repository URL (`#ref` picks the branch or commit to start from) or a
 * pull request URL (GitHub `/pull/N`, GitLab `/-/merge_requests/N`), on any provider Cursor reaches.
 */
function reposOf(workspace: string | undefined): Record<string, string>[] | undefined {
  if (!workspace?.startsWith('https://') || /\s/.test(workspace)) return undefined;
  const hash = workspace.indexOf('#');
  const url = trimSlashes(hash < 0 ? workspace : workspace.slice(0, hash));
  const ref = hash < 0 ? '' : workspace.slice(hash + 1);
  for (const marker of ['/pull/', '/-/merge_requests/', '/pull-requests/']) {
    const at = url.indexOf(marker);
    if (at > 0 && /^\d+$/.test(url.slice(at + marker.length))) return [{ url: url.slice(0, at), prUrl: url }];
  }
  if (url.split('/').length < 5) return undefined;
  return [{ url, ...(ref ? { startingRef: ref } : {}) }];
}
