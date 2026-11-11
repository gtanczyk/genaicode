import { argumentProblems, toolText, type PageTool } from './tools.js';

/** The WebMCP entry point as browsers ship it: `document.modelContext`, earlier `navigator.modelContext`. */
interface ModelContext {
  registerTool(tool: Record<string, unknown>, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): unknown;
  getTools?(): Promise<RegisteredTool[]>;
  executeTool?(tool: RegisteredTool, input?: object, options?: { signal?: AbortSignal }): Promise<string>;
}

interface RegisteredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown> | string;
  annotations?: { readOnlyHint?: boolean };
}

export interface ExposeWebMcpOptions {
  /**
   * Ask the user before a `write` tool runs for an outside agent; resolve false to refuse.
   * Default: the browser's own `confirm()` dialog with the tool's summary.
   */
  confirm?(tool: PageTool, args: Record<string, unknown>): boolean | Promise<boolean>;
  /** Called after every call an outside agent made, e.g. to show it on the page. */
  onCall?(call: { tool: string; args: Record<string, unknown>; output?: string; error?: string }): void;
}

function modelContext(): { context: ModelContext; legacy: boolean } | undefined {
  const onDocument = (globalThis as { document?: { modelContext?: ModelContext } }).document?.modelContext;
  if (onDocument && typeof onDocument.registerTool === 'function') return { context: onDocument, legacy: false };
  const onNavigator = (globalThis as { navigator?: { modelContext?: ModelContext } }).navigator?.modelContext;
  if (onNavigator && typeof onNavigator.registerTool === 'function') return { context: onNavigator, legacy: true };
  return undefined;
}

/** Whether this browser has WebMCP, so agents outside the page (the browser's own, extensions) can see its tools. */
export function webMcpSupported(): boolean {
  return modelContext() !== undefined;
}

/**
 * Offer the page's tools to agents outside it over WebMCP (`document.modelContext`): the
 * browser's own assistant or an extension can then call the same functions your in-page agent
 * uses, instead of guessing at the DOM. `write` tools are marked consequential and run only
 * after `confirm`. Does nothing where WebMCP is missing. Returns a function that takes the
 * tools back.
 */
export function exposeWebMcp(tools: readonly PageTool[], options: ExposeWebMcpOptions = {}): () => void {
  const found = modelContext();
  if (!found) return () => {};
  const { context, legacy } = found;
  const controller = new AbortController();
  const registered: string[] = [];

  for (const tool of tools) {
    const execute = async (input: unknown) => {
      const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      try {
        const problems = argumentProblems(tool, args);
        if (problems.length) throw new Error(`Bad arguments: ${problems.join('; ')}.`);
        tool.validate?.(args);
        if (tool.write) {
          const allowed = options.confirm
            ? await options.confirm(tool, args)
            : defaultConfirm(tool.summary?.(args) ?? `${tool.name} ${JSON.stringify(args)}`);
          if (!allowed) throw new Error('The user declined this action.');
        }
        const output = toolText(await tool.run(args, controller.signal));
        options.onCall?.({ tool: tool.name, args, output });
        // The first implementations expect an MCP tool result; the draft takes any value.
        return legacy ? { content: [{ type: 'text', text: output }] } : output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.onCall?.({ tool: tool.name, args, error: message });
        if (legacy) return { content: [{ type: 'text', text: message }], isError: true };
        throw error;
      }
    };
    try {
      const pending = context.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
          annotations: { readOnlyHint: !tool.write, consequentialHint: !!tool.write },
          execute,
        },
        { signal: controller.signal },
      );
      // The draft returns a promise; a refused tool (a taken name) must not break the page.
      if (pending instanceof Promise) pending.catch(() => {});
      registered.push(tool.name);
    } catch {
      // A name another script registered, or a schema this browser refuses: skip the tool.
    }
  }

  return () => {
    controller.abort();
    for (const name of registered) {
      try {
        const pending = context.unregisterTool?.(name);
        if (pending instanceof Promise) pending.catch(() => {});
      } catch {
        // Already gone with the signal.
      }
    }
  };
}

function defaultConfirm(summary: string): boolean {
  const ask = (globalThis as { confirm?: (message: string) => boolean }).confirm;
  return typeof ask === 'function' ? ask(`An AI agent wants to: ${summary}`) : false;
}

/**
 * The tools this page has registered over WebMCP, by any script or by annotated forms, as
 * `PageTool`s: pass them to `nano` or `createPageAgent` and the in-page agent uses what the
 * page already offers other agents. Tools not marked read-only count as `write`. Empty where the
 * browser cannot list tools (`getTools` is in the WebMCP draft, not in every implementation).
 */
export async function webMcpTools(): Promise<PageTool[]> {
  const context = modelContext()?.context;
  if (!context || typeof context.getTools !== 'function' || typeof context.executeTool !== 'function') return [];
  let listed: RegisteredTool[];
  try {
    listed = await context.getTools();
  } catch {
    return [];
  }
  return listed.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: parseSchema(tool.inputSchema),
    write: tool.annotations?.readOnlyHint !== true,
    run: (args, signal) => context.executeTool!(tool, args, { signal }),
  }));
}

function parseSchema(schema: RegisteredTool['inputSchema']): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  if (typeof schema !== 'string') return schema;
  try {
    return JSON.parse(schema) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
