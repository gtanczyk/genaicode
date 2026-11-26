import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, extname } from 'node:path';
import {
  contentHeaders,
  mediaTypeFor,
  normalizeScriptHosts,
  parseByteRange,
  resolveInRoots,
  type ContentKind,
  type RootsInput,
} from './media.js';
import { startLocalMcpServer } from './mcp-server.js';
import type { McpTool } from './mcp-tools.js';
import type { Artifact, McpServer } from './types.js';

/** The MCP tool agents call to publish an artifact. */
export const PUBLISH_ARTIFACT_TOOL = 'publish_artifact';

export interface ArtifactStoreOptions {
  pool?: ArtifactPool;
  idle?(): boolean;
  /**
   * Files are published from inside these directories only. Accepts one directory, a list of
   * allowed roots, or a function read on every publish (relative paths resolve against the first
   * root first, then the rest in order).
   */
  cwd: RootsInput;
  /**
   * Opt-in CDN hosts HTML artifacts may load scripts, stylesheets and fonts from (e.g.
   * `['cdn.jsdelivr.net', 'unpkg.com']`). Default empty (no network). `connect-src`, `img-src`,
   * `media-src` and `form-action` stay closed. A function is read dynamically on every response
   * and tool listing.
   */
  allowScriptHosts?: readonly string[] | (() => readonly string[]);
  /** Largest artifact, in bytes. Default 5 MB. */
  maxBytes?: number;
  /** Largest audio or video file, in bytes. Default 50 MB, and never less than `maxBytes`. */
  maxMediaBytes?: number;
  /** Most content kept in memory, in bytes; older versions and artifacts are dropped beyond that. Default 200 MB. */
  maxTotalBytes?: number;
  /** Most artifacts kept; the oldest is dropped beyond that. Default 30. */
  maxArtifacts?: number;
}

export interface PublishArtifact {
  title: string;
  /** A file inside an allowed root. Its content is copied now; later edits need another publish. */
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
  /** Throws `ArtifactError` when the request is refused (outside roots, secret file, too large...). */
  publish(input: PublishArtifact): Promise<Artifact>;
  list(): Artifact[];
  /**
   * The artifact and its content. Without `version`, returns the latest version; with `version`,
   * returns that specific version if still retained in memory.
   */
  read(id: string, version?: number): { artifact: Artifact; body: Buffer } | undefined;
  /** All retained versions of `id`, oldest first. */
  versions?(id: string): Artifact[];
  /** Normalized CDN origins allowed for HTML artifacts (`allowScriptHosts`). */
  allowScriptHosts?(): readonly string[];
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

const FORMATS: Record<NonNullable<PublishArtifact['format']>, string> = {
  html: '.html',
  markdown: '.md',
  text: '.txt',
  svg: '.svg',
};

export function createArtifactStore(options: ArtifactStoreOptions): ArtifactStore {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxMediaBytes = Math.max(maxBytes, options.maxMediaBytes ?? 50 * 1024 * 1024);
  const maxTotalBytes = options.maxTotalBytes ?? 200 * 1024 * 1024;
  const maxArtifacts = Math.max(1, options.maxArtifacts ?? 30);
  // Validate static host lists up front; dynamic providers are normalized on every read.
  const staticHosts =
    typeof options.allowScriptHosts === 'function' ? undefined : normalizeScriptHosts(options.allowScriptHosts);
  const allowedHosts = (): readonly string[] => {
    if (typeof options.allowScriptHosts === 'function') {
      try {
        return normalizeScriptHosts(options.allowScriptHosts());
      } catch {
        return [];
      }
    }
    return staticHosts ?? [];
  };

  // Insertion order is age: a republished artifact moves to the end. Each entry keeps versions oldest → newest.
  const byName = new Map<string, Array<{ artifact: Artifact; body: Buffer }>>();
  const listeners = new Set<(artifact: Artifact) => void>();

  const fromFile = async (path: string) => {
    const resolved = await resolveInRoots(path, options.cwd);
    if (!resolved.ok) {
      if (resolved.reason === 'outside') {
        throw new ArtifactError('Only files inside the working directory can be published.');
      }
      if (resolved.reason === 'secret') {
        throw new ArtifactError(
          `${resolved.relative ?? path} looks like a credential or internal file and cannot be published.`,
        );
      }
      throw new ArtifactError(`No such file: ${path}`);
    }
    const { real, relative: rel } = resolved;
    const extension = extname(real).toLowerCase();
    const kind = mediaTypeFor(extension)?.artifactKind;
    const limit = kind === 'audio' || kind === 'video' ? maxMediaBytes : maxBytes;
    const file = await fs.open(real, 'r').catch(() => {
      throw new ArtifactError(`Cannot read ${path}.`);
    });
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new ArtifactError(`${path} is not a file.`);
      if (stat.size > limit) throw new ArtifactError(tooLarge(stat.size, limit));
      const body = await file.readFile();
      // The file may have grown since `stat`.
      if (body.length > limit) throw new ArtifactError(tooLarge(body.length, limit));
      // The type comes from the name the file really has, not from the link that led to it.
      return { body, relative: rel, extension };
    } finally {
      await file.close();
    }
  };

  const totalBytes = () => {
    let sum = 0;
    for (const versions of byName.values()) {
      for (const entry of versions) sum += entry.body.length;
    }
    return sum;
  };

  let unregister: (() => void) | undefined;
  const register = () =>
    (unregister ??= options.pool?.register({
      size: totalBytes,
      idle: options.idle ?? (() => true),
      evict() {
        const oldest = byName.entries().next().value;
        if (!oldest) return false;
        oldest[1].shift();
        if (!oldest[1].length) byName.delete(oldest[0]);
        return true;
      },
    }));
  const trim = () => {
    // First drop superseded older versions before dropping whole artifacts.
    while (totalBytes() > maxTotalBytes) {
      let dropped = false;
      for (const versions of byName.values()) {
        if (versions.length > 1) {
          versions.shift();
          dropped = true;
          break;
        }
      }
      if (!dropped) break;
    }
    // The one just published stays, whatever its size.
    while (byName.size > 1 && (byName.size > maxArtifacts || totalBytes() > maxTotalBytes)) {
      byName.delete(byName.keys().next().value!);
    }
  };

  const toolDescription = () => {
    const hosts = allowedHosts();
    const htmlRule = hosts.length
      ? `HTML runs in a sandbox: fetch, images, media and forms cannot reach the network, except scripts, stylesheets and fonts may load from ${hosts.join(', ')} (prefer pinning versions with Subresource Integrity \`integrity\` attributes). Put everything else inline or as data: URIs.`
      : 'HTML runs in a sandbox with no network: make it one self-contained file with inline CSS and JS and data: images; nothing loads from a CDN.';
    return (
      'Show the user something to look at in the chat: a report, a chart, a diagram, a mockup, a form, an image ' +
      '(a screenshot), a sound, a video or a document. Give `path` (a file in the working directory or an opened ' +
      'session directory; the only way for images, audio and video) or `content` with `format`. The user sees a ' +
      `card and opens it in a preview. ${htmlRule} To ask the user something with a page (a questionnaire, a ` +
      'choice between options), have the page call `parent.postMessage({ genaicode: "submit", data: <JSON> }, "*")` ' +
      'when they are done, e.g. from a button (a <form> cannot submit): the user confirms and you receive `data` ' +
      'as their next message. The content is copied when you call this, so call it again with the same `name` ' +
      'after you change it. Not for source files the user edits: just edit those.'
    );
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
        extension = file.extension;
      } else {
        body = Buffer.from(input.content!, 'utf8');
        if (body.length > maxBytes) throw new ArtifactError(tooLarge(body.length, maxBytes));
        const format = input.format ?? 'text';
        if (!Object.hasOwn(FORMATS, format)) throw new ArtifactError('format must be html, markdown, text or svg.');
        extension = FORMATS[format];
      }
      const media = mediaTypeFor(extension);
      const type = media
        ? { kind: media.artifactKind, mimeType: media.mimeType }
        : { kind: 'file' as const, mimeType: 'application/octet-stream' };
      const name = clean(input.name, 200) || path || title;
      const previous = byName.get(name);
      const latest = previous?.at(-1);
      const artifact: Artifact = {
        id: latest?.artifact.id ?? randomBytes(16).toString('hex'),
        name,
        title,
        kind: type.kind,
        mimeType: type.mimeType,
        bytes: body.length,
        version: (latest?.artifact.version ?? 0) + 1,
        ...(path ? { path } : {}),
      };
      const versions = previous ? [...previous, { artifact, body }] : [{ artifact, body }];
      byName.delete(name);
      byName.set(name, versions);
      trim();
      register();
      options.pool?.trim();
      for (const listener of [...listeners]) {
        try {
          listener(artifact);
        } catch {
          // A failing subscriber must not fail the publish.
        }
      }
      return artifact;
    },
    list: () => [...byName.values()].map((versions) => versions.at(-1)!.artifact),
    read(id, version) {
      for (const versions of byName.values()) {
        if (versions.at(-1)?.artifact.id !== id) continue;
        if (version === undefined) return versions.at(-1);
        return versions.find((entry) => entry.artifact.version === version);
      }
      return undefined;
    },
    versions(id) {
      for (const versions of byName.values()) {
        if (versions.at(-1)?.artifact.id === id) return versions.map((entry) => entry.artifact);
      }
      return [];
    },
    allowScriptHosts: allowedHosts,
    clear() {
      byName.clear();
      unregister?.();
      unregister = undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tool: () => ({
      name: PUBLISH_ARTIFACT_TOOL,
      get description() {
        return toolDescription();
      },
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title shown on the card.' },
          path: { type: 'string', description: 'File to publish, relative to the working directory or absolute.' },
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

export interface ArtifactResponse {
  /** 200, 206 for the part a `Range` asked for, or 416 for a range outside the content. */
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface ArtifactResponseRequest {
  range?: string;
  /** Opt-in CDN hosts added to HTML CSP `script-src`, `style-src` and `font-src`. */
  allowScriptHosts?: readonly string[];
  /** Force `Content-Disposition: attachment` for Download actions. */
  download?: boolean;
}

/**
 * The HTTP response for an artifact's content, for the host that serves it (`genaicode ui`
 * does, at `/artifacts/<id>`). Serve it with this status and these headers unchanged: they are
 * what keeps agent-written HTML away from the page that shows it. Pass the request's `Range`
 * header so that audio and video can be seeked (some browsers play nothing without it).
 */
export function artifactResponse(
  artifact: Artifact,
  body: Buffer,
  request: ArtifactResponseRequest = {},
): ArtifactResponse {
  const fallback = FORMATS[artifact.kind === 'html' ? 'html' : 'text'];
  const filename =
    basename(artifact.path ?? '') || `${artifact.title.replace(/[^\w.-]+/g, '-') || 'artifact'}${fallback}`;
  const kind: ContentKind =
    artifact.mimeType === 'application/pdf' && !request.download ? 'pdf' : (artifact.kind as ContentKind);
  const headers = contentHeaders({
    kind,
    mimeType: artifact.mimeType,
    filename,
    size: body.length,
    allowScriptHosts: request.allowScriptHosts,
    download: request.download,
  });
  const parsed = parseByteRange(request.range, body.length);
  if (!parsed) return { status: 200, headers, body };
  if (parsed.status === 416) {
    return {
      status: 416,
      headers: { ...headers, 'content-range': `bytes */${body.length}`, 'content-length': '0' },
      body: Buffer.alloc(0),
    };
  }
  const { start, end } = parsed;
  return {
    status: 206,
    headers: {
      ...headers,
      'content-range': `bytes ${start}-${end}/${body.length}`,
      'content-length': String(end - start + 1),
    },
    body: body.subarray(start, end + 1),
  };
}

export interface ArtifactChannelOptions extends ArtifactStoreOptions {
  serve?: typeof startLocalMcpServer;
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
  // JSON escaping can double the content; the store enforces the real limit.
  const maxBody = (options.maxBytes ?? 5 * 1024 * 1024) * 2 + 64 * 1024;
  const server = await (options.serve ?? startLocalMcpServer)({ name, tools: [store.tool()], maxBody });
  return {
    store,
    mcpServer: server.mcpServer,
    close: async () => {
      store.clear();
      await server.close();
    },
  };
}

/** Evict old content across chat stores when their combined buffers reach the app's cap. */
export class ArtifactPool {
  private readonly stores = new Set<{ size(): number; evict(): boolean; idle(): boolean }>();
  constructor(private readonly limit = 200 * 1024 * 1024) {}
  register(store: { size(): number; evict(): boolean; idle(): boolean }) {
    this.stores.add(store);
    return () => this.stores.delete(store);
  }
  trim() {
    const stores = [...this.stores].sort((a, b) => Number(b.idle()) - Number(a.idle()));
    let total = stores.reduce((sum, store) => sum + store.size(), 0);
    for (const store of stores) {
      while (total > this.limit) {
        const before = store.size();
        if (!store.evict()) break;
        total -= before - store.size();
      }
      if (total <= this.limit) break;
    }
  }
}
