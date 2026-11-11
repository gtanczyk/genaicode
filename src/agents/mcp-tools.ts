/** What a tool returns: text, or text with images (e.g. a screenshot the agent should look at). */
export type ToolOutput = string | { text: string; images?: ReadonlyArray<{ mimeType: string; data: string }> };

/** A tool the app serves to the agent over MCP. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<ToolOutput>;
}

/** The text of a tool's output, without its images. */
export function outputText(output: ToolOutput): string {
  return typeof output === 'string' ? output : output.text;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const DEFAULT_PROTOCOL = '2025-06-18';

/**
 * Answer one MCP Streamable HTTP message: JSON responses only, no server-sent stream.
 * Returns null for notifications (reply 202 with no body).
 */
export async function handleMcpMessage(
  message: unknown,
  tools: readonly McpTool[],
  serverInfo: { name: string; version: string },
): Promise<object | null> {
  if (!isRequest(message)) return rpcError(null, -32600, 'invalid request');
  const { id, method, params } = message;
  if (id === undefined) return null;
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const tool = tools.find((candidate) => candidate.name === params?.name);
      if (!tool) return rpcError(id, -32602, `unknown tool ${String(params?.name)}`);
      const args = isObject(params?.arguments) ? params.arguments : {};
      try {
        const output = await tool.call(args);
        const images = typeof output === 'string' ? [] : (output.images ?? []);
        return result(id, {
          content: [
            { type: 'text', text: outputText(output) },
            ...images.map((image) => ({ type: 'image', mimeType: image.mimeType, data: image.data })),
          ],
        });
      } catch (error) {
        return result(id, { content: [{ type: 'text', text: (error as Error).message }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

function result(id: string | number | null, value: unknown) {
  return { jsonrpc: '2.0', id, result: value };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return isObject(value) && value.jsonrpc === '2.0' && typeof value.method === 'string';
}
