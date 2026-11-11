/** What a page tool returns: text, or a value that is sent as JSON. */
export type PageToolOutput = string | { text: string } | Record<string, unknown> | unknown[] | number | boolean | null;

/**
 * Something the page lets an agent do: a function with a name, a description and a JSON Schema
 * for its arguments. The same list serves the in-page agent (`nano`, `createPageAgent`) and
 * outside agents over WebMCP (`exposeWebMcp`). It has the shape of `AppTool` from
 * `genaicode/app-agent`, so one definition can serve both a server agent and the page.
 */
export interface PageTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments (an object schema). Default: no arguments. */
  inputSchema?: Record<string, unknown>;
  /** Changes something for the user: it runs only after the user approved the call. */
  write?: boolean;
  /** The one line the user reads before approving a `write` call. Default: the tool and its arguments. */
  summary?(args: Record<string, unknown>): string;
  /** Throw to refuse a call, before anyone is asked to approve it. */
  validate?(args: Record<string, unknown>): void;
  run(args: Record<string, unknown>, signal?: AbortSignal): Promise<PageToolOutput> | PageToolOutput;
}

/** A tool's output as the text an agent reads. */
export function toolText(output: PageToolOutput | undefined): string {
  if (output === undefined || output === null) return 'done';
  if (typeof output === 'string') return output;
  if (typeof output === 'object' && !Array.isArray(output)) {
    const keys = Object.keys(output);
    if (keys.length === 1 && typeof (output as { text?: unknown }).text === 'string') {
      return (output as { text: string }).text;
    }
  }
  try {
    return JSON.stringify(output) ?? String(output);
  } catch {
    return String(output);
  }
}

/** The properties of a tool's argument schema; empty when it takes none. */
export function schemaProperties(tool: Pick<PageTool, 'inputSchema'>): Record<string, Record<string, unknown>> {
  const properties = tool.inputSchema?.properties;
  return properties && typeof properties === 'object' ? (properties as Record<string, Record<string, unknown>>) : {};
}

/**
 * The problems with `args` for `tool`: missing required arguments and values of the wrong basic
 * type or outside an `enum`. A light check for what a small model gets wrong, not a JSON Schema
 * validator; `tool.validate` does the rest.
 */
export function argumentProblems(tool: Pick<PageTool, 'inputSchema'>, args: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const properties = schemaProperties(tool);
  const required = Array.isArray(tool.inputSchema?.required) ? (tool.inputSchema.required as unknown[]) : [];
  for (const name of required) {
    if (typeof name === 'string' && (args[name] === undefined || args[name] === null || args[name] === '')) {
      problems.push(`"${name}" is required`);
    }
  }
  for (const [name, value] of Object.entries(args)) {
    const schema = properties[name];
    if (!schema || value === undefined || value === null) continue;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      problems.push(`"${name}" must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
      continue;
    }
    const type = schema.type;
    if (typeof type !== 'string') continue;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    const matches = type === 'integer' ? Number.isInteger(value) : type === actual;
    if (!matches) problems.push(`"${name}" must be ${/^[aeio]/.test(type) ? 'an' : 'a'} ${type}`);
  }
  return problems;
}
