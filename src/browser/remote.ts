import { approximateSize, EventQueue } from '../agents/event-queue.js';
import { unsupportedPermissions } from '../agents/permissions.js';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentFailure,
  AgentResult,
  AgentRun,
  AgentStatus,
  CodingAgent,
} from '../agents/types.js';
import type { ImageMediaType } from '../core/types.js';
import type { BackendInfo, BackendRefusal, PageToolSpec, TurnEnd, TurnLine, TurnRequest } from '../backend/protocol.js';
import { ask, invoke } from './invoke.js';
import { abortable } from './language-model.js';
import { TEXT_NAMES, TEXT_TYPES, type NanoTask } from './nano.js';
import type { PageTool } from './tools.js';

export interface RemoteOptions {
  /** Where `createAgentBackend()` serves, e.g. `/api/assistant`. */
  url: string;
  /** What the model may do on the page. A function is called at the start of every task. */
  tools?: readonly PageTool[] | (() => readonly PageTool[] | Promise<readonly PageTool[]>);
  /** Agent name. Default `assistant`. */
  name?: string;
  /** Headers for every request, e.g. a bearer. Cookies go along with `credentials`. */
  headers?(): Record<string, string> | Promise<Record<string, string>>;
  /** Default `same-origin`. */
  credentials?: RequestCredentials;
  /** Send the tools' names and schemas with each request (for `pageTools: 'from-client'`). Default true. */
  sendTools?: boolean;
  /** Longest text of one attached file sent, in characters. Default 4,000. */
  maxAttachmentText?: number;
  /** Default: the page's `fetch`. */
  fetch?: typeof fetch;
}

/** A `CodingAgent` whose model runs behind your server (`genaicode/backend`). */
export interface RemoteAgent extends CodingAgent {
  run(task: NanoTask): AgentRun;
  /** What the backend says about itself and this user's allowance. */
  info(signal?: AbortSignal): Promise<BackendInfo>;
  /** Drop a conversation (`sessionId` of a result), or all of them. */
  forget(sessionId?: string): void;
}

// A page has no sandbox to switch on; `read-only` is honored by refusing `write` tools.
const capabilities: AgentCapabilities = {
  usage: true,
  approvals: true,
  resume: true,
  permissions: { approval: ['ask', 'auto-approve', 'deny'], sandbox: ['read-only'] },
};
const KEPT_SESSIONS = 8;
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

class Failed extends Error {
  constructor(
    message: string,
    readonly failure?: AgentFailure,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * The page's assistant on a model behind your server: the server (`createAgentBackend()` from
 * `genaicode/backend`) holds the model and its key, the page runs its own tools when the model
 * calls them and asks the user before a `write` tool, as with `nano()`. Use it as
 * `createPageAgent({ agent: remote({ url, tools }) })`, or with `withFallback([remote(...), nano(...)])`
 * so the page goes on with the built-in model when the backend is out (signed out, over its
 * allowance, down).
 */
export function remote(options: RemoteOptions): RemoteAgent {
  const name = options.name ?? 'assistant';
  const base = options.url.replace(/\/$/, '');
  const maxAttachmentText = options.maxAttachmentText ?? 4_000;
  // The backend's token for each conversation; insertion order is age.
  const sessions = new Map<string, string>();
  let nextSession = 1;
  const doFetch = (input: string, init: RequestInit) => (options.fetch ?? globalThis.fetch)(input, init);

  async function post(body: TurnRequest, signal: AbortSignal, emit: (event: AgentEvent) => void): Promise<TurnEnd> {
    let response: Response;
    try {
      response = await doFetch(`${base}/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await options.headers?.()) },
        body: JSON.stringify(body),
        credentials: options.credentials ?? 'same-origin',
        signal,
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new Failed(`The assistant's server cannot be reached: ${describe(error)}`, { kind: 'unavailable' });
    }
    if (!response.ok) throw await refusal(response);
    if (!response.body) throw new Failed('The assistant sent nothing back.', { kind: 'crash' });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (error) {
        signal.throwIfAborted();
        throw new Failed(`The connection to the assistant broke: ${describe(error)}`, { kind: 'unavailable' });
      }
      const { done, value } = chunk;
      if (value) buffer += value;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let parsed: TurnLine;
        try {
          parsed = JSON.parse(line) as TurnLine;
        } catch {
          continue;
        }
        if (parsed.type === 'turn-end') {
          void reader.cancel().catch(() => {});
          return parsed;
        }
        if (
          parsed.type === 'text-delta' ||
          parsed.type === 'message' ||
          parsed.type === 'tool-start' ||
          parsed.type === 'tool-end' ||
          parsed.type === 'error'
        ) {
          emit(parsed);
        }
      }
      if (done) break;
    }
    signal.throwIfAborted();
    throw new Failed('The assistant stopped without finishing the turn.', { kind: 'crash' });
  }

  function run(task: NanoTask): AgentRun {
    const events = new EventQueue<AgentEvent>(approximateSize);
    const controller = new AbortController();
    const { signal } = controller;
    const abort = () => controller.abort();
    if (task.signal?.aborted) abort();
    else task.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer =
      task.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            abort();
          }, task.timeoutMs);
    const emit = (event: AgentEvent) => events.push(event);
    let tokens = 0;
    let over = false;

    const finish = (
      status: AgentStatus,
      sessionId: string | undefined,
      extra: { text?: string; error?: string; failure?: AgentFailure } = {},
    ): AgentResult => {
      const result: AgentResult = {
        status,
        ok: status === 'completed',
        exitCode: null,
        signal: null,
        ...(sessionId ? { sessionId } : {}),
        ...(extra.text !== undefined ? { text: extra.text } : {}),
        ...(tokens ? { usage: { totalTokens: tokens } } : {}),
        ...(extra.error ? { error: extra.error } : {}),
        ...(extra.failure ? { failure: extra.failure } : over ? { failure: { kind: 'budget' as const } } : {}),
      };
      emit({ type: 'done', result });
      events.close();
      if (timer) clearTimeout(timer);
      task.signal?.removeEventListener('abort', abort);
      return result;
    };

    const work = async (): Promise<AgentResult> => {
      let sessionId: string | undefined;
      try {
        const refused = unsupportedPermissions(name, capabilities, task);
        if (refused) throw new Error(refused);
        const tools =
          typeof options.tools === 'function'
            ? await abortable(Promise.resolve(options.tools()), signal)
            : (options.tools ?? []);
        const specs: PageToolSpec[] | undefined =
          options.sendTools === false
            ? undefined
            : tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
                ...(tool.write ? { write: true } : {}),
              }));
        const attached = await abortable(attach(task.attachments ?? [], maxAttachmentText), signal);
        sessionId = task.resume && sessions.has(task.resume) ? task.resume : `remote-${nextSession++}`;
        emit({ type: 'session', sessionId, model: name });
        const keep = (state: string | undefined) => {
          if (!state) return;
          sessions.delete(sessionId!);
          sessions.set(sessionId!, state);
          for (const id of sessions.keys()) {
            if (sessions.size <= KEPT_SESSIONS) break;
            sessions.delete(id);
          }
        };

        const prompt = `${task.prompt.trim()}${attached.text}`;
        let body: TurnRequest = {
          ...(sessions.has(sessionId) ? { state: sessions.get(sessionId) } : {}),
          prompt,
          ...(attached.images.length ? { images: attached.images } : {}),
          ...(specs ? { tools: specs } : {}),
        };
        let restarted = false;
        let step = 0;
        for (;;) {
          let end: TurnEnd;
          try {
            end = await post(body, signal, emit);
          } catch (error) {
            // An expired or foreign conversation: start a new one with this prompt, once.
            if (error instanceof Failed && error.status === 409 && body.prompt !== undefined && !restarted) {
              restarted = true;
              sessions.delete(sessionId);
              const { state: _old, ...fresh } = body;
              void _old;
              body = fresh;
              continue;
            }
            throw error;
          }
          keep(end.state);
          const spent = end.usage?.totalTokens ?? (end.usage?.inputTokens ?? 0) + (end.usage?.outputTokens ?? 0);
          if (spent) {
            tokens += spent;
            emit({ type: 'usage', usage: { totalTokens: tokens } });
            const limit = task.budget?.maxTokens;
            if (limit !== undefined && tokens > limit) {
              over = true;
              throw new Error(`${name} went over its token budget (${tokens} of ${limit}).`);
            }
          }
          if (end.status === 'failed') throw new Failed(end.error ?? 'The assistant failed.', end.failure);
          if (end.status === 'completed') return finish('completed', sessionId, { text: end.text ?? '' });
          if (task.maxTurns !== undefined && ++step > task.maxTurns) {
            throw new Error(`${name} used its ${task.maxTurns} tool steps.`);
          }

          const results: NonNullable<TurnRequest['results']> = [];
          for (const call of end.calls ?? []) {
            emit({ type: 'tool-start', id: call.id, name: call.name, input: call.input });
            const tool = tools.find((candidate) => candidate.name === call.name);
            let output: string;
            let isError = false;
            try {
              if (!tool) throw new Error(`This page has no tool called ${call.name}.`);
              output = await invoke(tool, call.input ?? {}, call.id, task, emit, signal);
            } catch (error) {
              signal.throwIfAborted();
              output = describe(error);
              isError = true;
            }
            emit({ type: 'tool-end', id: call.id, name: call.name, output, ...(isError ? { isError } : {}) });
            results.push({ id: call.id, output, ...(isError ? { isError } : {}) });
          }
          const approvals: NonNullable<TurnRequest['approvals']> = [];
          for (const request of end.approvals ?? []) {
            const decision = await ask(request, task, emit, signal);
            approvals.push({ id: request.id, decision: decision === 'approve' ? 'approve' : 'deny' });
          }
          body = {
            state: end.state,
            ...(results.length ? { results } : {}),
            ...(approvals.length ? { approvals } : {}),
            ...(!results.length && !approvals.length ? { results: [] } : {}),
            ...(specs ? { tools: specs } : {}),
          };
        }
      } catch (error) {
        if (signal.aborted && !over) {
          return finish(timedOut ? 'timeout' : 'aborted', sessionId, timedOut ? { error: 'Timed out.' } : {});
        }
        const message = describe(error);
        emit({ type: 'error', message });
        return finish('failed', sessionId, {
          error: message,
          ...(error instanceof Failed && error.failure ? { failure: error.failure } : {}),
        });
      }
    };

    const result = work();
    return {
      result,
      abort,
      [Symbol.asyncIterator]: () => events.iterate(),
    };
  }

  return {
    name,
    command: base,
    capabilities,
    run,
    async info(signal) {
      let response: Response;
      try {
        response = await doFetch(`${base}/info`, {
          headers: { ...(await options.headers?.()) },
          credentials: options.credentials ?? 'same-origin',
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        throw new Failed(`The assistant's server cannot be reached: ${describe(error)}`, { kind: 'unavailable' });
      }
      if (!response.ok) throw await refusal(response);
      return (await response.json()) as BackendInfo;
    },
    forget(sessionId) {
      if (sessionId === undefined) sessions.clear();
      else sessions.delete(sessionId);
    },
  };
}

/** A refused request as an error that says what kind of failure it was. */
async function refusal(response: Response): Promise<Failed> {
  let body: Partial<BackendRefusal> = {};
  try {
    body = (await response.json()) as BackendRefusal;
  } catch {
    // Not ours: a proxy's page.
  }
  const failure: AgentFailure | undefined =
    body.failure ??
    (response.status === 401 || response.status === 403
      ? { kind: 'auth' }
      : response.status === 429
        ? { kind: 'quota' }
        : response.status === 404 || response.status >= 500
          ? { kind: 'unavailable' }
          : undefined);
  const said = typeof body.error === 'string' ? body.error : response.statusText || `HTTP ${response.status}`;
  return new Failed(`The assistant refused: ${said}.`, failure, response.status);
}

interface Attached {
  text: string;
  images: { mediaType: ImageMediaType; data: string; name?: string }[];
}

async function attach(files: readonly Blob[], maxText: number): Promise<Attached> {
  const attached: Attached = { text: '', images: [] };
  for (const [index, file] of files.entries()) {
    const name = (file as { name?: unknown }).name;
    const label = typeof name === 'string' && name ? name : `attachment ${index + 1}`;
    if (IMAGE_TYPES.has(file.type)) {
      attached.images.push({ mediaType: file.type as ImageMediaType, data: await base64(file), name: label });
      attached.text += `\n\nAttached image: "${label}".`;
    } else if (TEXT_TYPES.test(file.type) || TEXT_NAMES.test(label)) {
      const text = await file.text();
      const cut = text.length > maxText;
      attached.text += `\n\nAttached file "${label}"${cut ? ` (the first ${maxText} of ${text.length} characters)` : ''}:\n${cut ? text.slice(0, maxText) : text}`;
    } else {
      throw new Error(`"${label}" cannot be attached: the assistant reads text files and images only.`);
    }
  }
  return attached;
}

async function base64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}
