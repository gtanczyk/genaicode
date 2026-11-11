import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { handleMcpMessage, type McpTool } from './mcp-tools.js';
import type { Artifact, McpServer } from './types.js';

/** The MCP tool agents call to publish an artifact. */
export const PUBLISH_ARTIFACT_TOOL = 'publish_artifact';

export interface ArtifactStoreOptions {
  /** Files are published from inside this directory only. A function is read on every publish. */
  cwd: string | (() => string);
  /** Largest artifact, in bytes. Default 5 MB. */
  maxBytes?: number;
  /** Most artifacts kept; the oldest is dropped beyond that. Default 30. */
  maxArtifacts?: number;
}

export interface PublishArtifact {
  title: string;
  /** A file inside `cwd`. Its content is copied now; later edits need another publish. */
  path?: string;
  /** The content itself, instead of `path`. */
  content?: string;
  /** What `content` is. Default `text`. Ignored with `path`, where the extension decides. */
  format?: 'html' | 'markdown' | 'text' | 'svg';
  /** Publish under the same name again to replace the content. Default: `path`, else the title. */
  name?: string;
}

/** Artifacts an agent published, with a copy of their content, held in memory. */
export interface ArtifactStore {
  /** Throws `ArtifactError` when the request is refused (outside cwd, secret file, too large...). */
  publish(input: PublishArtifact): Promise<Artifact>;
  list(): Artifact[];
  /** The artifact and the content of its latest version. */
  read(id: string): { artifact: Artifact; body: Buffer } | undefined;
  /** Forget every artifact; their addresses stop working. */
  clear(): void;
  /** Called after every publish. Returns the unsubscribe function. */
  subscribe(listener: (artifact: Artifact) => void): () => void;
  /** The `publish_artifact` tool, to mount on an MCP server the agent is given. */
  tool(): McpTool;
}

/** A publish request the store refused. The message is safe to show the agent. */
export class ArtifactError extends Error {
  override name = 'ArtifactError';
}

const TEXT = 'text/plain; charset=utf-8';
// Extension → what the browser is told. Anything else downloads as a file.
const TYPES: Record<string, { kind: Artifact['kind']; mimeType: string }> = {
  '.html': { kind: 'html', mimeType: 'text/html; charset=utf-8' },
  '.htm': { kind: 'html', mimeType: 'text/html; charset=utf-8' },
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.gif': { kind: 'image', mimeType: 'image/gif' },
  '.webp': { kind: 'image', mimeType: 'image/webp' },
  '.avif': { kind: 'image', mimeType: 'image/avif' },
  '.svg': { kind: 'image', mimeType: 'image/svg+xml' },
  '.md': { kind: 'text', mimeType: 'text/markdown; charset=utf-8' },
  ...Object.fromEntries(
    ['.txt', '.log', '.json', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.diff', '.patch'].map((ext) => [
      ext,
      { kind: 'text' as const, mimeType: TEXT },
    ]),
  ),
};
const FORMATS: Record<NonNullable<PublishArtifact['format']>, string> = {
  html: '.html',
  markdown: '.md',
  text: '.txt',
  svg: '.svg',
};

// Folders and files that hold credentials. An agent with a shell can read them anyway; this
// keeps a confused or prompt-injected agent from putting them on screen through this tool.
const SECRET_DIRS = new Set(['.git', '.genaicode', '.ssh', '.aws', '.gnupg', '.kube', '.docker']);
const SECRET_FILE =
  /^(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519).*|.*\.(pem|key|p12|pfx|keystore))$/i;

export function createArtifactStore(options: ArtifactStoreOptions): ArtifactStore {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxArtifacts = Math.max(1, options.maxArtifacts ?? 30);
  // Insertion order is age: a republished artifact moves to the end.
  const byName = new Map<string, { artifact: Artifact; body: Buffer }>();
  const listeners = new Set<(artifact: Artifact) => void>();

  const fromFile = async (path: string) => {
    let root: string;
    let real: string;
    try {
      root = await fs.realpath(typeof options.cwd === 'function' ? options.cwd() : options.cwd);
      // Through symlinks: a link inside the workspace must not reach a file outside it.
      real = await fs.realpath(resolve(root, path));
    } catch {
      throw new ArtifactError(`No such file: ${path}`);
    }
    const inside = relative(root, real);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new ArtifactError('Only files inside the working directory can be published.');
    }
    const parts = inside.split(sep);
    if (parts.slice(0, -1).some((part) => SECRET_DIRS.has(part)) || SECRET_FILE.test(parts.at(-1)!)) {
      throw new ArtifactError(`${inside} looks like a credential or internal file and cannot be published.`);
    }
    const file = await fs.open(real, 'r').catch(() => {
      throw new ArtifactError(`Cannot read ${path}.`);
    });
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new ArtifactError(`${path} is not a file.`);
      if (stat.size > maxBytes) throw new ArtifactError(tooLarge(stat.size, maxBytes));
      const body = await file.readFile();
      // The file may have grown since `stat`.
      if (body.length > maxBytes) throw new ArtifactError(tooLarge(body.length, maxBytes));
      return { body, relative: parts.join('/') };
    } finally {
      await file.close();
    }
  };

  const store: ArtifactStore = {
    async publish(input) {
      const title = clean(input.title, 200);
      if (!title) throw new ArtifactError('title is required.');
      const hasPath = typeof input.path === 'string' && input.path !== '';
      const hasContent = typeof input.content === 'string';
      if (hasPath === hasContent) throw new ArtifactError('Give either path or content.');

      let body: Buffer;
      let extension: string;
      let path: string | undefined;
      if (hasPath) {
        const file = await fromFile(input.path!);
        body = file.body;
        path = file.relative;
        extension = extname(path).toLowerCase();
      } else {
        body = Buffer.from(input.content!, 'utf8');
        if (body.length > maxBytes) throw new ArtifactError(tooLarge(body.length, maxBytes));
        const format = input.format ?? 'text';
        if (!Object.hasOwn(FORMATS, format)) throw new ArtifactError('format must be html, markdown, text or svg.');
        extension = FORMATS[format];
      }
      const type = TYPES[extension] ?? { kind: 'file' as const, mimeType: 'application/octet-stream' };
      const name = clean(input.name, 200) || path || title;
      const before = byName.get(name);
      const artifact: Artifact = {
        id: before?.artifact.id ?? randomBytes(16).toString('hex'),
        name,
        title,
        kind: type.kind,
        mimeType: type.mimeType,
        bytes: body.length,
        version: (before?.artifact.version ?? 0) + 1,
        ...(path ? { path } : {}),
      };
      byName.delete(name);
      byName.set(name, { artifact, body });
      while (byName.size > maxArtifacts) byName.delete(byName.keys().next().value!);
      for (const listener of [...listeners]) {
        try {
          listener(artifact);
        } catch {
          // A failing subscriber must not fail the publish.
        }
      }
      return artifact;
    },
    list: () => [...byName.values()].map((entry) => entry.artifact),
    read(id) {
      for (const entry of byName.values()) if (entry.artifact.id === id) return entry;
      return undefined;
    },
    clear: () => byName.clear(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tool: () => ({
      name: PUBLISH_ARTIFACT_TOOL,
      description:
        'Show the user something to look at in the chat: a report, a chart, a diagram, a mockup, an image or a ' +
        'document. Give `path` (a file in the working directory) or `content` with `format`. The user sees a card ' +
        'and opens it in a preview. HTML runs in a sandbox with no network: make it one self-contained file with ' +
        'inline CSS and JS and data: images; nothing loads from a CDN. The content is copied when you call this, ' +
        'so call it again with the same `name` after you change it. Not for source files the user edits: just edit those.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title shown on the card.' },
          path: { type: 'string', description: 'File to publish, relative to the working directory.' },
          content: { type: 'string', description: 'The content itself, instead of path.' },
          format: {
            type: 'string',
            enum: Object.keys(FORMATS),
            description: 'What content is. Default text. With path the file extension decides.',
          },
          name: { type: 'string', description: 'Stable name; publish the same name again to replace it.' },
        },
        required: ['title'],
      },
      async call(args) {
        const text = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
        const artifact = await store.publish({
          title: text('title') ?? '',
          path: text('path'),
          content: text('content'),
          format: text('format') as PublishArtifact['format'],
          name: text('name'),
        });
        const again = artifact.version > 1 ? `, version ${artifact.version}` : '';
        return `Published "${artifact.title}" (${artifact.kind}${again}). The user can open it from the chat.`;
      },
    }),
  };
  return store;
}

function clean(value: string | undefined, max: number): string {
  // Control characters would break headers and terminal rows.
  return typeof value === 'string'
    ? value
        .replace(/\p{Cc}+/gu, ' ')
        .trim()
        .slice(0, max)
    : '';
}

function tooLarge(bytes: number, max: number): string {
  return `Too large: ${bytes} bytes, the limit is ${max}.`;
}

// What an HTML artifact may do: run its own inline code and nothing else. No network (so it
// cannot send what it shows anywhere), no forms, and `sandbox` gives it an origin of its own
// even when the URL is opened directly, so it never reads the host page's cookies or storage.
const HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "form-action 'none'",
  "base-uri 'none'",
  "webrtc 'block'",
  'sandbox allow-scripts',
].join('; ');
// Everything else is inert: an SVG opened directly must not run its scripts.
const INERT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * The HTTP response for an artifact's content, for the host that serves it (`genaicode ui`
 * does, at `/artifacts/<id>`). Serve it with these headers unchanged: they are what keeps
 * agent-written HTML away from the page that shows it.
 */
export function artifactResponse(artifact: Artifact, body: Buffer): { headers: Record<string, string>; body: Buffer } {
  const fallback = FORMATS[artifact.kind === 'html' ? 'html' : 'text'];
  const filename =
    basename(artifact.path ?? '') || `${artifact.title.replace(/[^\w.-]+/g, '-') || 'artifact'}${fallback}`;
  return {
    body,
    headers: {
      'content-type': artifact.mimeType,
      'content-length': String(body.length),
      'content-security-policy': artifact.kind === 'html' ? HTML_CSP : INERT_CSP,
      'content-disposition': `${artifact.kind === 'file' ? 'attachment' : 'inline'}; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    },
  };
}

export interface ArtifactChannelOptions extends ArtifactStoreOptions {
  /** MCP server name the agent sees. Default `artifacts`. */
  name?: string;
}

/** An artifact store and the MCP server that lets an agent publish to it. */
export interface ArtifactChannel {
  store: ArtifactStore;
  /** Give this to the agent (`createAgentSession({ artifacts })` does, for agents that take MCP servers). */
  mcpServer: McpServer;
  close(): Promise<void>;
}

/**
 * Serve `publish_artifact` over MCP (streamable HTTP, JSON responses) on a random loopback
 * port, behind a random bearer token. For hosts with no MCP server of their own.
 */
export async function startArtifactChannel(options: ArtifactChannelOptions): Promise<ArtifactChannel> {
  const name = options.name ?? 'artifacts';
  const store = createArtifactStore(options);
  const tools = [store.tool()];
  const expected = Buffer.from(`Bearer ${randomBytes(32).toString('hex')}`);
  // JSON escaping can double the content; the store enforces the real limit.
  const maxBody = (options.maxBytes ?? 5 * 1024 * 1024) * 2 + 64 * 1024;
  let port = 0;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const reply = (status: number, body?: unknown) => {
      if (response.headersSent || response.destroyed) return;
      if (body === undefined) response.writeHead(status).end();
      else response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    // A rebinding domain sends its own name as Host; a browser always sends Origin on POST.
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? '')) return reply(403);
    if (request.headers.origin !== undefined) return reply(403);
    const given = Buffer.from(request.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reply(401);
    if (request.method !== 'POST' || request.url?.split('?')[0] !== '/mcp') return reply(405);
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) {
        reply(413);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', () => reply(400));
    request.once('end', () => {
      let message: unknown;
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      }
      handleMcpMessage(message, tools, { name: `genaicode-${name}`, version: '1' }).then(
        (answer) => (answer === null ? reply(202) : reply(200, answer)),
        () => reply(500),
      );
    });
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
    store,
    mcpServer: { name, url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: expected.toString() } },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
