import type { ManagedStart, ManagedUsage } from '../managed.js';
import type { McpServer } from '../types.js';
import { tokenCount } from '../usage.js';

/** Helpers the HTTP-based managed drivers (Gemini, OpenAI, Cursor) share. */

/** An HTTP error with its status, which `failureOfError` classifies (429 quota, 5xx unavailable...). */
export class ManagedHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ManagedHttpError';
  }
}

/** A failed response as an error: method, route (no query) and the API's own message. */
export async function httpError(
  name: string,
  method: string,
  path: string,
  response: Response,
): Promise<ManagedHttpError> {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: string | { message?: string } };
      detail = (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ?? text;
    } catch {
      detail = text;
    }
  } catch {
    // The status says enough.
  }
  const route = path.split('?')[0];
  return new ManagedHttpError(
    `${name}: ${method} ${route} failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
    response.status,
  );
}

/** Two usage reports added up, details included. */
export function addUsage(a: ManagedUsage | undefined, b: ManagedUsage | undefined): ManagedUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  const out: ManagedUsage = {};
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const) {
    const value = sum(a[key], b[key]);
    if (value !== undefined) out[key] = value;
  }
  out.totalTokens = tokenCount(a) + tokenCount(b);
  const details: Record<string, number> = { ...a.details };
  for (const [key, value] of Object.entries(b.details ?? {})) details[key] = (details[key] ?? 0) + value;
  if (Object.keys(details).length) out.details = details;
  return out;
}

/** The remote MCP servers of a start request. */
export function remoteServers(start: ManagedStart): Extract<McpServer, { url: string }>[] {
  return (start.mcpServers ?? []).filter((server): server is Extract<McpServer, { url: string }> => 'url' in server);
}

/** Without trailing slashes (a loop: a regular expression is slow on long runs of them). */
export function trimSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

/** Resolves after `ms`, or at once when `signal` aborts. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

/** Text of a content value: a string, `[{ type: 'text' | 'output_text', text }]`, or `{ content }`. */
export function textOf(content: unknown): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const p = part as { type?: unknown; text?: unknown } | null;
        return p && (p.type === 'text' || p.type === 'output_text') ? String(p.text ?? '') : '';
      })
      .join('');
  if (typeof content === 'object' && Array.isArray((content as { content?: unknown }).content))
    return textOf((content as { content: unknown }).content);
  return JSON.stringify(content);
}

/** Server-sent events from a response body. */
export async function* sse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event?: string; id?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
        const message = parseBlock(block);
        if (message) yield message;
      }
      if (done) {
        const message = parseBlock(buffer);
        if (message) yield message;
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseBlock(block: string): { event?: string; id?: string; data: string } | undefined {
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { ...(event ? { event } : {}), ...(id ? { id } : {}), data: data.join('\n') } : undefined;
}
