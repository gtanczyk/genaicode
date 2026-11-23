import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, sep } from 'node:path';
import { isSecretPath, mediaTypeFor, resolveInRootsSync, type ContentKind, type RootsInput } from '../agents/media.js';

/** How the file panel renders a project file. */
export type FileKind = 'text' | 'markdown' | 'image' | 'audio' | 'video' | 'pdf' | 'html' | 'other';

/** A project file as the page shows it. */
export interface FileView {
  /** Relative to the matching allowed root. */
  path: string;
  /** How the viewer panel renders it. */
  kind: FileKind;
  /** MIME type from the extension table, `text/plain; charset=utf-8` for text, or `application/octet-stream`. */
  mimeType: string;
  /** Size on disk, in bytes. */
  size: number;
  /** The start of the file, as text (present for text, markdown and html). */
  text?: string;
  /** True when the file is longer than what `text` holds. */
  truncated?: boolean;
  /** Short-lived capability URL (`/files/<id>`) for raw streaming, attached by the HTTP server. */
  rawUrl?: string;
}

/** Metadata for streaming a verified file from disk (`GET /api/file/raw` and `/files/<id>`). */
export interface FileRaw {
  path: string;
  realPath: string;
  filename: string;
  kind: FileKind;
  contentKind: ContentKind;
  mimeType: string;
  size: number;
}

/** Why a file is not shown. */
export type FileRefusal = 'outside' | 'missing' | 'secret';

export interface ProjectFilesOptions {
  /** How long a `/files/<id>` capability stays valid in milliseconds. Default 15 minutes. */
  capabilityTtlMs?: number;
  /** Maximum active capability entries kept; oldest are dropped beyond this. Default 256. */
  maxCapabilities?: number;
  now?: () => number;
}

/** Reads project files for `genaicode ui` to show, and mints short-lived capability ids for media. */
export interface ProjectFiles {
  read(path: string): FileView | FileRefusal;
  /** Resolve a file for raw HTTP streaming (`Range`, media, PDF, HTML, Download). */
  raw(path: string): FileRaw | FileRefusal;
  /**
   * Mint a short-lived, single-path capability id (`/files/<id>`).
   * Pass `onlyKind` (e.g. `'image'`) to mint only when the file is of that kind.
   */
  capability(path: string, options?: { onlyKind?: FileKind }): { id: string; raw: FileRaw } | undefined;
  /** Look up an active capability id and re-verify the file is still allowed. */
  fromCapability(id: string): FileRaw | undefined;
  /**
   * Resolve a path for Reveal in Finder / file manager.
   * Relative paths must resolve inside allowed roots; absolute paths must exist on disk
   * and not point at credential files (so an `outside` notice in the desktop app can offer Reveal).
   */
  revealPath(path: string): { ok: true; realPath: string } | { ok: false; reason: FileRefusal };
}

export const MAX_FILE_VIEW_BYTES = 512 * 1024;
const SNIFF_BYTES = 8 * 1024;
const DEFAULT_CAPABILITY_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_CAPABILITIES = 256;
const TEXT_MIME = 'text/plain; charset=utf-8';
const OCTET_MIME = 'application/octet-stream';

function openRegularFile(real: string): { fd: number; size: number } | undefined {
  let fd: number;
  try {
    // A pipe would hold the open (and the whole server) until someone writes to it.
    if (!statSync(real).isFile()) return undefined;
    fd = openSync(real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch {
    return undefined;
  }
  try {
    // Asked of what was opened: the path can be something else by now.
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      closeSync(fd);
      return undefined;
    }
    return { fd, size: stat.size };
  } catch {
    closeSync(fd);
    return undefined;
  }
}

function readSample(fd: number, size: number, limit: number): Buffer {
  const body = Buffer.alloc(Math.min(size, limit));
  const read = readSync(fd, body, 0, body.length, 0);
  return body.subarray(0, read);
}

/**
 * Files under `roots` only: a path that leaves every root, a symlink pointing out, or a secret
 * file/directory name (`.env`, `.git`, `.ssh`, `*.pem`...) is refused, so the page shows what
 * the agent works on and nothing else on the machine. Pass a function when roots or the working
 * directory change per conversation (`ui --home`, `--sessions`).
 */
export function createProjectFiles(roots: RootsInput, options: ProjectFilesOptions = {}): ProjectFiles {
  const ttlMs = Math.max(1, options.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS);
  const maxCapabilities = Math.max(1, options.maxCapabilities ?? DEFAULT_MAX_CAPABILITIES);
  const now = options.now ?? Date.now;
  // Insertion order is recency; id → { realPath, expiresAt }.
  const capabilities = new Map<string, { realPath: string; expiresAt: number }>();
  const byRealPath = new Map<string, string>();

  const dropCapability = (id: string) => {
    const entry = capabilities.get(id);
    if (!entry) return;
    capabilities.delete(id);
    if (byRealPath.get(entry.realPath) === id) byRealPath.delete(entry.realPath);
  };

  const prune = (at: number) => {
    for (const [id, entry] of capabilities) {
      if (entry.expiresAt <= at) dropCapability(id);
    }
    while (capabilities.size > maxCapabilities) {
      dropCapability(capabilities.keys().next().value!);
    }
  };

  const inspect = (path: string, includeText: boolean): { view: FileView; raw: FileRaw } | FileRefusal => {
    const resolved = resolveInRootsSync(path, roots);
    if (!resolved.ok) return resolved.reason;
    const opened = openRegularFile(resolved.real);
    if (!opened) return 'missing';
    const { fd, size } = opened;
    try {
      const ext = extname(resolved.real).toLowerCase();
      const media = mediaTypeFor(ext);
      const filename = basename(resolved.real);

      if (
        media &&
        (media.kind === 'image' || media.kind === 'audio' || media.kind === 'video' || media.kind === 'pdf')
      ) {
        const view: FileView = { path: resolved.relative, kind: media.kind, mimeType: media.mimeType, size };
        const raw: FileRaw = {
          path: resolved.relative,
          realPath: resolved.real,
          filename,
          kind: media.kind,
          contentKind: media.kind,
          mimeType: media.mimeType,
          size,
        };
        return { view, raw };
      }

      const sample = readSample(fd, size, includeText ? MAX_FILE_VIEW_BYTES : SNIFF_BYTES);
      if (sample.includes(0)) {
        const view: FileView = { path: resolved.relative, kind: 'other', mimeType: OCTET_MIME, size };
        const raw: FileRaw = {
          path: resolved.relative,
          realPath: resolved.real,
          filename,
          kind: 'other',
          contentKind: 'file',
          mimeType: OCTET_MIME,
          size,
        };
        return { view, raw };
      }

      const kind: FileKind = media?.kind === 'html' ? 'html' : media?.kind === 'markdown' ? 'markdown' : 'text';
      const contentKind: ContentKind = kind;
      const mimeType = media?.mimeType ?? TEXT_MIME;
      const view: FileView = {
        path: resolved.relative,
        kind,
        mimeType,
        size,
        ...(includeText ? { text: sample.toString('utf8'), truncated: size > sample.length } : {}),
      };
      const raw: FileRaw = {
        path: resolved.relative,
        realPath: resolved.real,
        filename,
        kind,
        contentKind,
        mimeType,
        size,
      };
      return { view, raw };
    } catch {
      return 'missing';
    } finally {
      closeSync(fd);
    }
  };

  return {
    read(path) {
      const found = inspect(path, true);
      return typeof found === 'string' ? found : found.view;
    },
    raw(path) {
      const found = inspect(path, false);
      return typeof found === 'string' ? found : found.raw;
    },
    capability(path, opts) {
      const found = inspect(path, false);
      if (typeof found === 'string') return undefined;
      if (opts?.onlyKind && found.raw.kind !== opts.onlyKind) return undefined;
      const at = now();
      prune(at);
      const existing = byRealPath.get(found.raw.realPath);
      if (existing && capabilities.has(existing)) {
        capabilities.delete(existing);
        capabilities.set(existing, { realPath: found.raw.realPath, expiresAt: at + ttlMs });
        return { id: existing, raw: found.raw };
      }
      const id = randomBytes(16).toString('hex');
      capabilities.set(id, { realPath: found.raw.realPath, expiresAt: at + ttlMs });
      byRealPath.set(found.raw.realPath, id);
      prune(at);
      return { id, raw: found.raw };
    },
    fromCapability(id) {
      if (!/^[0-9a-f]{32}$/.test(id)) return undefined;
      const at = now();
      const entry = capabilities.get(id);
      if (!entry) return undefined;
      if (entry.expiresAt <= at) {
        dropCapability(id);
        return undefined;
      }
      const found = inspect(entry.realPath, false);
      if (typeof found === 'string') {
        dropCapability(id);
        return undefined;
      }
      // Refresh sliding expiration while the panel uses this capability.
      capabilities.delete(id);
      capabilities.set(id, { realPath: entry.realPath, expiresAt: at + ttlMs });
      return found.raw;
    },
    revealPath(path) {
      // eslint-disable-next-line no-control-regex
      if (!path || /[\x00-\x1f\x7f]/.test(path)) return { ok: false, reason: 'missing' };
      const resolved = resolveInRootsSync(path, roots);
      if (resolved.ok) return { ok: true, realPath: resolved.real };
      if (resolved.reason === 'secret') return { ok: false, reason: 'secret' };
      if (!isAbsolute(path)) return { ok: false, reason: resolved.reason };
      // Outside the project roots: allow Reveal only for an existing non-secret absolute path.
      let real: string;
      try {
        real = realpathSync(path);
        statSync(real);
      } catch {
        return { ok: false, reason: 'missing' };
      }
      const parts = real.split(sep).filter(Boolean);
      if (isSecretPath(parts)) return { ok: false, reason: 'secret' };
      return { ok: true, realPath: real };
    },
  };
}
