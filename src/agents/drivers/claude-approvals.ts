import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { askApproval } from '../live-agent.js';
import type { ApprovalHandler, ApprovalRequest } from '../types.js';
import { isObject, stringField, type JsonObject } from './json.js';

/** Name of the permission prompt tool `claudeApprovalTool` serves. */
export const CLAUDE_APPROVAL_TOOL = 'approve';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_BODY_BYTES = 1024 * 1024;
const DENIED = 'Permission denied by the user, or the request was withdrawn.';

/** An MCP `tools/call` result. */
export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/**
 * Claude Code's permission prompt tool (`--permission-prompt-tool`) as an MCP tool an app
 * can serve from its own MCP server. Claude calls it with the tool name and input it wants
 * to use; the answer allows exactly that input, or denies.
 */
export interface ClaudeApprovalTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
  /**
   * Answer one call: ask `onApproval`, then reply in Claude's format. Malformed arguments,
   * a missing or throwing handler, and `signal` aborting (the caller disconnected) all deny.
   */
  call(args: unknown, signal?: AbortSignal): Promise<McpToolResult>;
}

/** Build the permission prompt tool around an approval handler. */
export function claudeApprovalTool(
  onApproval: ApprovalHandler | undefined,
  options: { name?: string } = {},
): ClaudeApprovalTool {
  return {
    name: options.name ?? CLAUDE_APPROVAL_TOOL,
    description: 'Asks the user whether Claude may run this exact tool call.',
    inputSchema: {
      type: 'object',
      properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
      required: ['tool_name', 'input'],
    },
    async call(args, signal = new AbortController().signal) {
      const request = claudeApprovalRequest(args);
      const decision = request ? await askApproval({ onApproval }, request, signal) : 'deny';
      const input = isObject(args) ? args.input : undefined;
      // `updatedInput` is the input Claude asked about, unchanged: approving never rewrites it.
      const answer =
        decision === 'approve' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: DENIED };
      return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
    },
  };
}

/** The approval request for one permission prompt tool call, or undefined when the call is malformed. */
export function claudeApprovalRequest(args: unknown): ApprovalRequest | undefined {
  if (!isObject(args) || !isObject(args.input)) return undefined;
  const tool = stringField(args, 'tool_name');
  if (!tool || tool.length > 200) return undefined;
  if (args.tool_use_id !== undefined && typeof args.tool_use_id !== 'string') return undefined;
  const input = args.input;
  const kind: ApprovalRequest['kind'] = tool === 'Bash' ? 'command' : EDIT_TOOLS.has(tool) ? 'file-change' : 'other';
  const target =
    tool === 'Bash'
      ? stringField(input, 'command')
      : (stringField(input, 'file_path') ?? stringField(input, 'notebook_path') ?? stringField(input, 'url'));
  return {
    id: stringField(args, 'tool_use_id') || `claude-${randomUUID()}`,
    kind,
    scope: 'once',
    summary: target ? `${tool}: ${target}` : tool,
    detail: args,
  };
}

/** How long Claude waits for an answer: a day, where its default MCP tool timeout is 60 s. */
const APPROVAL_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * Environment for a Claude process whose permission prompts wait on a person. Claude gives up
 * on an MCP tool call after 60 s by default (`MCP_TOOL_TIMEOUT`), which would fail the tool
 * call while the question is still open. Empty when `env` already sets a timeout.
 */
export function claudeApprovalEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return env.MCP_TOOL_TIMEOUT ? {} : { MCP_TOOL_TIMEOUT: String(APPROVAL_WAIT_MS) };
}

/** Claude Code arguments that route its permission prompts to `tool` on MCP server `server`. */
export function claudeApprovalArgs(server: string, tool = CLAUDE_APPROVAL_TOOL): string[] {
  return ['--permission-prompt-tool', `mcp__${server}__${tool}`];
}

export interface ClaudeApprovalServer {
  /** The MCP server to add to Claude's `--mcp-config`. Its bearer token is in `headers`. */
  server: { name: string; url: string; headers: Record<string, string> };
  /** `--permission-prompt-tool` for that server. */
  args: string[];
  /** Stop serving. Open questions are withdrawn (their signals abort) and denied. */
  close(): Promise<void>;
}

/**
 * Serve `claudeApprovalTool` alone over MCP (streamable HTTP, JSON responses) on a random
 * loopback port, behind a random bearer token. For apps that have no MCP server of their own
 * to mount the tool on; `claude()` uses it for `task.onApproval`.
 */
export async function startClaudeApprovalServer(
  onApproval: ApprovalHandler | undefined,
  options: { name?: string } = {},
): Promise<ClaudeApprovalServer> {
  const name = options.name ?? 'genaicode_approval';
  const tool = claudeApprovalTool(onApproval);
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const closing = new AbortController();
  let port = 0;

  const authorized = (request: IncomingMessage) => {
    const given = Buffer.from(request.headers.authorization ?? '');
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
  const loopbackHost = (request: IncomingMessage) =>
    [`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? '');

  const handle = async (message: unknown, signal: AbortSignal): Promise<JsonObject | undefined> => {
    if (!isObject(message) || typeof message.method !== 'string') return rpcError(null, -32600, 'Invalid request.');
    const id = message.id;
    if (id === undefined || id === null) return undefined; // A notification needs no answer.
    const params = isObject(message.params) ? message.params : {};
    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: stringField(params, 'protocolVersion') ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'genaicode-approval', version: '1' },
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }] },
        };
      case 'tools/call':
        if (params.name !== tool.name) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}.`);
        return { jsonrpc: '2.0', id, result: await tool.call(params.arguments, signal) };
      default:
        return rpcError(id, -32601, `${message.method} is not supported.`);
    }
  };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (!loopbackHost(request)) return reply(response, 403);
    if (!authorized(request)) return reply(response, 401);
    if (request.method !== 'POST' || request.url?.split('?')[0] !== '/mcp') return reply(response, 405);
    // A caller that hangs up withdraws its question.
    const gone = new AbortController();
    response.once('close', () => gone.abort());
    const signal = AbortSignal.any([closing.signal, gone.signal]);
    readBody(request).then(
      async (body) => {
        let message: unknown;
        try {
          message = JSON.parse(body);
        } catch {
          return reply(response, 400, rpcError(null, -32700, 'Parse error.'));
        }
        const answers = Array.isArray(message)
          ? (await Promise.all(message.map((part) => handle(part, signal)))).filter(Boolean)
          : [await handle(message, signal)].filter(Boolean);
        if (!answers.length) return reply(response, 202);
        reply(response, 200, Array.isArray(message) ? answers : answers[0]);
      },
      () => reply(response, 413),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  server.unref();

  return {
    server: { name, url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } },
    args: claudeApprovalArgs(name, tool.name),
    close() {
      closing.abort();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

function rpcError(id: unknown, code: number, message: string): JsonObject {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function reply(response: ServerResponse, status: number, body?: unknown): void {
  if (response.headersSent || response.destroyed) return;
  if (body === undefined) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}
