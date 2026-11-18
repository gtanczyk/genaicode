import { posix } from 'node:path';
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
import type { AgentEvent, AgentFailure, CodingAgent } from '../types.js';
import { tokenCount } from '../usage.js';

/** A step of an interaction as the Interactions API reports it; the fields this driver reads. */
export interface GeminiInteractionStep {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  server_name?: string;
  arguments?: unknown;
  result?: unknown;
  is_error?: boolean;
  content?: unknown;
}

/** An interaction as the Interactions API reports it; the fields this driver reads. */
export interface GeminiInteraction {
  id: string;
  status: string;
  model?: string;
  created?: string;
  updated?: string;
  environment_id?: string;
  previous_interaction_id?: string;
  steps?: readonly GeminiInteractionStep[];
  errors?: readonly { code?: string; message?: string }[];
  usage?: GeminiUsage;
}

/** Token counts of one interaction. */
export interface GeminiUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  total_cached_tokens?: number;
  total_tool_use_tokens?: number;
  total_tokens?: number;
}

export interface GeminiManagedOptions {
  /** The agent every interaction runs: a built-in one or a saved agent's id. Default `antigravity-preview-09-2026`. */
  agent?: string;
  /** Gemini API key. Default: `GEMINI_API_KEY`, then `GOOGLE_API_KEY`. Not used with `agentPlatform`. */
  apiKey?: string | (() => string | Promise<string>);
  /** Run on Gemini Enterprise Agent Platform (Google Cloud) instead of the Gemini API. */
  agentPlatform?: {
    project: string;
    /** Default `global`. */
    location?: string;
    /** An OAuth access token for the project, e.g. from `google-auth-library`. Called before every request. */
    accessToken: string | (() => string | Promise<string>);
  };
  /** Overrides the API root (up to, not including, `/interactions`). */
  baseUrl?: string;
  /** Environment new sessions run in: `remote` (a fresh sandbox, the default) or an environment id to reuse. */
  environment?: string;
  /** Domains a fresh sandbox may reach (`*` for any). MCP server hosts are added. Default: the platform's own. */
  network?: readonly string[];
  /** The agent's tools when it also gets MCP servers, which replace its defaults. Default code execution, Google Search, URL context. */
  tools?: readonly Readonly<Record<string, unknown>>[];
  /** Where `ManagedStart.files` and a repository workspace land. Default `/workspace`. */
  filesRoot?: string;
  /** Stream assistant text as `text-delta` events while the model writes it. Default true. */
  textDeltas?: boolean;
  /** Fallback poll interval when the stream drops. Default 5 s. */
  pollIntervalMs?: number;
  /** Default: global `fetch`. */
  fetch?: typeof fetch;
  /** Provider name in events and results. Default `geminiManaged`. */
  name?: string;
}

const DEFAULT_AGENT = 'antigravity-preview-09-2026';
const API_REVISION = '2026-05-20';
const DEFAULT_TOOLS: readonly Record<string, unknown>[] = [
  { type: 'code_execution' },
  { type: 'google_search' },
  { type: 'url_context' },
];

/** Gemini Managed Agents (Antigravity) as a `CodingAgent`: interactions on Google's agent loop and sandbox. */
export function geminiManaged(options: GeminiManagedOptions = {}): CodingAgent {
  return managedAgent(geminiManagedProvider(options), {
    ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
  });
}

/**
 * Gemini Managed Agents as a `ManagedProvider`. Every turn is an interaction of its own, chained to
 * the one before: a snapshot's `id` is the latest interaction, and `usage` adds up the whole chain.
 */
export function geminiManagedProvider(options: GeminiManagedOptions = {}): ManagedProvider {
  const name = options.name ?? 'geminiManaged';
  const agent = options.agent ?? DEFAULT_AGENT;
  const builtIn = agent.startsWith('antigravity-');
  const filesRoot = options.filesRoot ?? '/workspace';
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const platform = options.agentPlatform;
  const rootUrl =
    options.baseUrl ??
    (platform
      ? `https://${hostOf(platform.location ?? 'global')}/v1beta1/projects/${encodeURIComponent(platform.project)}/locations/${encodeURIComponent(platform.location ?? 'global')}`
      : 'https://generativelanguage.googleapis.com/v1beta');
  const root = trimSlashes(rootUrl);

  const auth = async (): Promise<Record<string, string>> => {
    if (platform) {
      const token = typeof platform.accessToken === 'function' ? await platform.accessToken() : platform.accessToken;
      return { authorization: `Bearer ${token}` };
    }
    const key =
      (typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey) ??
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_API_KEY;
    if (!key) throw new Error(`${name} needs an API key: options.apiKey or GEMINI_API_KEY.`);
    return { 'x-goog-api-key': key };
  };

  /** One request; `null` on 404. */
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    accept?: string,
  ): Promise<Response | null> => {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        ...(await auth()),
        'api-revision': API_REVISION,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accept ? { accept } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok) throw await apiError(name, method, path, response);
    return response;
  };

  const json = async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T | null> => {
    const response = await request(method, path, body, signal);
    if (!response) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  };

  const interaction = (id: string, signal?: AbortSignal) =>
    json<GeminiInteraction>('GET', `/interactions/${encodeURIComponent(id)}`, undefined, signal);

  // Usage through a settled interaction, its chain included: settled interactions do not change.
  const through = new Map<string, ManagedUsage | undefined>();

  /** What the interactions before this one used, all the way back. */
  const before = async (previous: string | undefined, signal?: AbortSignal): Promise<ManagedUsage | undefined> => {
    const chain: GeminiInteraction[] = [];
    let total: ManagedUsage | undefined;
    for (let id = previous; id && chain.length < 500; ) {
      if (through.has(id)) {
        total = through.get(id);
        break;
      }
      const earlier = await interaction(id, signal);
      // Deleted or expired: what came before it is no longer known.
      if (!earlier) break;
      chain.push(earlier);
      id = earlier.previous_interaction_id;
    }
    for (const earlier of chain.reverse()) {
      total = addUsage(total, usageOf(earlier.usage));
      if (stateOf(earlier.status).state !== 'running') through.set(earlier.id, total);
    }
    return total;
  };

  const snapshotOf = async (found: GeminiInteraction, signal?: AbortSignal): Promise<ManagedSnapshot> => {
    const usage = addUsage(await before(found.previous_interaction_id, signal), usageOf(found.usage));
    const { state, stopReason } = stateOf(found.status);
    const text = lastText(found.steps);
    const created = found.created ? Date.parse(found.created) : NaN;
    const updated = found.updated ? Date.parse(found.updated) : NaN;
    const failed = state === 'failed' ? errorOf(found) : undefined;
    return {
      id: found.id,
      state,
      ...(stopReason ? { stopReason } : {}),
      vendorState: found.status,
      ...(found.model ? { model: found.model } : {}),
      ...(usage ? { usage } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(failed ? { error: failed.message, ...(failed.failure ? { failure: failed.failure } : {}) } : {}),
      ...(Number.isFinite(created) ? { startedAt: created } : {}),
      ...(state !== 'running' && Number.isFinite(updated) ? { endedAt: updated } : {}),
    };
  };

  /** The `environment` field of a new session: an id to reuse, or a fresh sandbox's config. */
  const environmentOf = (start: ManagedStart): string | Record<string, unknown> => {
    const reuse = /^env_/.test(start.workspace ?? '')
      ? start.workspace!
      : options.environment && options.environment !== 'remote'
        ? options.environment
        : undefined;
    if (reuse) {
      if (start.files?.length) throw new Error(`${name} cannot add files to an existing environment (${reuse}).`);
      return reuse;
    }
    const sources: Record<string, unknown>[] = [];
    const repo = repositoryOf(start.workspace);
    if (repo) {
      if (repo.branch) throw new Error(`${name} clones a repository's default branch only (got '#${repo.branch}').`);
      sources.push({ type: 'repository', source: repo.url, target: posix.join(filesRoot, repo.name) });
    }
    for (const file of start.files ?? []) {
      const path = posix.normalize(file.path);
      if (path.startsWith('..') || posix.isAbsolute(path))
        throw new Error(`${name}: file path '${file.path}' leaves the workspace.`);
      sources.push({ type: 'inline', target: posix.join(filesRoot, path), content: textContent(name, file) });
    }
    const hosts = new Set(options.network ?? []);
    if (options.network) for (const server of remoteServers(start)) hosts.add(new URL(server.url).hostname);
    const network = options.network ? { network: { allowlist: [...hosts].map((domain) => ({ domain })) } } : {};
    return sources.length || options.network
      ? { type: 'remote', ...(sources.length ? { sources } : {}), ...network }
      : 'remote';
  };

  // Step state per interaction, kept across reconnects: a resumed stream goes on mid-step.
  const streams = new Map<string, Map<number, StepState>>();

  const provider: ManagedProvider = {
    name,
    capabilities: {
      usage: true,
      mcp: true,
      resume: true,
      files: true,
      // A saved agent's agent_config is fixed: no per-interaction cap; `managedAgent()` checks usage itself.
      budget: builtIn ? ['tokens'] : [],
      // The agent runs its tools without asking.
      permissions: { approval: ['auto-approve'] },
    },

    async start(start, signal) {
      if (start.maxTurns !== undefined) throw new Error(`${name} cannot cap turns (maxTurns).`);
      if (start.extraArgs?.length) throw new Error(`${name} takes no extra arguments.`);
      if (start.effort !== undefined) throw new Error(`${name} takes no effort setting.`);
      if (start.model !== undefined && !builtIn)
        throw new Error(`${name}: the saved agent '${agent}' has a fixed model; drop 'model'.`);
      let environment: string | Record<string, unknown>;
      let spent: ManagedUsage | undefined;
      if (start.resume !== undefined) {
        const prior = await interaction(start.resume, signal);
        if (!prior) throw new Error(`${name}: interaction '${start.resume}' not found.`);
        if (stateOf(prior.status).state === 'running')
          throw new Error(`${name}: interaction '${start.resume}' is still running; resume it once it settles.`);
        if (!prior.environment_id)
          throw new Error(`${name}: interaction '${start.resume}' has no environment to resume in.`);
        if (start.files?.length) throw new Error(`${name} cannot add files when resuming: the environment exists.`);
        environment = prior.environment_id;
        spent = addUsage(await before(prior.previous_interaction_id, signal), usageOf(prior.usage));
      } else environment = environmentOf(start);

      const servers = remoteServers(start);
      for (const server of servers)
        if (!/^[a-z0-9_-]+$/.test(server.name))
          throw new Error(`${name}: MCP server name '${server.name}' must match ^[a-z0-9_-]+$.`);
      const tools = servers.length
        ? [
            ...(options.tools ?? DEFAULT_TOOLS),
            ...servers.map((server) => ({
              type: 'mcp_server',
              name: server.name,
              url: server.url,
              ...(server.headers && Object.keys(server.headers).length ? { headers: { ...server.headers } } : {}),
            })),
          ]
        : options.tools;
      // The platform caps each interaction; the budget it gets counts the whole session.
      const maxTokens =
        start.budget?.maxTokens !== undefined && builtIn
          ? Math.max(1, Math.floor(start.budget.maxTokens - (spent ? tokenCount(spent) : 0)))
          : undefined;
      const config = {
        ...(start.model !== undefined ? { model: start.model } : {}),
        ...(maxTokens !== undefined ? { max_total_tokens: String(maxTokens) } : {}),
      };
      const created = await json<GeminiInteraction>(
        'POST',
        '/interactions',
        {
          agent,
          input: start.prompt,
          background: true,
          store: true,
          environment,
          ...(start.resume !== undefined ? { previous_interaction_id: start.resume } : {}),
          ...(start.system ? { system_instruction: start.system } : {}),
          ...(tools?.length ? { tools } : {}),
          ...(Object.keys(config).length ? { agent_config: { type: 'antigravity', ...config } } : {}),
        },
        signal,
      );
      if (!created?.id) throw new Error(`${name} returned no interaction.`);
      const snapshot = await snapshotOf(created, signal);
      // Fresh from create: the turn has not been read yet, whatever state the platform reported.
      return { ...snapshot, state: snapshot.state === 'running' ? 'queued' : snapshot.state };
    },

    async get(id, signal) {
      const found = await interaction(id, signal);
      return found ? snapshotOf(found, signal) : null;
    },

    async *watch(id, signal, cursor) {
      let position = cursor;
      const steps = streams.get(id) ?? new Map<number, StepState>();
      streams.set(id, steps);
      const tools = new Map<string, string>();
      for (const step of steps.values()) if (step.callId) tools.set(step.callId, step.shown);
      let spent: ManagedUsage | undefined;
      let spentRead = false;
      const sessionUsage = async (usage: GeminiUsage): Promise<AgentEvent | undefined> => {
        if (!spentRead) {
          const found = await interaction(id, signal);
          spent = found ? await before(found.previous_interaction_id, signal) : undefined;
          spentRead = true;
        }
        const total = addUsage(spent, usageOf(usage));
        return total ? { type: 'usage', usage: total } : undefined;
      };

      // A drop, or an end without the interaction's end, reconnects from the last event: a turn
      // that settled meanwhile still has its last steps to read. Gives up after a few empty tries.
      for (let tries = 0; tries < 3 && !signal.aborted; tries++) {
        if (tries) await pause(250 * tries, signal);
        const query = `?stream=true${position ? `&last_event_id=${encodeURIComponent(position)}` : ''}`;
        let response: Response | null;
        try {
          response = await request(
            'GET',
            `/interactions/${encodeURIComponent(id)}${query}`,
            undefined,
            signal,
            'text/event-stream',
          );
        } catch (error) {
          if (signal.aborted || failureOfError(error)?.kind === 'unavailable') continue;
          throw error;
        }
        // Gone: `get` reports it.
        if (!response?.body) return;
        try {
          for await (const message of sse(response.body)) {
            if (signal.aborted) return;
            if (message.data === '[DONE]') break;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(message.data) as Record<string, unknown>;
            } catch {
              continue;
            }
            const eventId = typeof event.event_id === 'string' ? event.event_id : message.id;
            if (eventId && eventId !== position) {
              position = eventId;
              tries = -1;
            }
            const at = position ? { cursor: position } : {};
            const type = String(event.event_type ?? message.event ?? '');
            const events: AgentEvent[] = [];
            if (type === 'step.start') {
              const index = Number(event.index);
              const step = (event.step ?? {}) as GeminiInteractionStep;
              const state = stepState(step);
              steps.set(index, state);
              const text = textOf(step.content);
              if (step.type === 'model_output' && text) {
                state.text = text;
                if (options.textDeltas !== false) events.push({ type: 'text-delta', text });
              }
            } else if (type === 'step.delta') {
              const state = steps.get(Number(event.index));
              const delta = (event.delta ?? {}) as Record<string, unknown>;
              if (state && delta.type === 'text' && typeof delta.text === 'string') {
                state.text += delta.text;
                if (options.textDeltas !== false && state.type === 'model_output')
                  events.push({ type: 'text-delta', text: delta.text });
              } else if (state && delta.type === 'arguments_delta' && typeof delta.arguments === 'string')
                state.argumentsText += delta.arguments;
              else if (state && 'result' in delta) state.result = delta.result;
              else if (state && typeof delta.is_error === 'boolean') state.isError = delta.is_error;
            } else if (type === 'step.stop') {
              const index = Number(event.index);
              const state = steps.get(index);
              steps.delete(index);
              if (state) events.push(...stepEvents(state, tools));
              if (event.usage) {
                const usage = await sessionUsage(event.usage as GeminiUsage);
                if (usage) events.push(usage);
              }
            } else if (type === 'interaction.completed' || type === 'interaction.complete') {
              const found = await provider.get(id, signal);
              if (found && found.state !== 'running') {
                streams.delete(id);
                yield { ...at, ...(events.length ? { events } : {}), snapshot: found };
                return;
              }
            } else if (type === 'done') break;
            // `error`: the stream ends after it; `get` tells whether the interaction failed.
            if (events.length || eventId) yield { ...at, ...(events.length ? { events } : {}) } satisfies ManagedUpdate;
          }
        } catch (error) {
          if (signal.aborted) return;
          if (failureOfError(error)?.kind !== 'unavailable') throw error;
        }
      }
    },

    async interrupt(id) {
      try {
        const response = await request('POST', `/interactions/${encodeURIComponent(id)}/cancel`);
        await response?.body?.cancel().catch(() => undefined);
        return { enforced: !!response };
      } catch {
        return { enforced: false };
      }
    },

    async delete(id) {
      const response = await request('DELETE', `/interactions/${encodeURIComponent(id)}`);
      await response?.body?.cancel().catch(() => undefined);
      streams.delete(id);
    },
  };
  return provider;
}

interface StepState {
  type: string;
  callId?: string;
  shown: string;
  arguments?: unknown;
  argumentsText: string;
  text: string;
  result?: unknown;
  isError?: boolean;
}

function stepState(step: GeminiInteractionStep): StepState {
  const kind = step.type.replace(/_(call|result)$/, '');
  const shown =
    step.type === 'mcp_server_tool_call' || step.type === 'mcp_server_tool_result'
      ? `${step.server_name ?? 'mcp'}.${step.name ?? 'tool'}`
      : (step.name ?? kind);
  return {
    type: step.type,
    ...((step.id ?? step.call_id) ? { callId: step.id ?? step.call_id } : {}),
    shown,
    ...(step.arguments !== undefined ? { arguments: step.arguments } : {}),
    argumentsText: '',
    text: '',
    ...(step.result !== undefined ? { result: step.result } : {}),
    ...(step.is_error !== undefined ? { isError: step.is_error } : {}),
  };
}

/** A finished step as events: the agent's message, a tool call or its result. */
function stepEvents(state: StepState, tools: Map<string, string>): AgentEvent[] {
  if (state.type === 'model_output') return state.text ? [{ type: 'message', text: state.text }] : [];
  if (state.type.endsWith('_call')) {
    let input = state.arguments;
    if (state.argumentsText) {
      try {
        input = JSON.parse(state.argumentsText);
      } catch {
        input = state.argumentsText;
      }
    }
    if (state.callId) tools.set(state.callId, state.shown);
    return [
      {
        type: 'tool-start',
        ...(state.callId ? { id: state.callId } : {}),
        name: state.shown,
        ...(input !== undefined ? { input } : {}),
      },
    ];
  }
  if (state.type.endsWith('_result')) {
    const output = state.result === undefined ? '' : textOf(state.result);
    const shown = state.callId ? tools.get(state.callId) : undefined;
    return [
      {
        type: 'tool-end',
        ...(state.callId ? { id: state.callId } : {}),
        ...(shown ? { name: shown } : {}),
        ...(state.isError ? { isError: true } : {}),
        ...(output ? { output } : {}),
      },
    ];
  }
  return [];
}

/** An interaction's status as a managed state. */
function stateOf(status: string): { state: ManagedState; stopReason?: ManagedStopReason } {
  switch (status) {
    case 'in_progress':
    case 'created':
    case 'queued':
      return { state: 'running' };
    // Waiting for the client: this driver sends no client-side functions, so it is the agent's question.
    case 'requires_action':
    case 'completed':
      return { state: 'idle', stopReason: 'end-turn' };
    case 'incomplete':
    case 'budget_exceeded':
      return { state: 'idle', stopReason: 'budget' };
    case 'failed':
      return { state: 'failed', stopReason: 'error' };
    case 'cancelled':
      return { state: 'cancelled' };
    default:
      return { state: 'idle', stopReason: status };
  }
}

function errorOf(found: GeminiInteraction): { message: string; failure?: AgentFailure } {
  const first = found.errors?.find((error) => error.message || error.code);
  const message = first?.message ?? first?.code ?? 'Interaction failed.';
  const code = (first?.code ?? '').toLowerCase();
  const failure: AgentFailure | undefined = /resource_exhausted|quota|rate_limit/.test(code)
    ? { kind: 'quota' }
    : /unavailable|timeout|deadline|internal/.test(code)
      ? { kind: 'unavailable' }
      : /unauthenticated|permission_denied/.test(code)
        ? { kind: 'auth' }
        : undefined;
  return { message, ...(failure ? { failure } : {}) };
}

function usageOf(usage: GeminiUsage | undefined): ManagedUsage | undefined {
  if (!usage) return undefined;
  const thought = usage.total_thought_tokens;
  const toolUse = usage.total_tool_use_tokens;
  const output =
    usage.total_output_tokens !== undefined || thought !== undefined
      ? (usage.total_output_tokens ?? 0) + (thought ?? 0)
      : undefined;
  const details: Record<string, number> = {
    ...(thought !== undefined ? { thoughtTokens: thought } : {}),
    ...(toolUse !== undefined ? { toolUseTokens: toolUse } : {}),
  };
  const out: ManagedUsage = {
    ...(usage.total_input_tokens !== undefined ? { inputTokens: usage.total_input_tokens } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {}),
    ...(usage.total_cached_tokens !== undefined ? { cachedInputTokens: usage.total_cached_tokens } : {}),
    ...(Object.keys(details).length ? { details } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** Two usage reports added up, details included. */
function addUsage(a: ManagedUsage | undefined, b: ManagedUsage | undefined): ManagedUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  const out: ManagedUsage = {};
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const) {
    const value = sum(a[key], b[key]);
    if (value !== undefined) out[key] = value;
  }
  out.totalTokens = tokenCount(a) + tokenCount(b);
  const details: Record<string, number> = { ...a.details };
  for (const [key, value] of Object.entries(b.details ?? {})) details[key] = (details[key] ?? 0) + value;
  if (Object.keys(details).length) out.details = details;
  return out;
}

function lastText(steps: readonly GeminiInteractionStep[] | undefined): string | undefined {
  for (let i = (steps?.length ?? 0) - 1; i >= 0; i--) {
    if (steps![i].type !== 'model_output') continue;
    const text = textOf(steps![i].content);
    if (text) return text;
  }
  return undefined;
}

function textOf(content: unknown): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
          ? String((part as { text?: unknown }).text ?? '')
          : typeof part === 'string'
            ? part
            : '',
      )
      .join('');
  if (typeof content === 'object' && Array.isArray((content as { content?: unknown }).content))
    return textOf((content as { content: unknown }).content);
  return JSON.stringify(content);
}

function textContent(name: string, file: { path: string; content: string | Uint8Array }): string {
  if (typeof file.content === 'string') return file.content;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file.content);
  } catch {
    throw new Error(`${name} takes text files only; '${file.path}' is binary.`);
  }
}

function remoteServers(
  start: ManagedStart,
): { name: string; url: string; headers?: Readonly<Record<string, string>> }[] {
  return (start.mcpServers ?? []).filter((server): server is { name: string; url: string } => 'url' in server);
}

/** `https://github.com/owner/repo[#branch]` (also GitLab, Bitbucket) or any `https://.../name.git`. */
function repositoryOf(workspace: string | undefined): { url: string; name: string; branch?: string } | undefined {
  if (!workspace?.startsWith('https://') || /\s/.test(workspace)) return undefined;
  const hash = workspace.indexOf('#');
  const url = trimSlashes(hash < 0 ? workspace : workspace.slice(0, hash));
  const branch = hash < 0 ? '' : workspace.slice(hash + 1);
  if (!/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+$/.test(url) && !url.endsWith('.git'))
    return undefined;
  return { url, name: posix.basename(url).replace(/\.git$/, ''), ...(branch ? { branch } : {}) };
}

/** Without trailing slashes (a loop: a regular expression is slow on long runs of them). */
function trimSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

function hostOf(location: string): string {
  return location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
}

class GeminiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GeminiApiError';
  }
}

async function apiError(name: string, method: string, path: string, response: Response): Promise<GeminiApiError> {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      detail = parsed.error?.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    // The status says enough.
  }
  const route = path.split('?')[0];
  return new GeminiApiError(
    `${name}: ${method} ${route} failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    response.status,
  );
}

/** Server-sent events from a response body. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; id?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
        const message = parseBlock(block);
        if (message) yield message;
      }
      if (done) {
        const message = parseBlock(buffer);
        if (message) yield message;
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseBlock(block: string): { event?: string; id?: string; data: string } | undefined {
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { ...(event ? { event } : {}), ...(id ? { id } : {}), data: data.join('\n') } : undefined;
}
