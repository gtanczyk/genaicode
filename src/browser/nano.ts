import { approximateSize, EventQueue } from '../agents/event-queue.js';
import type {
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
const KEPT_SESSIONS = 4;

/**
 * The browser's built-in model (Gemini Nano through Chrome's Prompt API) as a genaicode agent.
 * It runs in the page, costs nothing and sends nothing to a server; it is a small model, good
 * for one or two tool calls and a short answer, not for coding.
 *
 * The Prompt API has no tool calling, so each step is a constrained choice: the model picks a
 * tool or `reply`, then fills in that tool's arguments against its JSON Schema, and the final
 * answer streams as text. `write` tools go through `task.onApproval` first. `task.resume`
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
    return abortable(
      model.create({
        initialPrompts: [{ role: 'system', content: briefing(options.instructions, tools) }],
        ...expectedText(language),
        monitor,
        signal,
      }),
      signal,
    );
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
    const finish = (status: AgentStatus, sessionId: string | undefined, text?: string, error?: string): AgentResult => {
      const session = sessionId ? sessions.get(sessionId) : undefined;
      const used = session ? contextOf(session) : undefined;
      const result: AgentResult = {
        status,
        ok: status === 'completed',
        exitCode: null,
        signal: null,
        ...(sessionId ? { sessionId } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(used ? { usage: { totalTokens: used.used } } : {}),
        ...(error ? { error } : {}),
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
        const tools = typeof options.tools === 'function' ? await options.tools() : (options.tools ?? []);
        let session = task.resume ? sessions.get(task.resume) : undefined;
        sessionId = session ? task.resume : undefined;
        if (!session) {
          session = await open(tools, signal);
          sessionId = `nano-${nextSession++}`;
          sessions.set(sessionId, session);
          while (sessions.size > KEPT_SESSIONS) forget(sessions.keys().next().value as string);
        }
        emit({ type: 'session', sessionId: sessionId!, model: options.model ?? 'on-device' });
        const text = await converse(session, tools, task, emit, signal, { maxSteps, maxToolOutput });
        return finish('completed', sessionId, text);
      } catch (error) {
        if (signal.aborted) {
          return finish(timedOut ? 'timeout' : 'aborted', sessionId, undefined, timedOut ? 'Timed out.' : undefined);
        }
        const message = describe(error);
        emit({ type: 'error', message });
        return finish('failed', sessionId, undefined, message);
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
    capabilities: { usage: true, approvals: true, resume: true, maxTurns: true },
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
  limits: { maxSteps: number; maxToolOutput: number },
): Promise<string> {
  const steps = Math.max(0, Math.min(limits.maxSteps, task.maxTurns ?? limits.maxSteps));
  const report = () => {
    const used = contextOf(session);
    if (used) emit({ type: 'usage', usage: { totalTokens: used.used } });
  };
  const reply = async (input: string): Promise<string> => {
    let text = '';
    for await (const delta of streamDeltas(session.promptStreaming(input, { signal }), signal)) {
      text += delta;
      emit({ type: 'text-delta', text: delta });
    }
    signal.throwIfAborted();
    notAStub(text);
    emit({ type: 'message', text });
    report();
    return text;
  };

  let input = `User: ${task.prompt}`;
  if (!tools.length) return reply(input);

  const called = new Set<string>();
  for (let step = 0; step < steps; step++) {
    const action = await choose(session, input, tools, signal);
    report();
    if (action === REPLY) return reply('Write your reply to the user.');

    const tool = tools.find((candidate) => candidate.name === action)!;
    const args = await fillArguments(session, tool, signal);
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

/** Step one: which tool, or `reply`. */
async function choose(
  session: LanguageModelSession,
  input: string,
  tools: readonly PageTool[],
  signal: AbortSignal,
): Promise<string> {
  const names = [...tools.map((tool) => tool.name), REPLY];
  const question = `${input}\n\nWhat is the next action? Answer as JSON {"action": "..."} with one of: ${names.join(', ')}.`;
  const raw = await abortable(
    session.prompt(question, {
      signal,
      omitResponseConstraintInput: true,
      responseConstraint: {
        type: 'object',
        properties: { action: { type: 'string', enum: names } },
        required: ['action'],
        additionalProperties: false,
      },
    }),
    signal,
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
): Promise<Record<string, unknown>> {
  if (!Object.keys(schemaProperties(tool)).length) return {};
  const raw = await abortable(
    session.prompt(`Give the arguments for ${tool.name} as a JSON object.`, {
      signal,
      responseConstraint: { type: 'object', additionalProperties: false, ...tool.inputSchema },
    }),
    signal,
  );
  return parseObject(raw) ?? {};
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
    const approval = task.permissions === 'yolo' ? 'auto-approve' : (task.permissions?.approval ?? 'ask');
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
