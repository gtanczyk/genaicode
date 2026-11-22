import { posix } from 'node:path';
import {
  failureOfError,
  managedAgent,
  type ManagedProvider,
  type ManagedSnapshot,
  type ManagedStart,
  type ManagedStopReason,
  type ManagedUpdate,
  type ManagedUsage,
} from '../managed.js';
import { anySignal } from '../runtime.js';
import type { SessionInfo, SessionSource } from '../sessions/types.js';
import type { AgentEvent, AgentFailure, ApprovalRequest, CodingAgent, McpServer } from '../types.js';

/** An event as Claude Managed Agents reports it; the fields this driver reads. */
export interface AnthropicManagedEvent {
  type: string;
  id?: string;
  processed_at?: string | null;
}

/** A session as Claude Managed Agents reports it; the fields this driver reads. */
export interface AnthropicManagedSession {
  id: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  title?: string | null;
  agent?: {
    model?: AnthropicManagedModel;
    mcp_servers?: readonly { name: string; url: string }[];
  };
  budget?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
    active_seconds?: number;
    list_cost?: { amount: string; currency: string } | null;
  };
}

/** An agent's model; the API reports `effort` as `{ type }`. */
export interface AnthropicManagedModel {
  id: string;
  effort?: string | { type: string };
  speed?: string;
  inference_geo?: string;
}

/** An agent as Claude Managed Agents reports it; the fields this driver reads. */
export interface AnthropicManagedAgentConfig {
  id: string;
  version: number;
  system?: string | null;
  model: AnthropicManagedModel;
  tools?: readonly unknown[];
  mcp_servers?: readonly { name: string; url: string; type?: string }[];
}

interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * The part of `@anthropic-ai/sdk`'s client (`new Anthropic()`, a version with `beta.sessions`)
 * this driver calls.
 */
export interface AnthropicManagedClient {
  beta: {
    agents: {
      retrieve(
        id: string,
        params?: { version?: number },
        options?: RequestOptions,
      ): PromiseLike<AnthropicManagedAgentConfig>;
    };
    sessions: {
      create(params: object, options?: RequestOptions): PromiseLike<AnthropicManagedSession>;
      retrieve(id: string, params?: undefined, options?: RequestOptions): PromiseLike<AnthropicManagedSession>;
      update(id: string, params: object, options?: RequestOptions): PromiseLike<unknown>;
      delete(id: string): PromiseLike<unknown>;
      /** Newest first, every page. Absent in SDK versions before session listing. */
      list?(params?: object, options?: RequestOptions): AsyncIterable<AnthropicManagedSession>;
      events: {
        send(id: string, params: { events: object[] }, options?: RequestOptions): PromiseLike<unknown>;
        stream(
          id: string,
          params?: { event_deltas?: string[] },
          options?: RequestOptions,
        ): PromiseLike<AsyncIterable<AnthropicManagedEvent>>;
        list(id: string, params?: object, options?: RequestOptions): AsyncIterable<AnthropicManagedEvent>;
      };
    };
    vaults: {
      create(params: object, options?: RequestOptions): PromiseLike<{ id: string }>;
      delete(id: string): PromiseLike<unknown>;
      credentials: {
        create(vaultId: string, params: object, options?: RequestOptions): PromiseLike<unknown>;
      };
    };
    files: {
      upload(params: { file: File }, options?: RequestOptions): PromiseLike<{ id: string }>;
      delete(id: string): PromiseLike<unknown>;
    };
  };
}

/** Runs an `agent.custom_tool_use` call; the returned text goes back as its result. */
export type AnthropicManagedToolHandler = (
  input: Readonly<Record<string, unknown>>,
  context: { sessionId: string; signal: AbortSignal },
) => string | Promise<string>;

export interface AnthropicManagedOptions {
  /** The agent every session runs: its id (latest version) or a pinned `{ id, version }`. Create it once, outside the request path. */
  agent: string | { id: string; version?: number };
  /** The environment (`env_...`) sessions run in. */
  environment: string;
  /** Default: `new Anthropic()` from `@anthropic-ai/sdk`, which needs a version with Managed Agents. */
  client?: AnthropicManagedClient;
  /** Vaults (`vlt_...`) every session gets, besides the one made for `mcpServers` headers. */
  vaultIds?: readonly string[];
  /** Token for `https://github.com/...` workspaces (cloned and pushed through Anthropic's git proxy). */
  githubToken?: string | (() => string | Promise<string>);
  /** Handlers for the agent's custom tools, by name. A call to a tool without one gets an error result. */
  tools?: Readonly<Record<string, AnthropicManagedToolHandler>>;
  /** Where `ManagedStart.files` are mounted. Default `/workspace`. */
  filesRoot?: string;
  /** Stream assistant text as `text-delta` events while the model writes it. Default true. */
  textDeltas?: boolean;
  /** Fallback poll interval when the stream drops. Default 5 s. */
  pollIntervalMs?: number;
  /** Provider name in events and results. Default `anthropicManaged`. */
  name?: string;
}

/** `sessions.list` reads at most this many sessions. */
const MAX_LISTED = 1000;

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Claude Managed Agents as a `CodingAgent`: sessions on Anthropic's agent loop and sandbox. */
export function anthropicManaged(options: AnthropicManagedOptions): CodingAgent {
  return managedAgent(anthropicManagedProvider(options), {
    ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
  });
}

/** Claude Managed Agents as a `ManagedProvider`. */
export function anthropicManagedProvider(options: AnthropicManagedOptions): ManagedProvider {
  const name = options.name ?? 'anthropicManaged';
  const agentRef = typeof options.agent === 'string' ? { id: options.agent } : options.agent;
  let clientPromise: Promise<AnthropicManagedClient> | undefined;
  const client = () => (clientPromise ??= options.client ? Promise.resolve(options.client) : defaultClient());

  const retrieve = async (id: string, signal?: AbortSignal): Promise<AnthropicManagedSession | null> => {
    try {
      return await (await client()).beta.sessions.retrieve(id, undefined, signal ? { signal } : undefined);
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  };

  /** Recent events, newest first, until `stop` says enough. */
  const recent = async (id: string, stop: (event: AnthropicManagedEvent) => boolean, signal?: AbortSignal) => {
    const c = await client();
    let seen = 0;
    for await (const event of c.beta.sessions.events.list(
      id,
      { order: 'desc', limit: 50 },
      signal ? { signal } : undefined,
    )) {
      if (stop(event) || ++seen >= 200) return event;
    }
    return undefined;
  };

  /** Events after `cursor`, oldest first. */
  async function* after(
    id: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<AnthropicManagedEvent> {
    const c = await client();
    const at = parseCursor(cursor);
    const params: Record<string, unknown> = { order: 'asc', ...(at ? { 'created_at[gte]': at.time } : {}) };
    // Events at the cursor's own instant: drop up to the cursor's event, keep the rest.
    let held: AnthropicManagedEvent[] = [];
    let holding = !!at;
    for await (const event of c.beta.sessions.events.list(id, params, { signal })) {
      if (holding && at && event.processed_at === at.time) {
        if (event.id === at.id) {
          held = [];
          holding = false;
        } else held.push(event);
        continue;
      }
      if (holding) {
        for (const event of held) yield event;
        held = [];
        holding = false;
      }
      yield event;
    }
    for (const event of held) yield event;
  }

  const snapshotOf = (session: AnthropicManagedSession, extra: Partial<ManagedSnapshot> = {}): ManagedSnapshot => {
    const usage = usageOf(session.usage);
    const cost = session.usage?.list_cost;
    const created = session.created_at ? Date.parse(session.created_at) : NaN;
    return {
      id: session.id,
      state: 'running',
      vendorState: session.status,
      ...(session.agent?.model?.id ? { model: session.agent.model.id } : {}),
      ...(usage ? { usage } : {}),
      ...(cost && cost.currency === 'USD' && /^\d+$/.test(cost.amount) ? { costUsd: Number(cost.amount) / 100 } : {}),
      ...(Number.isFinite(created) ? { startedAt: created } : {}),
      ...extra,
    };
  };

  // The sessions of this driver's agent, as the API lists them (newest first by creation).
  const sessions: SessionSource = {
    name,
    where: 'cloud',
    async list(query = {}) {
      // A local directory names no hosted session.
      if (query.cwd !== undefined) return [];
      const c = await client();
      if (!c.beta.sessions.list) throw new Error(`${name}: this @anthropic-ai/sdk version cannot list sessions.`);
      const wanted = query.limit ?? Infinity;
      const found: SessionInfo[] = [];
      let seen = 0;
      for await (const session of c.beta.sessions.list(
        { agent_id: agentRef.id, limit: 100 },
        query.signal ? { signal: query.signal } : undefined,
      )) {
        if (++seen > MAX_LISTED) break;
        const snapshot = snapshotOf(session);
        const updated = Date.parse(session.updated_at ?? session.created_at ?? '');
        if (!Number.isFinite(updated) || (query.since !== undefined && updated < query.since)) continue;
        const state =
          session.status === 'running' || session.status === 'rescheduling'
            ? 'active'
            : session.status === 'idle'
              ? 'waiting'
              : undefined;
        found.push({
          source: name,
          agent: name,
          id: session.id,
          where: 'cloud',
          updatedAt: updated,
          ...(snapshot.startedAt !== undefined ? { startedAt: snapshot.startedAt } : {}),
          ...(session.title ? { title: session.title } : {}),
          ...(snapshot.model ? { model: snapshot.model } : {}),
          ...(snapshot.usage ? { usage: snapshot.usage } : {}),
          ...(snapshot.costUsd !== undefined ? { costUsd: snapshot.costUsd } : {}),
          ...(state ? { state } : {}),
        });
      }
      return found.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, wanted);
    },
  };

  /** The terminal error of the session's last turn, read back from its latest events. */
  const turnError = async (id: string, signal?: AbortSignal): Promise<SessionError | undefined> => {
    let stopped = false;
    let found: SessionError | undefined;
    await recent(
      id,
      (event) => {
        // From the newest stop back to where that turn began.
        if (!stopped) {
          stopped = SESSION_STOPS.has(event.type);
          return false;
        }
        if (event.type === 'session.error') {
          const error = sessionError(event);
          if (error.terminal) found = error;
          return !!found;
        }
        return TURN_STARTS.has(event.type);
      },
      signal,
    );
    return found;
  };

  /** The state of a session at rest, read from its latest events. */
  const settledSnapshot = async (session: AnthropicManagedSession, signal?: AbortSignal): Promise<ManagedSnapshot> => {
    if (session.status === 'running') return snapshotOf(session, { state: 'running' });
    if (session.status === 'rescheduling') return snapshotOf(session, { state: 'running' });
    let error: SessionError | undefined;
    let idle: Record<string, unknown> | undefined;
    let pending = false;
    await recent(
      session.id,
      (event) => {
        if (event.type === 'session.error' && (idle || session.status === 'terminated')) error ??= sessionError(event);
        if (event.type === 'user.message' && session.status === 'idle' && !idle) pending = true;
        // An ended session: its errors come before the end, back to where its last turn started.
        if (session.status === 'terminated')
          return event.type === 'session.status_running' || event.type === 'session.status_idle';
        if (pending) return true;
        // Past the last idle, back to where its turn ran: the errors that explain it lie between.
        if (idle) return event.type === 'session.status_running' || event.type === 'user.message';
        if (event.type === 'session.status_idle') idle = event as unknown as Record<string, unknown>;
        return false;
      },
      signal,
    );
    if (session.status === 'terminated') {
      const failed = error?.terminal;
      return snapshotOf(session, {
        state: failed ? 'failed' : 'completed',
        ...(failed ? { error: error!.message, ...(error!.failure ? { failure: error!.failure } : {}) } : {}),
        endedAt: Date.now(),
      });
    }
    // A message sent after the last idle: the next turn is about to start.
    if (pending || !idle) return snapshotOf(session, { state: 'queued' });
    return snapshotOf(session, { state: 'idle', ...stopOf(idle, error) });
  };

  const provider: ManagedProvider = {
    name,
    sessions,
    capabilities: {
      usage: true,
      mcp: true,
      resume: true,
      files: true,
      effort: EFFORTS,
      effortAtStart: true,
      budget: ['usd'],
      permissions: { approval: ['ask', 'auto-approve', 'deny'] },
    },

    async start(request: ManagedStart, signal?: AbortSignal) {
      if (request.maxTurns !== undefined) throw new Error(`${name} cannot cap turns (maxTurns).`);
      if (request.extraArgs?.length) throw new Error(`${name} takes no extra arguments.`);
      const c = await client();
      const opts = signal ? { signal } : undefined;
      const budget =
        request.budget?.maxCostUsd !== undefined
          ? {
              type: 'limit',
              max_list_cost: {
                amount: String(Math.max(1, Math.round(request.budget.maxCostUsd * 100))),
                currency: 'USD',
              },
            }
          : undefined;
      const message = { type: 'user.message', content: [{ type: 'text', text: request.prompt }] };

      if (request.resume !== undefined) {
        const session = await retrieve(request.resume, signal);
        if (!session) throw new Error(`${name} session ${request.resume} does not exist.`);
        refusedOnResume(name, session, request);
        // The platform caps the whole session, and `managedAgent()` already added what it spent.
        if (budget && session.budget) await c.beta.sessions.update(session.id, { budget }, opts);
        const latest = await recent(session.id, (event) => !!event.id && !!event.processed_at, signal);
        const cursor = latest?.id && latest.processed_at ? formatCursor(latest.processed_at, latest.id) : undefined;
        const events: Record<string, unknown>[] = [message];
        if (request.system) events.push({ type: 'system.message', content: [{ type: 'text', text: request.system }] });
        await c.beta.sessions.events.send(session.id, { events }, opts);
        return snapshotOf(session, { state: 'queued', ...(cursor ? { cursor } : {}), startedAt: Date.now() });
      }

      const release: string[] = [];
      try {
        const agent = await agentFor(c, agentRef, request, signal);
        const credentials = bearers(name, request.mcpServers ?? []);
        if (credentials.length) {
          const vault = await c.beta.vaults.create(
            {
              display_name: `genaicode ${request.correlationId ?? 'session'}`.slice(0, 255),
              metadata: { created_by: 'genaicode' },
            },
            opts,
          );
          release.push(`vault:${vault.id}`);
          for (const { server, token } of credentials)
            await c.beta.vaults.credentials.create(
              vault.id,
              { display_name: server.name, auth: { type: 'static_bearer', mcp_server_url: server.url, token } },
              opts,
            );
        }
        const resources: Record<string, unknown>[] = [];
        for (const file of request.files ?? []) {
          const path = posix.normalize(file.path);
          if (path.startsWith('..') || posix.isAbsolute(path))
            throw new Error(`${name}: file path '${file.path}' leaves the workspace.`);
          const content = typeof file.content === 'string' ? file.content : new Uint8Array(file.content);
          const uploaded = await c.beta.files.upload({ file: new File([content], posix.basename(path)) }, opts);
          release.push(`file:${uploaded.id}`);
          resources.push({
            type: 'file',
            file_id: uploaded.id,
            mount_path: posix.join(options.filesRoot ?? '/workspace', path),
          });
        }
        const repo = githubWorkspace(request.workspace);
        if (repo) {
          const token = typeof options.githubToken === 'function' ? await options.githubToken() : options.githubToken;
          resources.push({
            type: 'github_repository',
            url: repo.url,
            ...(repo.branch ? { checkout: { type: 'branch', name: repo.branch } } : {}),
            ...(token ? { authorization_token: token } : {}),
          });
        }
        const vaults = [
          ...(options.vaultIds ?? []),
          ...release.filter((ref) => ref.startsWith('vault:')).map((ref) => ref.slice(6)),
        ];
        const session = await c.beta.sessions.create(
          {
            agent,
            environment_id: options.environment,
            initial_events: [message],
            ...(request.correlationId
              ? {
                  title: request.correlationId.slice(0, 255),
                  metadata: { correlation_id: request.correlationId.slice(0, 512) },
                }
              : {}),
            ...(budget ? { budget } : {}),
            ...(vaults.length ? { vault_ids: vaults } : {}),
            ...(resources.length ? { resources } : {}),
          },
          opts,
        );
        // Created with a message, the session starts running at once; every event so far is this run's.
        return snapshotOf(session, {
          state: 'queued',
          release,
          startedAt: snapshotOf(session).startedAt ?? Date.now(),
        });
      } catch (error) {
        // Nothing started: free what this attempt made, and report the original error.
        await freeAll(c, release);
        throw error;
      }
    },

    async get(id, signal) {
      const session = await retrieve(id, signal);
      return session ? settledSnapshot(session, signal) : null;
    },

    async *watch(id, signal, cursor) {
      const c = await client();
      const local = new AbortController();
      const both = anySignal([signal, local.signal]);
      const tools = new Map<string, string>();
      let lastError: SessionError | undefined;
      const seen = new Set<string>();
      const answeredTools = new Set<string>();
      let position = cursor;

      /** One event as an update; `done` once the session settled. */
      const translate = async (
        event: AnthropicManagedEvent,
      ): Promise<{ update?: ManagedUpdate; done?: boolean; afterward?: () => Promise<void> }> => {
        if (event.id && event.processed_at) position = formatCursor(event.processed_at, event.id);
        const at = position ? { cursor: position } : {};
        const e = event as unknown as Record<string, unknown> & AnthropicManagedEvent;
        switch (event.type) {
          case 'event_delta': {
            const delta = e.delta as { content?: { type?: string; text?: string } } | undefined;
            const text = delta?.content?.type === 'text' ? delta.content.text : undefined;
            return text ? { update: { events: [{ type: 'text-delta', text }] } } : {};
          }
          case 'agent.message': {
            const text = textOf(e.content);
            return { update: { ...at, ...(text ? { events: [{ type: 'message', text }] } : {}) } };
          }
          case 'agent.tool_use':
          case 'agent.mcp_tool_use':
          case 'agent.custom_tool_use': {
            const toolName = String(e.name ?? 'tool');
            const shown = event.type === 'agent.mcp_tool_use' ? `${String(e.mcp_server_name)}.${toolName}` : toolName;
            if (event.id) tools.set(event.id, shown);
            const events: AgentEvent[] = [
              { type: 'tool-start', ...(event.id ? { id: event.id } : {}), name: shown, input: e.input },
            ];
            if (
              event.type !== 'agent.custom_tool_use' &&
              e.evaluated_permission === 'ask' &&
              event.id &&
              !answeredTools.has(event.id)
            )
              events.push({ type: 'approval-request', request: approvalOf(event.id, shown, toolName, e.input) });
            // The session waits idle for the result; the step shows first, then the tool runs.
            const toolUseId = event.id;
            if (event.type === 'agent.custom_tool_use' && toolUseId && !answeredTools.has(toolUseId))
              return { update: { ...at, events }, afterward: () => runTool(c, id, toolUseId, toolName, e.input, both) };
            return { update: { ...at, events } };
          }
          case 'agent.tool_result':
          case 'agent.mcp_tool_result':
          case 'user.custom_tool_result': {
            const toolId = String(e.tool_use_id ?? e.mcp_tool_use_id ?? e.custom_tool_use_id ?? '');
            const output = textOf(e.content);
            const events: AgentEvent[] = [
              {
                type: 'tool-end',
                ...(toolId ? { id: toolId } : {}),
                ...(tools.has(toolId) ? { name: tools.get(toolId)! } : {}),
                ...(e.is_error ? { isError: true } : {}),
                ...(output ? { output } : {}),
              },
            ];
            return { update: { ...at, events } };
          }
          case 'user.message':
            // A new turn: an earlier turn's error does not explain how this one ends.
            lastError = undefined;
            return { update: at };
          case 'user.tool_confirmation':
            return {
              update: {
                ...at,
                events: [
                  {
                    type: 'approval-resolved',
                    id: String(e.tool_use_id),
                    decision: e.result === 'allow' ? 'approve' : 'deny',
                  },
                ],
              },
            };
          case 'session.error': {
            const error = sessionError(event);
            if (error.terminal) lastError = error;
            return { update: { ...at, events: [{ type: 'error', message: error.message }] } };
          }
          case 'session.usage': {
            const usage = (e.usage ?? {}) as AnthropicManagedSession['usage'];
            const tokens = usageOf(usage) ?? {};
            const cost = usage?.list_cost;
            const costUsd =
              cost && cost.currency === 'USD' && /^\d+$/.test(cost.amount) ? Number(cost.amount) / 100 : undefined;
            return {
              update: {
                ...at,
                events: [{ type: 'usage', usage: tokens, ...(costUsd !== undefined ? { costUsd } : {}) }],
              },
            };
          }
          case 'span.model_request_end': {
            // The session's running totals, for budgets checked as the run goes.
            const session = await retrieve(id, both);
            return session
              ? { update: { ...at, snapshot: snapshotOf(session, { state: 'running' }) } }
              : { update: at };
          }
          case 'session.status_running':
          case 'session.status_rescheduled':
            return {
              update: {
                ...at,
                snapshot: { id, state: 'running', vendorState: event.type.slice('session.status_'.length) },
              },
            };
          case 'session.status_idle': {
            // A watch that reconnected past the turn's error reads it back from the history.
            if ((e.stop_reason as { type?: string } | undefined)?.type === 'retries_exhausted' && !lastError)
              lastError = await turnError(id, both);
            const stop = stopOf(e, lastError);
            if (stop.stopReason === 'requires-action')
              return { update: { ...at, snapshot: { id, state: 'idle', vendorState: 'idle', ...stop } } };
            const session = await retrieve(id, both);
            const base = session ? snapshotOf(session) : { id };
            return {
              update: { ...at, snapshot: { ...base, state: 'idle', vendorState: 'idle', ...stop } },
              done: true,
            };
          }
          case 'session.status_terminated': {
            lastError ??= await turnError(id, both);
            const session = await retrieve(id, both);
            const failed = lastError;
            const snapshot: ManagedSnapshot = {
              ...(session ? snapshotOf(session) : { id }),
              state: failed ? 'failed' : 'completed',
              vendorState: 'terminated',
              ...(failed ? { error: failed.message, ...(failed.failure ? { failure: failed.failure } : {}) } : {}),
              endedAt: Date.now(),
            };
            return { update: { ...at, snapshot }, done: true };
          }
          case 'session.deleted':
            return { update: { ...at, snapshot: { id, state: 'cancelled', vendorState: 'deleted' } }, done: true };
          default:
            return event.id ? { update: at } : {};
        }
      };

      // A dropped connection ends the stream quietly: `managedAgent()` reads the state and reconnects.
      const dropped = (error: unknown) => failureOfError(error)?.kind === 'unavailable';

      /** Persisted events after `from` not seen yet; true once the session settled. */
      async function* replay(from: string | undefined): AsyncGenerator<ManagedUpdate, boolean> {
        const history: AnthropicManagedEvent[] = [];
        for await (const event of after(id, from, both)) if (!event.id || !seen.has(event.id)) history.push(event);
        // Custom tool calls the history already answered only show; they do not run again.
        for (const event of history) {
          if (event.type === 'user.custom_tool_result')
            answeredTools.add(String((event as { custom_tool_use_id?: unknown }).custom_tool_use_id));
          // Approvals the history already settled are not asked again.
          if (event.type === 'user.tool_confirmation')
            answeredTools.add(String((event as { tool_use_id?: unknown }).tool_use_id));
        }
        // Turns that later history continued are over: their idle is no end for this watch.
        const lastStart = history.findLastIndex((event) => TURN_STARTS.has(event.type));
        for (const [index, event] of history.entries()) {
          if (event.id) seen.add(event.id);
          const { update, done, afterward } = await translate(event);
          const past = index < lastStart && SESSION_STOPS.has(event.type);
          if (update) yield past ? { ...update, snapshot: undefined } : update;
          if (done && !past) return true;
          await afterward?.();
        }
        return false;
      }

      try {
        // Stream first, then history: nothing in between is lost, and duplicates are skipped by id.
        let stream: AsyncIterable<AnthropicManagedEvent> | undefined;
        try {
          stream = await c.beta.sessions.events.stream(
            id,
            options.textDeltas === false ? {} : { event_deltas: ['agent.message'] },
            { signal: both },
          );
        } catch (error) {
          if (signal.aborted || !dropped(error)) throw error;
        }
        if (yield* replay(cursor)) return;
        // No stream: what is persisted so far was read; `managedAgent()` checks the state and reconnects.
        if (!stream) return;
        const live = stream[Symbol.asyncIterator]();
        for (;;) {
          let next: IteratorResult<AnthropicManagedEvent>;
          try {
            next = await live.next();
          } catch (error) {
            if (signal.aborted || !dropped(error)) throw error;
            break;
          }
          if (next.done) break;
          const event = next.value;
          if (event.id && seen.has(event.id)) continue;
          if (event.id) seen.add(event.id);
          // Live previews of messages the history already holds are stale.
          if (event.type === 'event_delta' && seen.has(String((event as { event_id?: unknown }).event_id))) continue;
          const { update, done, afterward } = await translate(event);
          if (update) yield update;
          if (done) return;
          await afterward?.();
        }
        // The stream ended or dropped: what it missed is persisted, so read it before the state check.
        yield* replay(position);
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      } finally {
        local.abort();
      }
    },

    async send(id, text) {
      const c = await client();
      await c.beta.sessions.events.send(id, { events: [{ type: 'user.message', content: [{ type: 'text', text }] }] });
    },

    async answer(id, approvalId, decision, note) {
      const c = await client();
      await c.beta.sessions.events.send(id, {
        events: [
          {
            type: 'user.tool_confirmation',
            tool_use_id: approvalId,
            result: decision === 'approve' ? 'allow' : 'deny',
            ...(decision === 'deny' && note ? { deny_message: note } : {}),
          },
        ],
      });
    },

    async interrupt(id) {
      const c = await client();
      await c.beta.sessions.events.send(id, { events: [{ type: 'user.interrupt' }] });
      return { enforced: true };
    },

    async release(snapshot) {
      await freeAll(await client(), snapshot.release ?? []);
    },

    async delete(id) {
      const c = await client();
      try {
        await c.beta.sessions.delete(id);
      } catch (error) {
        if (statusOf(error) !== 404) throw error;
      }
    },
  };

  /** Run a custom tool and send its result; the result's echo on the stream closes the tool step. */
  async function runTool(
    c: AnthropicManagedClient,
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    const handler = options.tools?.[toolName];
    let text: string;
    let isError = false;
    try {
      if (!handler) throw new Error(`No handler for custom tool '${toolName}'.`);
      // A handler that ignores `signal` must not keep an aborted run from stopping the session.
      const result = await untilAbort(
        Promise.resolve(handler((input ?? {}) as Record<string, unknown>, { sessionId, signal })),
        signal,
      );
      if (result === ABORTED) return;
      text = result;
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
      isError = true;
    }
    if (signal.aborted) return;
    // A result that does not arrive leaves the session waiting: let the run fail on it.
    await c.beta.sessions.events.send(
      sessionId,
      {
        events: [
          {
            type: 'user.custom_tool_result',
            custom_tool_use_id: toolUseId,
            content: [{ type: 'text', text }],
            ...(isError ? { is_error: true } : {}),
          },
        ],
      },
      { signal },
    );
  }

  return provider;
}

const ABORTED = Symbol('aborted');

/** Events that begin work in a session. */
const TURN_STARTS = new Set(['user.message', 'session.status_running', 'session.status_rescheduled']);
/** Events that report the session stopped. */
const SESSION_STOPS = new Set(['session.status_idle', 'session.status_terminated']);

/** `work`'s value, or `ABORTED` as soon as `signal` aborts. */
function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function defaultClient(): Promise<AnthropicManagedClient> {
  const sdk = (await import('@anthropic-ai/sdk')) as unknown as { default: new () => unknown };
  const client = new sdk.default() as Partial<AnthropicManagedClient>;
  if (!client.beta?.sessions)
    throw new Error(
      'anthropicManaged needs an @anthropic-ai/sdk version with Managed Agents (beta.sessions): pass `client: new Anthropic()` from it.',
    );
  return client as AnthropicManagedClient;
}

/** The `agent` of `sessions.create`: the plain reference, or one with this run's overrides. */
async function agentFor(
  client: AnthropicManagedClient,
  ref: { id: string; version?: number },
  request: ManagedStart,
  signal?: AbortSignal,
): Promise<unknown> {
  const plain = ref.version !== undefined ? { type: 'agent', id: ref.id, version: ref.version } : ref.id;
  const servers = request.mcpServers ?? [];
  if (request.model === undefined && request.effort === undefined && !request.system && !servers.length) return plain;
  const agent = await client.beta.agents.retrieve(
    ref.id,
    ref.version !== undefined ? { version: ref.version } : undefined,
    signal ? { signal } : undefined,
  );
  const override: Record<string, unknown> = { type: 'agent_with_overrides', id: agent.id, version: agent.version };
  if (request.model !== undefined || request.effort !== undefined) {
    // An override replaces the model object whole: keep the agent's settings for the same model.
    const same = request.model === undefined || request.model === agent.model.id;
    const { effort: agentEffort, ...rest } = agent.model;
    const effort = request.effort ?? (same ? effortOf(agentEffort) : undefined);
    override.model = { ...(same ? rest : {}), id: request.model ?? agent.model.id, ...(effort ? { effort } : {}) };
  }
  if (request.system) override.system = agent.system ? `${agent.system}\n\n${request.system}` : request.system;
  const known = agent.mcp_servers ?? [];
  const added = [];
  for (const server of servers) {
    if (!('url' in server)) continue;
    const existing = known.find((s) => s.name === server.name);
    if (existing && existing.url !== server.url)
      throw new Error(`MCP server '${server.name}' is already on the agent with another URL (${existing.url}).`);
    if (!existing) added.push(server);
  }
  if (added.length) {
    override.mcp_servers = [
      ...known.map((s) => ({ type: 'url', name: s.name, url: s.url })),
      ...added.map((s) => ({ type: 'url', name: s.name, url: s.url })),
    ];
    // A tools override lists every tool; MCP tools keep the platform's default policy (ask).
    override.tools = [...(agent.tools ?? []), ...added.map((s) => ({ type: 'mcp_toolset', mcp_server_name: s.name }))];
  }
  return override;
}

/** MCP servers' bearer tokens, for the session's vault. Other headers cannot be vaulted. */
function bearers(
  name: string,
  servers: readonly McpServer[],
): { server: { name: string; url: string }; token: string }[] {
  const out = [];
  for (const server of servers) {
    if (!('url' in server) || !server.headers) continue;
    const entries = Object.entries(server.headers);
    if (!entries.length) continue;
    const [key, value] = entries[0];
    const token = /^Bearer\s+(.+)$/i.exec(value)?.[1];
    if (entries.length > 1 || key.toLowerCase() !== 'authorization' || !token)
      throw new Error(
        `${name} passes MCP credentials only as 'Authorization: Bearer ...'; '${server.name}' has other headers.`,
      );
    out.push({ server: { name: server.name, url: server.url }, token });
  }
  return out;
}

/** Fields a running session cannot change. */
function refusedOnResume(name: string, session: AnthropicManagedSession, request: ManagedStart): void {
  if (request.files?.length) throw new Error(`${name} mounts files only when a session starts.`);
  const model = session.agent?.model;
  if (request.model !== undefined && model && request.model !== model.id)
    throw new Error(`${name} session ${session.id} runs ${model.id}; its model cannot change.`);
  if (request.effort !== undefined && model && request.effort !== effortOf(model.effort))
    throw new Error(
      `${name} session ${session.id} runs at effort '${effortOf(model.effort) ?? 'default'}'; it cannot change.`,
    );
  for (const server of request.mcpServers ?? []) {
    if (!('url' in server)) continue;
    if (server.headers && Object.keys(server.headers).length)
      throw new Error(`${name} attaches MCP credentials only when a session starts ('${server.name}').`);
    if (!session.agent?.mcp_servers?.some((s) => s.url === server.url))
      throw new Error(
        `${name} session ${session.id} has no MCP server at ${server.url}; servers are set when it starts.`,
      );
  }
}

async function freeAll(client: AnthropicManagedClient, refs: readonly string[]): Promise<void> {
  await Promise.allSettled(
    refs.map((ref) =>
      ref.startsWith('vault:')
        ? client.beta.vaults.delete(ref.slice(6))
        : ref.startsWith('file:')
          ? client.beta.files.delete(ref.slice(5))
          : undefined,
    ),
  );
}

/** `https://github.com/owner/repo[.git][#branch]`. */
function githubWorkspace(workspace: string | undefined): { url: string; branch?: string } | undefined {
  const match = workspace && /^(https:\/\/github\.com\/[^/\s#]+\/[^/\s#]+?)(?:\.git)?\/?(?:#(.+))?$/.exec(workspace);
  return match ? { url: match[1], ...(match[2] ? { branch: match[2] } : {}) } : undefined;
}

interface SessionError {
  message: string;
  /** No more retries: the session stops on it. */
  terminal: boolean;
  failure?: AgentFailure;
}

function sessionError(event: AnthropicManagedEvent): SessionError {
  const error = ((event as unknown as { error?: unknown }).error ?? {}) as {
    type?: string;
    message?: string;
    retry_status?: { type?: string };
  };
  const kind = error.type ?? 'error';
  const failure: AgentFailure | undefined =
    kind === 'model_rate_limited_error' || kind === 'billing_error'
      ? { kind: 'quota' }
      : kind === 'model_overloaded_error'
        ? { kind: 'unavailable' }
        : undefined;
  return {
    message: error.message ? `${kind}: ${error.message}` : kind,
    terminal: error.retry_status?.type !== 'retrying',
    ...(failure ? { failure } : {}),
  };
}

/** A `session.status_idle` event's reason, normalized. */
function stopOf(
  event: Record<string, unknown>,
  lastError: SessionError | undefined,
): Pick<ManagedSnapshot, 'stopReason' | 'error' | 'failure'> {
  const reason = (event.stop_reason as { type?: string } | undefined)?.type;
  const details = event.stop_details as { explanation?: string | null } | null | undefined;
  const map: Record<string, ManagedStopReason> = {
    end_turn: 'end-turn',
    requires_action: 'requires-action',
    budget_reached: 'budget',
    retries_exhausted: 'error',
    refusal: 'error',
  };
  const stopReason = reason ? (map[reason] ?? reason) : 'end-turn';
  if (stopReason !== 'error') return { stopReason };
  const error =
    reason === 'refusal'
      ? `The model refused${details?.explanation ? `: ${details.explanation}` : '.'}`
      : (lastError?.message ?? 'Retries exhausted.');
  return { stopReason, error, ...(reason !== 'refusal' && lastError?.failure ? { failure: lastError.failure } : {}) };
}

function usageOf(usage: AnthropicManagedSession['usage']): ManagedUsage | undefined {
  if (!usage) return undefined;
  const details: Record<string, number> = {};
  const created =
    (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) + (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0);
  if (created) details.cacheCreationInputTokens = created;
  if (usage.active_seconds !== undefined) details.activeSeconds = usage.active_seconds;
  const out: ManagedUsage = {
    ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
    ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
    ...(usage.cache_read_input_tokens !== undefined ? { cachedInputTokens: usage.cache_read_input_tokens } : {}),
    ...(Object.keys(details).length ? { details } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

function approvalOf(id: string, shown: string, tool: string, input: unknown): ApprovalRequest {
  const args = (input ?? {}) as Record<string, unknown>;
  const path =
    typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : undefined;
  if (tool === 'bash' && typeof args.command === 'string')
    return { id, kind: 'command', summary: args.command, detail: input };
  if ((tool === 'write' || tool === 'edit') && shown === tool)
    return { id, kind: 'file-change', summary: path ?? tool, detail: input };
  return { id, kind: 'other', summary: shown, detail: input };
}

function effortOf(effort: AnthropicManagedModel['effort']): string | undefined {
  return typeof effort === 'string' ? effort : effort?.type;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: 'text'; text: string } => block?.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('');
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function formatCursor(time: string, id: string): string {
  return `${time}|${id}`;
}

function parseCursor(cursor: string | undefined): { time: string; id: string } | undefined {
  if (!cursor) return undefined;
  const at = cursor.lastIndexOf('|');
  return at > 0 ? { time: cursor.slice(0, at), id: cursor.slice(at + 1) } : undefined;
}
