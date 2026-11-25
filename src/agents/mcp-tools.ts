import { createHash, randomUUID } from 'node:crypto';

/**
 * What a tool returns: text, or text with images (e.g. a screenshot the agent should look at).
 * With `task`, the text is what can be said at once and the task is the work that goes on.
 */
export type ToolOutput =
  | string
  | { text: string; images?: ReadonlyArray<{ mimeType: string; data: string }>; task?: McpToolTask };

/**
 * Work a tool started and did not wait for (a message another agent is answering). A client
 * that takes MCP tasks (`io.modelcontextprotocol/tasks`) gets a task to poll and goes on working;
 * any other gets the result if it comes within `McpServerInfo.taskWaitMs`, else the text alone.
 */
export interface McpToolTask {
  /** What the work came to; a rejection fails the task. */
  result: Promise<ToolOutput>;
  /** What it is doing now, in a line, while it runs. */
  status?(): string | undefined;
  /** The client no longer wants it. */
  cancel?(): void;
}

/** What a call knows about the request it answers (MCP 2026-07-28; empty for older clients). */
export interface McpCallContext {
  /** The client's capabilities, as this request declares them. */
  capabilities: Readonly<Record<string, unknown>>;
  /** The answers to what an earlier attempt of this call asked for (`McpInputRequired`), by key. */
  inputResponses?: Readonly<Record<string, unknown>>;
  /** The `requestState` that attempt gave, as the client sent it back. Verify it: the client held it. */
  requestState?: string;
  /**
   * Send an MCP `notifications/progress` update while a long-running tool works. Present when the
   * client supplied `_meta.progressToken` and the transport can stream notifications.
   */
  progress?(progress: number, total?: number, message?: string): void;
}

/**
 * Thrown by a tool that needs something from the user first: the client asks (`inputRequests`,
 * by key: e.g. `{ method: 'elicitation/create', params }`) and calls again with the answers in
 * `McpCallContext.inputResponses`. Only clients of MCP 2026-07-28 can be asked; check
 * `McpCallContext.capabilities` before throwing.
 */
export class McpInputRequired extends Error {
  constructor(
    readonly inputRequests: Readonly<Record<string, { method: string; params: Record<string, unknown> }>>,
    readonly requestState?: string,
  ) {
    super('The user has to answer first.');
    this.name = 'McpInputRequired';
  }
}

/** A tool the app serves to the agent over MCP. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Client-specific MCP metadata advertised by `tools/list`. */
  _meta?: Readonly<Record<string, unknown>>;
  call(args: Record<string, unknown>, context?: McpCallContext): Promise<ToolOutput>;
}

/** The text of a tool's output, without its images. */
export function outputText(output: ToolOutput): string {
  return typeof output === 'string' ? output : output.text;
}

/**
 * A skill the server ships beside its tools (MCP extension `io.modelcontextprotocol/skills`):
 * guidance an agent loads only when a task calls for it, where `instructions` always cost context.
 */
export interface McpSkill {
  /** Also the skill's directory: `skill://<name>/SKILL.md`. Lowercase letters, digits and hyphens. */
  name: string;
  /** When to load it, in a sentence: all the agent sees until it does. */
  description: string;
  /** What `SKILL.md` says under its frontmatter (Markdown). */
  body: string;
}

/** What the server says about itself, beside its tools. */
export interface McpServerInfo {
  name: string;
  version: string;
  /** When to reach for the tools: agents put it in front of their model. */
  instructions?: string;
  /** Skills served to clients that speak MCP 2026-07-28; older clients are not told of them. */
  skills?: readonly McpSkill[];
  /**
   * How long a call waits for a `McpToolTask` when the client takes no tasks, before it answers
   * with what it has. Default 45 seconds: under the tool timeouts agents apply.
   */
  taskWaitMs?: number;
}

type TaskStatus = 'working' | 'completed' | 'failed' | 'cancelled';
interface TaskRecord {
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  task: McpToolTask;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** What a server keeps between requests: the tasks its tools started. One per server. */
export interface McpServerState {
  readonly tasks: Map<string, TaskRecord>;
}

/** Give it to `handleMcpMessage` and the server offers MCP tasks to the clients that take them. */
export function createMcpState(): McpServerState {
  return { tasks: new Map() };
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const DEFAULT_PROTOCOL = '2025-06-18';
/** The revision without a handshake: each request names its version, each result its type. */
const STATELESS_PROTOCOL = '2026-07-28';
const PROTOCOL_KEY = 'io.modelcontextprotocol/protocolVersion';
const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills';
const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
const CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const TASK_WAIT_MS = 45_000;
const TASK_POLL_MS = 2_000;
/** Finished tasks are kept this long for a client that polls late, and at most this many. */
const TASK_KEEP_MS = 3600_000;
const TASK_KEEP = 200;
/** How long a client may keep a listing: the tools and skills of one server process do not change. */
const LISTING_TTL_MS = 300_000;

/**
 * Answer one MCP message: JSON responses only, no server-sent stream. Both eras are served: a
 * client that starts with `initialize` gets the handshake as before, one that names protocol
 * 2026-07-28 in a request's `_meta` gets that revision's results (and the server's skills).
 * Returns null for notifications (reply 202 with no body).
 */
export async function handleMcpMessage(
  message: unknown,
  tools: readonly McpTool[],
  serverInfo: McpServerInfo,
  state?: McpServerState,
  onNotify?: (notification: object) => void,
): Promise<object | null> {
  if (!isRequest(message)) return rpcError(null, -32600, 'invalid request');
  const { id, method, params } = message;
  const { instructions, skills = [], taskWaitMs = TASK_WAIT_MS, ...info } = serverInfo;
  if (id === undefined) return null;
  const asked = isObject(params?._meta) ? params._meta[PROTOCOL_KEY] : undefined;
  const stateless = asked !== undefined || method === 'server/discover';
  if (stateless && asked !== undefined && asked !== STATELESS_PROTOCOL) {
    return rpcError(id, -32022, 'Unsupported protocol version', {
      supported: [STATELESS_PROTOCOL],
      requested: asked,
    });
  }
  // The newer revision wants every result to say it is whole, and listings how long they hold.
  // Nothing here is shared between users: what the tools return is this machine's own.
  const whole = (value: Record<string, unknown>) =>
    result(id, stateless ? { resultType: 'complete', ...value } : value);
  const listing = (value: Record<string, unknown>) =>
    whole(stateless ? { ...value, ttlMs: LISTING_TTL_MS, cacheScope: 'private' } : value);
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: info,
        ...(instructions ? { instructions } : {}),
      });
    case 'server/discover':
      return listing({
        supportedVersions: [STATELESS_PROTOCOL],
        capabilities: {
          tools: {},
          ...(skills.length ? { resources: {} } : {}),
          ...(skills.length || state
            ? {
                extensions: {
                  ...(skills.length ? { [SKILLS_EXTENSION]: {} } : {}),
                  ...(state ? { [TASKS_EXTENSION]: {} } : {}),
                },
              }
            : {}),
        },
        _meta: { 'io.modelcontextprotocol/serverInfo': info },
        ...(instructions ? { instructions } : {}),
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return listing({
        tools: tools.map(({ name, description, inputSchema, _meta }) => ({
          name,
          description,
          inputSchema,
          ...(_meta ? { _meta } : {}),
        })),
      });
    case 'skills/list':
      if (!stateless) break;
      return listing({ skills: skills.map(skillEntry) });
    case 'skills/get': {
      if (!stateless) break;
      const skill = skills.find((candidate) => skillUri(candidate) === params?.uri);
      if (!skill) return rpcError(id, -32602, `unknown skill ${String(params?.uri)}`);
      return listing({ skill: skillEntry(skill) });
    }
    case 'resources/list':
      if (!stateless) break;
      return listing({
        resources: skills.map((skill) => ({
          uri: skillUri(skill),
          name: skill.name,
          description: skill.description,
          mimeType: 'text/markdown',
        })),
      });
    case 'resources/read': {
      if (!stateless) break;
      const skill = skills.find((candidate) => skillUri(candidate) === params?.uri);
      if (!skill) return rpcError(id, -32602, `unknown resource ${String(params?.uri)}`);
      return listing({ contents: [{ uri: skillUri(skill), mimeType: 'text/markdown', text: skillText(skill) }] });
    }
    case 'tools/call': {
      const tool = tools.find((candidate) => candidate.name === params?.name);
      if (!tool) return rpcError(id, -32602, `unknown tool ${String(params?.name)}`);
      const args = isObject(params?.arguments) ? params.arguments : {};
      const meta = isObject(params?._meta) ? params._meta : {};
      const capabilities = stateless && isObject(meta[CAPABILITIES_KEY]) ? meta[CAPABILITIES_KEY] : {};
      const token = meta.progressToken;
      const progressToken = typeof token === 'string' || typeof token === 'number' ? token : undefined;
      const context: McpCallContext = {
        capabilities,
        ...(stateless && isObject(params?.inputResponses) ? { inputResponses: params.inputResponses } : {}),
        ...(stateless && typeof params?.requestState === 'string' ? { requestState: params.requestState } : {}),
        ...(onNotify && progressToken !== undefined
          ? {
              progress(progress: number, total?: number, message?: string) {
                onNotify({
                  jsonrpc: '2.0',
                  method: 'notifications/progress',
                  params: {
                    progressToken,
                    progress,
                    ...(total !== undefined ? { total } : {}),
                    ...(message !== undefined ? { message } : {}),
                  },
                });
              },
            }
          : {}),
      };
      try {
        const output = await tool.call(args, context);
        const task = typeof output === 'string' ? undefined : output.task;
        if (!task) return whole(contentOf(output));
        const takesTasks = isObject(capabilities.extensions) && isObject(capabilities.extensions[TASKS_EXTENSION]);
        if (state && takesTasks) return result(id, startTask(state, task, outputText(output)));
        // No tasks for this client: the answer if it comes soon, else what can be said now.
        const settled = await soon(task.result, taskWaitMs);
        if (!settled) return whole(contentOf(output));
        return whole(contentOf(settled.value, outputText(output)));
      } catch (error) {
        if (error instanceof McpInputRequired && stateless) {
          return result(id, {
            resultType: 'input_required',
            inputRequests: error.inputRequests,
            ...(error.requestState !== undefined ? { requestState: error.requestState } : {}),
          });
        }
        return whole({ content: [{ type: 'text', text: (error as Error).message }], isError: true });
      }
    }
    case 'tasks/get': {
      const record = stateless && typeof params?.taskId === 'string' ? state?.tasks.get(params.taskId) : undefined;
      if (!record) return rpcError(id, -32602, `unknown task ${String(params?.taskId)}`);
      return whole(taskView(record));
    }
    case 'tasks/cancel': {
      const record = stateless && typeof params?.taskId === 'string' ? state?.tasks.get(params.taskId) : undefined;
      if (!record) return rpcError(id, -32602, `unknown task ${String(params?.taskId)}`);
      if (record.status === 'working') {
        record.status = 'cancelled';
        record.lastUpdatedAt = new Date().toISOString();
        try {
          record.task.cancel?.();
        } catch {
          // The work may not stop; the client is told it was let go.
        }
      }
      return whole({});
    }
    case 'tasks/update':
      // Nothing here asks for input while a task runs.
      if (!stateless || !state) break;
      return whole({});
  }
  return rpcError(id, -32601, `method not found: ${method}`);
}

function contentOf(output: ToolOutput, before?: string): Record<string, unknown> {
  const images = typeof output === 'string' ? [] : (output.images ?? []);
  const text = outputText(output);
  return {
    content: [
      { type: 'text', text: before ? `${before}\n\n${text}` : text },
      ...images.map((image) => ({ type: 'image', mimeType: image.mimeType, data: image.data })),
    ],
  };
}

/** `promise`'s value if it settles within `ms`; a rejection passes through. */
function soon<T>(promise: Promise<T>, ms: number): Promise<{ value: T } | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ value });
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function startTask(state: McpServerState, task: McpToolTask, said: string): Record<string, unknown> {
  const now = Date.now();
  // Room first: finished tasks nobody asked about for an hour, then the oldest finished ones.
  for (const [key, old] of state.tasks) {
    const done = old.status !== 'working';
    if (done && (now - Date.parse(old.lastUpdatedAt) > TASK_KEEP_MS || state.tasks.size >= TASK_KEEP)) {
      state.tasks.delete(key);
    }
  }
  const at = new Date(now).toISOString();
  const record: TaskRecord = { taskId: randomUUID(), status: 'working', createdAt: at, lastUpdatedAt: at, task };
  state.tasks.set(record.taskId, record);
  const end = (status: TaskStatus, outcome: Pick<TaskRecord, 'result' | 'error'>) => {
    // A cancelled task stays cancelled, whatever the work came to afterwards.
    if (record.status !== 'working') return;
    Object.assign(record, outcome, { status, lastUpdatedAt: new Date().toISOString() });
  };
  task.result.then(
    (output) => end('completed', { result: contentOf(output) }),
    (error: unknown) =>
      end('failed', { error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }),
  );
  return { ...taskView(record), resultType: 'task', statusMessage: said };
}

function taskView(record: TaskRecord): Record<string, unknown> {
  let doing: string | undefined;
  try {
    doing = record.status === 'working' ? record.task.status?.() : undefined;
  } catch {
    doing = undefined;
  }
  return {
    taskId: record.taskId,
    status: record.status,
    ...(doing ? { statusMessage: doing } : {}),
    createdAt: record.createdAt,
    lastUpdatedAt: record.lastUpdatedAt,
    ttlMs: null,
    pollIntervalMs: TASK_POLL_MS,
    ...(record.result ? { result: record.result } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

const skillUri = (skill: McpSkill) => `skill://${skill.name}/SKILL.md`;

/** A skill's `SKILL.md`: the frontmatter agents index it by, then the body. */
export function skillText(skill: McpSkill): string {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body.trim()}\n`;
}

/** Split a `SKILL.md` into the skill it describes; undefined without `name` and `description`. */
export function parseSkill(source: string): McpSkill | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return undefined;
  const field = (key: string) => {
    const value = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(match[1]!)?.[1]?.trim();
    if (!value) return undefined;
    // Quoted as YAML allows: single quotes double themselves, double quotes read as JSON.
    if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
    if (!value.startsWith('"')) return value;
    try {
      return String(JSON.parse(value));
    } catch {
      return value;
    }
  };
  const name = field('name');
  const description = field('description');
  return name && description ? { name, description, body: match[2]!.trim() } : undefined;
}

function skillEntry(skill: McpSkill) {
  const text = Buffer.from(skillText(skill), 'utf8');
  return {
    uri: skillUri(skill),
    frontmatter: { name: skill.name, description: skill.description },
    resources: [
      { uri: skillUri(skill), digest: `sha256:${createHash('sha256').update(text).digest('hex')}`, size: text.length },
    ],
  };
}

function result(id: string | number | null, value: unknown) {
  return { jsonrpc: '2.0', id, result: value };
}

function rpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return isObject(value) && value.jsonrpc === '2.0' && typeof value.method === 'string';
}
