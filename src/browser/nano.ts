import { approximateSize, EventQueue } from '../agents/event-queue.js';
import { resolvePermissions, unsupportedPermissions } from '../agents/permissions.js';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentResult,
  AgentRun,
  AgentStatus,
  AgentTask,
  ApprovalRequest,
  CodingAgent,
} from '../agents/types.js';
import {
  abortable,
  builtInLanguageModel,
  contextOf,
  expectedText,
  languageModelAvailability,
  streamDeltas,
  type LanguageModelAvailability,
  type LanguageModelFactory,
  type LanguageModelPromptOptions,
  type LanguageModelSession,
} from './language-model.js';
import { argumentProblems, schemaProperties, toolText, type PageTool } from './tools.js';

export interface NanoOptions {
  /** What the model may do on the page. A function is called at the start of every task. */
  tools?: readonly PageTool[] | (() => readonly PageTool[] | Promise<readonly PageTool[]>);
  /** Who the assistant is and what the page is about. Keep it short: the context window is small. */
  instructions?: string;
  /** Language of the conversation (the Prompt API supports a few). Default `en`. */
  language?: string;
  /** Most tool calls in one task before the model has to answer. Default 6. */
  maxSteps?: number;
  /** Longest tool output the model is shown, in characters. Default 2,000. */
  maxToolOutput?: number;
  /** Shown as the model's name. Default `on-device`. */
  model?: string;
  /** Agent name. Default `nano`. */
  name?: string;
  /** The Prompt API to use. Default: the browser's `LanguageModel`. */
  languageModel?: LanguageModelFactory;
  /** Download progress of the model, 0 to 1, while a task or `prepare()` waits for it. */
  onDownload?(progress: number): void;
  /** Called after every call to the model, with how long it took: for logs and tuning. */
  onModelCall?(call: NanoModelCall): void;
}

/** One call to the model within a task. */
export interface NanoModelCall {
  /** `choose`: tool or reply. `arguments`: the tool's arguments. `reply`: the answer. */
  step: 'choose' | 'arguments' | 'reply';
  ms: number;
  /** Whether the browser held the answer to a JSON Schema. */
  constrained: boolean;
  /** Why the call failed. */
  error?: string;
}

/** A `CodingAgent` that runs in the page, on the browser's built-in model. */
export interface NanoAgent extends CodingAgent {
  /** Whether the browser has the model, could download it, or cannot run it at all. */
  availability(): Promise<LanguageModelAvailability>;
  /**
   * Load the model now, downloading it first when needed (several GB, once per browser), so the
   * first task does not wait. A download needs a user gesture: call this from a click.
   */
  prepare(signal?: AbortSignal): Promise<void>;
  /** Tokens in use and the size of a conversation's context window, where the browser says. */
  context(sessionId: string): { used: number; window: number } | undefined;
  /** Drop a conversation (`sessionId` of a result), or all of them, and free the model's memory. */
  forget(sessionId?: string): void;
}

const REPLY = 'reply';
// A page has no sandbox to switch on; `read-only` is honored by refusing `write` tools.
const capabilities: AgentCapabilities = {
  usage: true,
  approvals: true,
  resume: true,
  maxTurns: true,
  permissions: { approval: ['ask', 'auto-approve', 'deny'], sandbox: ['read-only'] },
};
const KEPT_SESSIONS = 4;
/** A rough size of a token, for steps the browser gives no count for. */
const CHARACTERS_PER_TOKEN = 4;

/**
 * The browser's built-in model (Gemini Nano through Chrome's Prompt API) as a genaicode agent.
 * It runs in the page, costs nothing and sends nothing to a server; it is a small model, good
 * for one or two tool calls and a short answer, not for coding.
 *
 * The Prompt API has no tool calling, so each step is a constrained choice: the model picks a
 * tool or `reply`, then fills in that tool's arguments against its JSON Schema, and the final
 * answer streams as text. `write` tools go through `task.onApproval` first, and never run under
 * `permissions.sandbox: 'read-only'`; other sandbox values fail the task, as a page has none. `task.resume`
 * continues a conversation; `task.cwd`, `env` and `mcpServers` mean nothing here.
 */
export function nano(options: NanoOptions = {}): NanoAgent {
  const name = options.name ?? 'nano';
  const language = options.language ?? 'en';
  const maxSteps = options.maxSteps ?? 6;
  const maxToolOutput = options.maxToolOutput ?? 2_000;
  const factory = () => options.languageModel ?? builtInLanguageModel();
  // Insertion order is age: the oldest conversation is dropped first.
  const sessions = new Map<string, LanguageModelSession>();
  let nextSession = 1;

  const monitor = (target: EventTarget) => {
    target.addEventListener('downloadprogress', (event) => {
      const loaded = (event as Event & { loaded?: number }).loaded;
      if (typeof loaded === 'number') options.onDownload?.(Math.max(0, Math.min(1, loaded)));
    });
  };

  // How many running tasks use each conversation.
  const busy = new Map<string, number>();
  const forget = (sessionId?: string) => {
    for (const [id, session] of sessions) {
      if (sessionId !== undefined && id !== sessionId) continue;
      sessions.delete(id);
      try {
        session.destroy();
      } catch {
        // Already gone.
      }
    }
  };

  async function open(tools: readonly PageTool[], signal: AbortSignal): Promise<LanguageModelSession> {
    const model = factory();
    if (!model) throw new Error('This browser has no built-in language model (the Prompt API is missing).');
    const created = model.create({
      initialPrompts: [{ role: 'system', content: briefing(options.instructions, tools) }],
      ...expectedText(language),
      monitor,
      signal,
    });
    // A session that arrives after the task was stopped has no owner: release it.
    created.then(
      (late) => {
        if (signal.aborted) late.destroy();
      },
      () => {},
    );
    return abortable(created, signal);
  }

  function run(task: AgentTask): AgentRun {
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
    // What this task spent: the growth of the context in use, step by step.
    const meter = { last: 0, tokens: 0, reported: false, warned: false, over: false };
    const report = (session: LanguageModelSession, characters: number) => {
      const used = contextOf(session);
      if (!used) return;
      const grown = used.used - meter.last;
      meter.last = used.used;
      // A full window drops old messages, so the count stalls or falls: estimate that step from its text.
      meter.tokens += grown > 0 ? grown : Math.ceil(characters / CHARACTERS_PER_TOKEN);
      meter.reported = true;
      emit({ type: 'usage', usage: { totalTokens: meter.tokens } });
      const limit = task.budget?.maxTokens;
      if (limit === undefined) return;
      if (meter.tokens > limit) {
        meter.over = true;
        throw new Error(`${name} went over its token budget (${meter.tokens} of ${limit}).`);
      }
      if (!meter.warned && meter.tokens >= limit * (task.budget?.warnAt ?? 0.8)) {
        meter.warned = true;
        emit({ type: 'budget-warning', warning: { kind: 'tokens', used: meter.tokens, limit } });
      }
    };
    const finish = (status: AgentStatus, sessionId: string | undefined, text?: string, error?: string): AgentResult => {
      const result: AgentResult = {
        status,
        ok: status === 'completed',
        exitCode: null,
        signal: null,
        ...(sessionId ? { sessionId } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(meter.reported ? { usage: { totalTokens: meter.tokens } } : {}),
        ...(error ? { error } : {}),
        ...(meter.over ? { failure: { kind: 'budget' as const } } : {}),
      };
      emit({ type: 'done', result });
      events.close();
      if (timer) clearTimeout(timer);
      task.signal?.removeEventListener('abort', abort);
      return result;
    };

    const work = async (): Promise<AgentResult> => {
      let sessionId: string | undefined;
      let held: string | undefined;
      try {
        const refused = unsupportedPermissions(name, capabilities, task);
        if (refused) throw new Error(refused);
        const tools =
          typeof options.tools === 'function'
            ? await abortable(Promise.resolve(options.tools()), signal)
            : (options.tools ?? []);
        let session = task.resume ? sessions.get(task.resume) : undefined;
        sessionId = session ? task.resume : undefined;
        // A new conversation's instructions count as this task's tokens.
        meter.last = session ? (contextOf(session)?.used ?? 0) : 0;
        if (!session) {
          session = await open(tools, signal);
          sessionId = `nano-${nextSession++}`;
          sessions.set(sessionId, session);
        }
        busy.set(sessionId!, (busy.get(sessionId!) ?? 0) + 1);
        held = sessionId;
        // The oldest conversations go, but never one a task is still running in.
        for (const id of [...sessions.keys()]) {
          if (sessions.size <= KEPT_SESSIONS) break;
          if (!busy.has(id)) forget(id);
        }
        emit({ type: 'session', sessionId: sessionId!, model: options.model ?? 'on-device' });
        const live = session;
        const text = await converse(live, tools, task, emit, signal, (characters) => report(live, characters), {
          watch: (call) => options.onModelCall?.(call),
          maxSteps,
          maxToolOutput,
        });
        return finish('completed', sessionId, text);
      } catch (error) {
        if (signal.aborted && !meter.over) {
          return finish(timedOut ? 'timeout' : 'aborted', sessionId, undefined, timedOut ? 'Timed out.' : undefined);
        }
        const message = describe(error);
        emit({ type: 'error', message });
        return finish('failed', sessionId, undefined, message);
      } finally {
        if (held) {
          const left = (busy.get(held) ?? 1) - 1;
          if (left > 0) busy.set(held, left);
          else busy.delete(held);
        }
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
    command: 'LanguageModel',
    capabilities,
    run,
    availability: () => languageModelAvailability(language, factory()),
    async prepare(signal) {
      const model = factory();
      if (!model) throw new Error('This browser has no built-in language model (the Prompt API is missing).');
      const session = await model.create({ ...expectedText(language), monitor, signal });
      session.destroy();
    },
    context: (sessionId) => {
      const session = sessions.get(sessionId);
      return session ? contextOf(session) : undefined;
    },
    forget,
  };
}

/** One task: choose a tool or reply, until the model replies or runs out of steps. */
async function converse(
  session: LanguageModelSession,
  tools: readonly PageTool[],
  task: AgentTask,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
  report: (characters: number) => void,
  limits: { maxSteps: number; maxToolOutput: number; watch: (call: NanoModelCall) => void },
): Promise<string> {
  const steps = Math.max(0, Math.min(limits.maxSteps, task.maxTurns ?? limits.maxSteps));
  const { watch } = limits;
  const reply = async (input: string): Promise<string> => {
    let text = '';
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      try {
        for await (const delta of streamDeltas(session.promptStreaming(input, { signal }), signal)) {
          text += delta;
          emit({ type: 'text-delta', text: delta });
        }
        watch({ step: 'reply', ms: Date.now() - started, constrained: false });
        break;
      } catch (error) {
        if (signal.aborted) throw error;
        watch({ step: 'reply', ms: Date.now() - started, constrained: false, error: describe(error) });
        // Once the user saw text, a second try would say it twice.
        if (text || attempt > 1 || permanent(error)) throw new Error(`Writing the reply failed: ${describe(error)}`);
      }
    }
    signal.throwIfAborted();
    notAStub(text);
    emit({ type: 'message', text });
    report(pending + input.length + text.length);
    return text;
  };

  // Text exchanged with the model since the last usage report.
  let pending = 0;
  let input = `User: ${task.prompt}`;
  if (!tools.length) return reply(input);

  const called = new Set<string>();
  for (let step = 0; step < steps; step++) {
    const action = await choose(session, input, tools, signal, watch);
    report(pending + input.length + action.length);
    pending = 0;
    if (action === REPLY) return reply('Write your reply to the user.');

    const tool = tools.find((candidate) => candidate.name === action)!;
    const args = await fillArguments(session, tool, signal, watch);
    pending += stableJson(args).length;
    const id = `call-${step + 1}`;
    emit({ type: 'tool-start', id, name: tool.name, input: args });

    const key = `${tool.name} ${stableJson(args)}`;
    let output: string;
    let isError = false;
    if (called.has(key)) {
      // A small model can loop on one call; say so instead of running it again.
      output = 'You already made this exact call. Use its result above and reply to the user.';
      isError = true;
    } else {
      called.add(key);
      try {
        output = await invoke(tool, args, id, task, emit, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        output = describe(error);
        isError = true;
      }
    }
    signal.throwIfAborted();
    const shown = clip(output, limits.maxToolOutput);
    emit({ type: 'tool-end', id, name: tool.name, output: shown, ...(isError ? { isError } : {}) });
    input = isError ? `The call to ${tool.name} failed: ${shown}` : `Result of ${tool.name}:\n${shown}`;
  }
  return reply(`${input}\n\nNow write your reply to the user.`);
}

const ANNOTATIONS = new Set(['description', 'title', 'default', 'examples', '$comment', 'deprecated']);
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions']);

/** `schema` without the keywords that only describe: they tell a model things, they constrain nothing. */
function constraintOf(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(constraintOf);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATIONS.has(key)) continue;
    if (key === 'enum' || key === 'const' || key === 'required') out[key] = value;
    else if (SCHEMA_MAPS.has(key) && value && typeof value === 'object' && !Array.isArray(value))
      // Keys here are property names, not keywords: a property may be called "title".
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, constraintOf(sub)]));
    else out[key] = constraintOf(value);
  }
  return out;
}

/**
 * Ask for JSON that follows `schema`. The browser holds the model to it; when that call fails
 * (Chrome answers some with an unexplained error), the model is asked in words instead and the
 * answer is checked here against the tool's schema (`argumentProblems`) before the tool runs.
 */
async function structured(
  session: LanguageModelSession,
  step: 'choose' | 'arguments',
  question: string,
  schema: Record<string, unknown>,
  signal: AbortSignal,
  watch: (call: NanoModelCall) => void,
  /** The question already says what shape is wanted: do not spend context on the schema. */
  told = false,
): Promise<string> {
  const ask = async (text: string, constraint?: LanguageModelPromptOptions): Promise<string> => {
    const started = Date.now();
    const constrained = constraint !== undefined;
    try {
      const raw = await abortable(session.prompt(text, { signal, ...constraint }), signal);
      watch({ step, ms: Date.now() - started, constrained });
      return raw;
    } catch (error) {
      if (!signal.aborted) watch({ step, ms: Date.now() - started, constrained, error: describe(error) });
      throw error;
    }
  };
  try {
    // The schema goes into the prompt here, in full, and the browser gets only what constrains
    // the answer: Chrome failed calls where it was left to add a schema with annotations itself.
    const text = told ? question : `${question}\nIt must follow this JSON Schema: ${JSON.stringify(schema)}`;
    return await ask(text, {
      responseConstraint: constraintOf(schema) as Record<string, unknown>,
      omitResponseConstraintInput: true,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    const doing = step === 'choose' ? 'Choosing the next action' : 'Filling in the arguments';
    if (permanent(error)) throw new Error(`${doing} failed: ${describe(error)}`);
    try {
      return await ask(`${question}\nAnswer with JSON only, following this JSON Schema: ${JSON.stringify(schema)}`);
    } catch (second) {
      if (signal.aborted) throw second;
      throw new Error(`${doing} failed: ${describe(second)}`);
    }
  }
}

/** An error a second try cannot fix. */
function permanent(error: unknown): boolean {
  return error instanceof Error && error.name === 'QuotaExceededError';
}

/** Step one: which tool, or `reply`. */
async function choose(
  session: LanguageModelSession,
  input: string,
  tools: readonly PageTool[],
  signal: AbortSignal,
  watch: (call: NanoModelCall) => void,
): Promise<string> {
  const names = [...tools.map((tool) => tool.name), REPLY];
  const question = `${input}\n\nWhat is the next action? Answer as JSON {"action": "..."} with one of: ${names.join(', ')}.`;
  const raw = await structured(
    session,
    'choose',
    question,
    {
      type: 'object',
      properties: { action: { type: 'string', enum: names } },
      required: ['action'],
      additionalProperties: false,
    },
    signal,
    watch,
    true,
  );
  notAStub(raw);
  const action = (parseObject(raw) as { action?: unknown } | undefined)?.action;
  return typeof action === 'string' && names.includes(action) ? action : REPLY;
}

/** Step two: the chosen tool's arguments, constrained by its schema. */
async function fillArguments(
  session: LanguageModelSession,
  tool: PageTool,
  signal: AbortSignal,
  watch: (call: NanoModelCall) => void,
): Promise<Record<string, unknown>> {
  if (!Object.keys(schemaProperties(tool)).length) return {};
  const raw = await structured(
    session,
    'arguments',
    `Give the arguments for ${tool.name} as a JSON object.`,
    { type: 'object', additionalProperties: false, ...tool.inputSchema },
    signal,
    watch,
  );
  const args = parseObject(raw) ?? {};
  // Asked in words, a model may add arguments the schema does not have; the browser never lets it.
  const open = tool.inputSchema?.additionalProperties;
  if (open === true || (open && typeof open === 'object')) return args;
  const known = schemaProperties(tool);
  return Object.fromEntries(Object.entries(args).filter(([key]) => key in known));
}

/** Check the arguments, ask the user about a `write` tool, then run it. */
async function invoke(
  tool: PageTool,
  args: Record<string, unknown>,
  id: string,
  task: AgentTask,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<string> {
  const problems = argumentProblems(tool, args);
  if (problems.length) throw new Error(`Bad arguments: ${problems.join('; ')}.`);
  tool.validate?.(args);
  if (tool.write) {
    const permissions = resolvePermissions(task.permissions);
    if (permissions.sandbox === 'read-only') throw new Error('Not allowed: this task is read-only.');
    const approval = permissions.approval ?? 'ask';
    const request: ApprovalRequest = {
      id,
      kind: 'other',
      summary: tool.summary?.(args) ?? `${tool.name} ${stableJson(args)}`,
      detail: { tool: tool.name, args },
      scope: 'once',
    };
    if (approval === 'deny') throw new Error('Not allowed: this needs the user’s approval.');
    emit({ type: 'approval-request', request });
    let decision: 'approve' | 'deny' = 'deny';
    if (approval === 'auto-approve') decision = 'approve';
    else if (task.onApproval) {
      try {
        decision =
          (await abortable(Promise.resolve(task.onApproval(request, signal)), signal)) === 'approve'
            ? 'approve'
            : 'deny';
      } catch {
        decision = 'deny';
      }
    }
    if (signal.aborted) decision = 'deny';
    emit({
      type: 'approval-resolved',
      id,
      decision,
      ...(approval === 'auto-approve' ? { automatic: true } : {}),
    });
    signal.throwIfAborted();
    if (decision !== 'approve') throw new Error('The user declined this action.');
  }
  return toolText(await abortable(Promise.resolve(tool.run(args, signal)), signal));
}

/** Chromium builds without the model ship a Prompt API that says so and echoes the prompt. */
function notAStub(reply: string): void {
  if (/^On-device model is not available/i.test(reply)) {
    throw new Error('This browser build has the Prompt API but no on-device model behind it.');
  }
}

/** What the model is told once, as the system prompt. */
export function briefing(instructions: string | undefined, tools: readonly PageTool[]): string {
  const lines: string[] = [];
  if (instructions?.trim()) lines.push(instructions.trim(), '');
  if (tools.length) {
    lines.push('You can act through these tools:');
    for (const tool of tools) lines.push(`- ${signature(tool)}: ${tool.description}`);
    lines.push(
      '',
      'You work in steps. Each step you either pick one tool or pick "reply".',
      '- Pick a tool when the user asks for something a tool does, or when you need facts a tool returns.',
      '- Pick "reply" as soon as you can answer. Do not repeat a call you already made.',
      '- Never make up a tool result or a fact about the page.',
    );
  }
  lines.push('Replies are short and plain: a few sentences, in the language the user writes in.');
  return lines.join('\n');
}

function signature(tool: PageTool): string {
  const required = new Set(Array.isArray(tool.inputSchema?.required) ? (tool.inputSchema.required as string[]) : []);
  const parts = Object.entries(schemaProperties(tool)).map(([name, schema]) => {
    const type = Array.isArray(schema.enum)
      ? schema.enum.map((item) => JSON.stringify(item)).join('|')
      : typeof schema.type === 'string'
        ? schema.type
        : 'any';
    return `${name}${required.has(name) ? '' : '?'}: ${type}`;
  });
  return `${tool.name}(${parts.join(', ')})`;
}

/** The first JSON object in `raw`, or undefined. A constrained reply is the object itself. */
function parseObject(raw: string): Record<string, unknown> | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(raw.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[cut: ${text.length - max} more characters]`;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return 'The conversation no longer fits the model’s context window.';
    if (error.name === 'NotSupportedError') return `The built-in model cannot do this here: ${error.message}`;
    return error.message || error.name;
  }
  return String(error);
}
