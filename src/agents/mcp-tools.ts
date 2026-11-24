import { createHash } from 'node:crypto';

/** What a tool returns: text, or text with images (e.g. a screenshot the agent should look at). */
export type ToolOutput = string | { text: string; images?: ReadonlyArray<{ mimeType: string; data: string }> };

/** A tool the app serves to the agent over MCP. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Client-specific MCP metadata advertised by `tools/list`. */
  _meta?: Readonly<Record<string, unknown>>;
  call(args: Record<string, unknown>): Promise<ToolOutput>;
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
): Promise<object | null> {
  if (!isRequest(message)) return rpcError(null, -32600, 'invalid request');
  const { id, method, params } = message;
  const { instructions, skills = [], ...info } = serverInfo;
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
          ...(skills.length ? { resources: {}, extensions: { [SKILLS_EXTENSION]: {} } } : {}),
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
      try {
        const output = await tool.call(args);
        const images = typeof output === 'string' ? [] : (output.images ?? []);
        return whole({
          content: [
            { type: 'text', text: outputText(output) },
            ...images.map((image) => ({ type: 'image', mimeType: image.mimeType, data: image.data })),
          ],
        });
      } catch (error) {
        return whole({ content: [{ type: 'text', text: (error as Error).message }], isError: true });
      }
    }
  }
  return rpcError(id, -32601, `method not found: ${method}`);
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
