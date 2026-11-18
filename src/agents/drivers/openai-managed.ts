import {
  managedAgent,
  type ManagedEventPage,
  type ManagedProvider,
  type ManagedSnapshot,
  type ManagedStart,
  type ManagedState,
  type ManagedStopReason,
  type ManagedUsage,
} from '../managed.js';
import type { AgentEvent, AgentFailure, CodingAgent } from '../types.js';
import { addUsage, httpError, remoteServers, textOf, trimSlashes } from './managed-http.js';

/** An output item of a response; the fields this driver reads. */
export interface OpenAiResponseItem {
  type: string;
  id?: string;
  call_id?: string;
  status?: string;
  role?: string;
  name?: string;
  server_label?: string;
  arguments?: unknown;
  output?: unknown;
  error?: unknown;
  action?: unknown;
  code?: string;
  outputs?: unknown;
  content?: unknown;
}

/** A response as the Responses API reports it; the fields this driver reads. */
export interface OpenAiResponse {
  id: string;
  status?: string;
  model?: string;
  created_at?: number;
  completed_at?: number | null;
  previous_response_id?: string | null;
  output?: readonly OpenAiResponseItem[];
  /** The tools the response was created with. */
  tools?: readonly Readonly<Record<string, unknown>>[];
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string | null } | null;
  usage?: OpenAiUsage | null;
}

/** Token counts of one response. */
export interface OpenAiUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number } | null;
  output_tokens_details?: { reasoning_tokens?: number } | null;
}

export interface OpenAiManagedOptions {
  /** Default model when the task names none. One of them must. */
  model?: string;
  /** Default: `OPENAI_API_KEY`. */
  apiKey?: string | (() => string | Promise<string>);
  /** Default `https://api.openai.com/v1`. */
  baseUrl?: string;
  /** Hosted tools every response gets. Default: a hosted shell in a container kept for the session, and web search. */
  tools?: readonly Readonly<Record<string, unknown>>[];
  /** Domains the default shell's container may reach, set when it is made. Default: no network. */
  network?: readonly string[];
  /** Minutes the default shell's container lives after its last use. Default 20; resuming later fails. */
  containerMinutes?: number;
  /** Delay between polls. Default 3 s. */
  pollIntervalMs?: number;
  /** Default: global `fetch`. */
  fetch?: typeof fetch;
  /** Provider name in events and results. Default `openaiManaged`. */
  name?: string;
}

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

/** OpenAI's hosted agent loop as a `CodingAgent`: background responses with hosted tools. */
export function openaiManaged(options: OpenAiManagedOptions = {}): CodingAgent {
  return managedAgent(openaiManagedProvider(options), { pollIntervalMs: options.pollIntervalMs ?? 3_000 });
}

/**
 * OpenAI background responses as a `ManagedProvider`. Every turn is a response of its own, chained
 * to the one before: a snapshot's `id` is the latest response, and `usage` adds up the whole chain.
 * Responses are polled: output items come as whole events, not streamed text.
 */
export function openaiManagedProvider(options: OpenAiManagedOptions = {}): ManagedProvider {
  const name = options.name ?? 'openaiManaged';
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const root = trimSlashes(options.baseUrl ?? 'https://api.openai.com/v1');

  const auth = async (): Promise<Record<string, string>> => {
    const key =
      (typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey) ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error(`${name} needs an API key: options.apiKey or OPENAI_API_KEY.`);
    return { authorization: `Bearer ${key}` };
  };

  /** One JSON request; `null` on 404. */
  const json = async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T | null> => {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: { ...(await auth()), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok) throw await httpError(name, method, path, response);
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  };

  const retrieve = (id: string, signal?: AbortSignal) =>
    json<OpenAiResponse>('GET', `/responses/${encodeURIComponent(id)}`, undefined, signal);

  // Usage through a settled response, its chain included: settled responses do not change.
  const through = new Map<string, ManagedUsage | undefined>();

  /** What the responses before this one used, all the way back. */
  const before = async (previous: string | null | undefined, signal?: AbortSignal) => {
    const chain: OpenAiResponse[] = [];
    let total: ManagedUsage | undefined;
    for (let id = previous ?? undefined; id && chain.length < 500; ) {
      if (through.has(id)) {
        total = through.get(id);
        break;
      }
      const earlier = await retrieve(id, signal);
      // Deleted or expired: what came before it is no longer known.
      if (!earlier) break;
      chain.push(earlier);
      id = earlier.previous_response_id ?? undefined;
    }
    for (const earlier of chain.reverse()) {
      total = addUsage(total, usageOf(earlier.usage));
      if (!running(earlier.status)) through.set(earlier.id, total);
    }
    return total;
  };

  const snapshotOf = async (found: OpenAiResponse, signal?: AbortSignal): Promise<ManagedSnapshot> => {
    const usage = addUsage(await before(found.previous_response_id, signal), usageOf(found.usage));
    const { state, stopReason, error, failure } = stateOf(found);
    // Only once settled: before that, `events` reports messages in order.
    const text = running(found.status) ? undefined : lastText(found.output);
    return {
      id: found.id,
      state,
      ...(stopReason ? { stopReason } : {}),
      ...(found.status ? { vendorState: found.status } : {}),
      ...(found.model ? { model: found.model } : {}),
      ...(usage ? { usage } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(error ? { error } : {}),
      ...(failure ? { failure } : {}),
      ...(found.created_at ? { startedAt: found.created_at * 1000 } : {}),
      ...(found.completed_at ? { endedAt: found.completed_at * 1000 } : {}),
    };
  };

  /** The tools of a response; the default shell runs in `container` (`container_reference`). */
  const toolsOf = (start: ManagedStart, container: string | undefined): Record<string, unknown>[] => {
    const tools: Record<string, unknown>[] = options.tools
      ? options.tools.map((tool) => ({ ...tool }))
      : [
          {
            type: 'shell',
            environment: {
              type: 'container_reference',
              container_id: container,
            },
          },
          { type: 'web_search' },
        ];
    for (const server of remoteServers(start)) {
      const headers: Record<string, string> = { ...server.headers };
      // The platform takes a bearer token in `authorization`; it drops other headers on tool calls.
      const key = Object.keys(headers).find((header) => header.toLowerCase() === 'authorization');
      const bearer = key ? bearerToken(headers[key]) : undefined;
      if (key && !bearer) throw new Error(`${name}: MCP server '${server.name}' takes only a Bearer authorization.`);
      if (key) delete headers[key];
      if (Object.keys(headers).length)
        throw new Error(`${name}: MCP server '${server.name}' takes no headers besides Authorization: Bearer.`);
      tools.push({
        type: 'mcp',
        server_label: server.name,
        server_url: server.url,
        // The agent cannot stop for an approval: a paused response would need a new one to answer it.
        require_approval: 'never',
        ...(bearer ? { authorization: bearer } : {}),
      });
    }
    return tools;
  };

  return {
    name,
    // The Responses API has no list operation: a response is reached by its id only.
    sessions: null,
    capabilities: {
      usage: true,
      mcp: true,
      resume: true,
      maxTurns: true,
      effort: EFFORTS,
      // Tool calls run without asking.
      permissions: { approval: ['auto-approve'] },
    },

    async start(start, signal) {
      if (start.extraArgs?.length) throw new Error(`${name} takes no extra arguments.`);
      if (start.files?.length) throw new Error(`${name} cannot take start files.`);
      const model = start.model ?? options.model;
      if (!model) throw new Error(`${name} needs a model: options.model or task.model.`);
      // The default shell keeps its files in one container for the whole session: the one given as
      // the workspace, else the one the resumed response used, else a new one.
      let container = /^cntr_/.test(start.workspace ?? '') ? start.workspace : undefined;
      // A container's network policy is set when it is made; one made elsewhere keeps its own.
      if (container && options.network && !options.tools)
        throw new Error(
          `${name}: 'network' applies to containers it makes; container '${container}' has its own policy.`,
        );
      let made: string | undefined;
      if (start.resume !== undefined) {
        const prior = await retrieve(start.resume, signal);
        if (!prior) throw new Error(`${name}: response '${start.resume}' not found.`);
        if (running(prior.status))
          throw new Error(`${name}: response '${start.resume}' is still running; resume it once it settles.`);
        if (!options.tools && !container) {
          container = containerOf(prior);
          if (container) {
            const found = await json<{ status?: string }>(
              'GET',
              `/containers/${encodeURIComponent(container)}`,
              undefined,
              signal,
            );
            if (!found || found.status === 'expired')
              throw new Error(
                `${name}: container '${container}' of response '${start.resume}' has expired, and its files with it.`,
              );
          }
        }
      }
      if (!options.tools && !container) {
        const created = await json<{ id?: string }>(
          'POST',
          '/containers',
          {
            name: `genaicode ${start.correlationId ?? 'session'}`.slice(0, 64),
            expires_after: { anchor: 'last_active_at', minutes: options.containerMinutes ?? 20 },
            ...(options.network
              ? { network_policy: { type: 'allowlist', allowed_domains: [...options.network] } }
              : {}),
          },
          signal,
        );
        if (!created?.id) throw new Error(`${name} could not create a container.`);
        container = made = created.id;
      }
      let created: OpenAiResponse | null;
      try {
        created = await json<OpenAiResponse>(
          'POST',
          '/responses',
          {
            model,
            input: start.prompt,
            background: true,
            store: true,
            tools: toolsOf(start, container),
            ...(start.resume !== undefined ? { previous_response_id: start.resume } : {}),
            ...(start.system ? { instructions: start.system } : {}),
            ...(start.effort !== undefined ? { reasoning: { effort: start.effort } } : {}),
            ...(start.maxTurns !== undefined ? { max_tool_calls: start.maxTurns } : {}),
            ...(start.correlationId ? { metadata: { correlation_id: start.correlationId.slice(0, 512) } } : {}),
          },
          signal,
        );
      } catch (error) {
        // Nothing started in it: do not leave the new container waiting to expire.
        if (made) await json('DELETE', `/containers/${encodeURIComponent(made)}`).catch(() => undefined);
        throw error;
      }
      if (!created?.id) throw new Error(`${name} returned no response.`);
      const snapshot = await snapshotOf(created, signal);
      // Fresh from create, even when already settled: its items are read through `events`.
      const fresh: ManagedSnapshot = { ...snapshot, state: 'queued', cursor: '0' };
      for (const key of ['stopReason', 'endedAt', 'error', 'failure', 'text'] as const) delete fresh[key];
      return fresh;
    },

    async get(id, signal) {
      const found = await retrieve(id, signal);
      return found ? snapshotOf(found, signal) : null;
    },

    async events(id, cursor, signal): Promise<ManagedEventPage> {
      const found = await retrieve(id, signal);
      const from = Number(cursor ?? 0) || 0;
      if (!found) return { events: [], cursor: String(from) };
      const items = found.output ?? [];
      const settled = !running(found.status);
      const events: AgentEvent[] = [];
      let next = from;
      // In order, up to the first item still being written; all of them once the response settled.
      while (next < items.length && (settled || itemDone(items[next]))) events.push(...itemEvents(items[next++]));
      return { events, cursor: String(next), snapshot: await snapshotOf(found, signal) };
    },

    async interrupt(id) {
      try {
        const cancelled = await json<OpenAiResponse>('POST', `/responses/${encodeURIComponent(id)}/cancel`);
        return { enforced: !!cancelled };
      } catch {
        // A response that already finished cannot be cancelled.
        return { enforced: false };
      }
    },

    async delete(id) {
      await json('DELETE', `/responses/${encodeURIComponent(id)}`);
    },
  };
}

/** The token of `Bearer <token>`, parsed without a regular expression (slow on long runs of spaces). */
function bearerToken(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.slice(0, 7).toLowerCase() !== 'bearer ') return undefined;
  const token = trimmed.slice(7).trim();
  return token || undefined;
}

/** The container the default shell of a response ran in. */
function containerOf(response: OpenAiResponse): string | undefined {
  for (const tool of response.tools ?? []) {
    const environment = (tool as { type?: string; environment?: { type?: string; container_id?: string } }).environment;
    if ((tool as { type?: string }).type === 'shell' && environment?.type === 'container_reference')
      return environment.container_id;
  }
  return undefined;
}

function running(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === undefined;
}

const PENDING = new Set(['in_progress', 'searching', 'interpreting', 'generating', 'calling']);

function itemDone(item: OpenAiResponseItem): boolean {
  return !item.status || !PENDING.has(item.status);
}

/** An output item as events: the agent's message, or a tool call with its result. */
function itemEvents(item: OpenAiResponseItem): AgentEvent[] {
  const id = item.call_id ?? item.id;
  const at = id ? { id } : {};
  switch (item.type) {
    case 'message': {
      if (item.role && item.role !== 'assistant') return [];
      const text = textOf(item.content);
      return text ? [{ type: 'message', text }] : [];
    }
    case 'mcp_call': {
      const shown = `${item.server_label ?? 'mcp'}.${item.name ?? 'tool'}`;
      const output = item.error ? textOf(item.error) : textOf(item.output);
      return [
        { type: 'tool-start', ...at, name: shown, input: parsed(item.arguments) },
        {
          type: 'tool-end',
          ...at,
          name: shown,
          ...(item.error || item.status === 'failed' ? { isError: true } : {}),
          ...(output ? { output } : {}),
        },
      ];
    }
    case 'shell_call':
      return [
        { type: 'tool-start', ...at, name: 'shell', ...(item.action !== undefined ? { input: item.action } : {}) },
      ];
    case 'shell_call_output': {
      const runs = Array.isArray(item.output)
        ? (item.output as { stdout?: string; stderr?: string; outcome?: { type?: string; exit_code?: number } }[])
        : [];
      const output = runs.map((run) => [run.stdout, run.stderr].filter(Boolean).join('\n')).join('\n');
      const failed = runs.some((run) => run.outcome?.type !== 'exit' || (run.outcome.exit_code ?? 0) !== 0);
      return [
        { type: 'tool-end', ...at, name: 'shell', ...(failed ? { isError: true } : {}), ...(output ? { output } : {}) },
      ];
    }
    case 'code_interpreter_call': {
      const logs = Array.isArray(item.outputs)
        ? (item.outputs as { type?: string; logs?: string }[])
            .filter((out) => out.type === 'logs')
            .map((out) => out.logs ?? '')
            .join('\n')
        : '';
      return [
        { type: 'tool-start', ...at, name: 'code_interpreter', ...(item.code ? { input: { code: item.code } } : {}) },
        {
          type: 'tool-end',
          ...at,
          name: 'code_interpreter',
          ...(item.status === 'failed' ? { isError: true } : {}),
          ...(logs ? { output: logs } : {}),
        },
      ];
    }
    default: {
      // Other hosted tools (web search, file search, image generation...): one finished call each.
      if (!item.type.endsWith('_call')) return [];
      const shown = item.type.slice(0, -'_call'.length);
      return [
        { type: 'tool-start', ...at, name: shown, ...(item.action !== undefined ? { input: item.action } : {}) },
        { type: 'tool-end', ...at, name: shown, ...(item.status === 'failed' ? { isError: true } : {}) },
      ];
    }
  }
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stateOf(found: OpenAiResponse): {
  state: ManagedState;
  stopReason?: ManagedStopReason;
  error?: string;
  failure?: AgentFailure;
} {
  switch (found.status) {
    case 'queued':
      return { state: 'queued' };
    case undefined:
    case 'in_progress':
      return { state: 'running' };
    case 'completed':
      return { state: 'idle', stopReason: 'end-turn' };
    case 'cancelled':
      return { state: 'cancelled' };
    case 'incomplete': {
      const reason = found.incomplete_details?.reason ?? 'unknown';
      if (reason === 'max_output_tokens' || reason === 'max_tool_calls')
        return { state: 'idle', stopReason: reason === 'max_tool_calls' ? reason : 'budget' };
      return { state: 'failed', stopReason: 'error', error: `Response incomplete: ${reason}.` };
    }
    case 'failed': {
      const code = (found.error?.code ?? '').toLowerCase();
      const failure: AgentFailure | undefined = /rate_limit|quota|insufficient/.test(code)
        ? { kind: 'quota' }
        : /server_error|overloaded|unavailable|timeout/.test(code)
          ? { kind: 'unavailable' }
          : /invalid_api_key|unauthorized|permission/.test(code)
            ? { kind: 'auth' }
            : undefined;
      return {
        state: 'failed',
        stopReason: 'error',
        error: found.error?.message ?? found.error?.code ?? 'Response failed.',
        ...(failure ? { failure } : {}),
      };
    }
    default:
      return { state: 'idle', stopReason: found.status };
  }
}

function usageOf(usage: OpenAiUsage | null | undefined): ManagedUsage | undefined {
  if (!usage) return undefined;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  const cached = usage.input_tokens_details?.cached_tokens;
  const out: ManagedUsage = {
    ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
    ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {}),
    ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {}),
    ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
    ...(reasoning !== undefined ? { details: { reasoningTokens: reasoning } } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

function lastText(items: readonly OpenAiResponseItem[] | undefined): string | undefined {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i--) {
    const item = items![i];
    if (item.type !== 'message' || (item.role && item.role !== 'assistant')) continue;
    const text = textOf(item.content);
    if (text) return text;
  }
  return undefined;
}
