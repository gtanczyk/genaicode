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
 * The problems with `args` for `tool`, by its `inputSchema`: missing required arguments, wrong
 * types, values outside an `enum`, a `const`, numeric bounds, string and array lengths, a
 * `pattern`, and the same inside nested objects and arrays. It covers what tools declare in
 * practice, not all of JSON Schema (no `$ref`, `oneOf` or `format`); `tool.validate` does the rest.
 * An argument the schema does not name is a problem only where the schema says
 * `additionalProperties: false`.
 */
export function argumentProblems(tool: Pick<PageTool, 'inputSchema'>, args: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (tool.inputSchema) check({ type: 'object', ...tool.inputSchema }, args, '', problems);
  return problems;
}

type Schema = Record<string, unknown>;
const isSchema = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value);
const article = (noun: string) => (/^[aeio]/.test(noun) ? 'an' : 'a');

function typeOf(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

function isType(value: unknown, type: string): boolean {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeOf(value) === type;
}

/** JSON equality: the order of an object's keys does not matter. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]))
    );
  }
  if (!isSchema(a) || !isSchema(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && same(a[key], b[key]));
}

/** `value / step` is whole, give or take what floating point loses (0.3 / 0.1 is 2.9999999999999996). */
function isMultiple(value: number, step: number): boolean {
  const quotient = value / step;
  return Math.abs(quotient - Math.round(quotient)) <= 1e-9 * Math.max(1, Math.abs(quotient));
}

function check(schema: Schema, value: unknown, path: string, problems: string[]): void {
  const name = `"${path}"`;
  if ('const' in schema && !same(schema.const, value)) {
    problems.push(`${name} must be ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => same(item, value))) {
    problems.push(`${name} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return;
  }
  const types = typeof schema.type === 'string' ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
  const named = types.filter((type): type is string => typeof type === 'string');
  if (named.length && !named.some((type) => isType(value, type))) {
    problems.push(`${name} must be ${named.map((type) => `${article(type)} ${type}`).join(' or ')}`);
    return;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      problems.push(
        value ? `${name} is too short (at least ${schema.minLength} characters)` : `${name} must not be empty`,
      );
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      problems.push(`${name} is too long (at most ${schema.maxLength} characters)`);
    }
    if (typeof schema.pattern === 'string') {
      let matches = true;
      try {
        matches = new RegExp(schema.pattern, 'u').test(value);
      } catch {
        // A pattern this engine cannot read decides nothing.
      }
      if (!matches) problems.push(`${name} must match ${schema.pattern}`);
    }
  } else if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      problems.push(`${name} must be at least ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      problems.push(`${name} must be at most ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      problems.push(`${name} must be more than ${schema.exclusiveMinimum}`);
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      problems.push(`${name} must be less than ${schema.exclusiveMaximum}`);
    }
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0 && !isMultiple(value, schema.multipleOf)) {
      problems.push(`${name} must be a multiple of ${schema.multipleOf}`);
    }
  } else if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      problems.push(`${name} needs at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      problems.push(`${name} takes at most ${schema.maxItems} items`);
    }
    if (isSchema(schema.items)) {
      for (const [index, item] of value.entries()) check(schema.items, item, `${path}[${index}]`, problems);
    }
  } else if (isSchema(value)) {
    const properties = isSchema(schema.properties) ? schema.properties : {};
    const at = (key: string) => (path ? `${path}.${key}` : key);
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof key === 'string' && (value[key] === undefined || value[key] === null)) {
        problems.push(`"${at(key)}" is required`);
      }
    }
    for (const [key, item] of Object.entries(value)) {
      // A model writes null for an argument it leaves out.
      if (item === undefined || item === null) continue;
      const property = properties[key];
      if (isSchema(property)) check(property, item, at(key), problems);
      else if (schema.additionalProperties === false) problems.push(`"${at(key)}" is not an argument`);
      else if (isSchema(schema.additionalProperties)) check(schema.additionalProperties, item, at(key), problems);
    }
  }
}
