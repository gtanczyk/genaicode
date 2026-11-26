import { realpathSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Artifact } from './types.js';
export { DEFAULT_ARTIFACT_CDN_HOSTS } from './cdn.js';

/** Content kind shared by artifacts and the file viewer. */
export type ContentKind = 'html' | 'markdown' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'file';

export interface MediaType {
  kind: ContentKind;
  artifactKind: Artifact['kind'];
  mimeType: string;
}

/** One root directory, a list of roots, or a function evaluated on every lookup. */
export type RootsInput = string | readonly string[] | (() => string | readonly string[]);

const TEXT = 'text/plain; charset=utf-8';

/** Extension → kind and MIME type. Unknown extensions download as files (or sniff for text in the file panel). */
export const MEDIA_TYPES: Readonly<Record<string, MediaType>> = {
  '.html': { kind: 'html', artifactKind: 'html', mimeType: 'text/html; charset=utf-8' },
  '.htm': { kind: 'html', artifactKind: 'html', mimeType: 'text/html; charset=utf-8' },
  '.png': { kind: 'image', artifactKind: 'image', mimeType: 'image/png' },
  '.jpg': { kind: 'image', artifactKind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', artifactKind: 'image', mimeType: 'image/jpeg' },
  '.gif': { kind: 'image', artifactKind: 'image', mimeType: 'image/gif' },
  '.webp': { kind: 'image', artifactKind: 'image', mimeType: 'image/webp' },
  '.avif': { kind: 'image', artifactKind: 'image', mimeType: 'image/avif' },
  '.svg': { kind: 'image', artifactKind: 'image', mimeType: 'image/svg+xml' },
  '.mp3': { kind: 'audio', artifactKind: 'audio', mimeType: 'audio/mpeg' },
  '.wav': { kind: 'audio', artifactKind: 'audio', mimeType: 'audio/wav' },
  '.ogg': { kind: 'audio', artifactKind: 'audio', mimeType: 'audio/ogg' },
  '.oga': { kind: 'audio', artifactKind: 'audio', mimeType: 'audio/ogg' },
  '.opus': { kind: 'audio', artifactKind: 'audio', mimeType: 'audio/ogg' },
  '.m4a': { kind: 'audio', artifactKind: 'audio', mimeType: 'audio/mp4' },
  '.aac': { kind: 'audio', artifactKind: 'audio', mimeType: 'audio/aac' },
  '.flac': { kind: 'audio', artifactKind: 'audio', mimeType: 'audio/flac' },
  '.mp4': { kind: 'video', artifactKind: 'video', mimeType: 'video/mp4' },
  '.m4v': { kind: 'video', artifactKind: 'video', mimeType: 'video/mp4' },
  '.webm': { kind: 'video', artifactKind: 'video', mimeType: 'video/webm' },
  '.mov': { kind: 'video', artifactKind: 'video', mimeType: 'video/quicktime' },
  '.ogv': { kind: 'video', artifactKind: 'video', mimeType: 'video/ogg' },
  '.pdf': { kind: 'pdf', artifactKind: 'file', mimeType: 'application/pdf' },
  '.md': { kind: 'markdown', artifactKind: 'text', mimeType: 'text/markdown; charset=utf-8' },
  '.markdown': { kind: 'markdown', artifactKind: 'text', mimeType: 'text/markdown; charset=utf-8' },
  ...Object.fromEntries(
    ['.txt', '.log', '.json', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.diff', '.patch'].map((ext) => [
      ext,
      { kind: 'text' as const, artifactKind: 'text' as const, mimeType: TEXT },
    ]),
  ),
};

export function mediaTypeFor(extension: string): MediaType | undefined {
  return MEDIA_TYPES[extension.toLowerCase()];
}

// Folders and files that hold credentials or internal state. An agent with a shell can read them
// anyway; this keeps a confused or prompt-injected agent from surfacing them through artifacts or
// the file panel.
export const SECRET_DIRS = new Set(['.git', '.genaicode', '.ssh', '.aws', '.gnupg', '.kube', '.docker']);
export const SECRET_FILE =
  /^(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519).*|.*\.(pem|key|p12|pfx|keystore))$/i;

export function isSecretPath(relativeParts: readonly string[]): boolean {
  if (!relativeParts.length) return false;
  if (relativeParts.some((part) => SECRET_DIRS.has(part.toLowerCase()))) return true;
  return SECRET_FILE.test(relativeParts.at(-1)!);
}

export type RootResolveResult =
  | { ok: true; real: string; root: string; relative: string; parts: string[] }
  | { ok: false; reason: 'missing' | 'outside' | 'secret'; relative?: string };

function readRoots(input: RootsInput): string[] {
  const value = typeof input === 'function' ? input() : input;
  const list = typeof value === 'string' ? [value] : value;
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string' && item && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Find the most specific root containing `real`. Choosing the deepest root ensures a pack
 * worktree under `<repo>/.genaicode/worktrees/<id>` resolves relative to the worktree itself
 * rather than looking like a file inside `<repo>/.genaicode`.
 */
function matchRoot(
  real: string,
  roots: readonly string[],
): { root: string; relative: string; parts: string[] } | undefined {
  let best: { root: string; relative: string; parts: string[] } | undefined;
  for (const root of roots) {
    const inside = relative(root, real);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) continue;
    if (!best || root.length > best.root.length) {
      best = { root, relative: inside, parts: inside.split(sep) };
    }
  }
  return best;
}

/** Reject Windows UNC/network (`\\host`, `//host`, `/\host`, `\/host`) and device (`\\?\`, `\\.\`) paths before hitting the OS. */
function isUnsafeFsPath(targetPath: string): boolean {
  return !targetPath || targetPath.includes('\0') || /^[\\/]{2}/.test(targetPath);
}

/** Resolve `targetPath` against one or more allowed roots synchronously (following symlinks). */
export function resolveInRootsSync(targetPath: string, rootsInput: RootsInput): RootResolveResult {
  if (isUnsafeFsPath(targetPath)) return { ok: false, reason: 'missing' };
  const resolvedRoots: string[] = [];
  for (const dir of readRoots(rootsInput)) {
    try {
      const realRoot = realpathSync(dir);
      if (!resolvedRoots.includes(realRoot)) resolvedRoots.push(realRoot);
    } catch {
      // Missing or removed root: skip it.
    }
  }
  if (!resolvedRoots.length) return { ok: false, reason: 'missing' };

  if (isAbsolute(targetPath)) {
    let real: string;
    try {
      real = realpathSync(targetPath);
    } catch {
      return { ok: false, reason: 'missing' };
    }
    const matched = matchRoot(real, resolvedRoots);
    if (!matched) return { ok: false, reason: 'outside' };
    if (isSecretPath(matched.parts)) return { ok: false, reason: 'secret', relative: matched.parts.join('/') };
    return { ok: true, real, root: matched.root, relative: matched.parts.join('/'), parts: matched.parts };
  }

  let sawOutside = false;
  let sawSecret: string | undefined;
  for (const root of resolvedRoots) {
    let real: string;
    try {
      real = realpathSync(resolve(root, targetPath));
    } catch {
      continue;
    }
    const matched = matchRoot(real, resolvedRoots);
    if (!matched) {
      sawOutside = true;
      continue;
    }
    if (isSecretPath(matched.parts)) {
      sawSecret ??= matched.parts.join('/');
      continue;
    }
    return { ok: true, real, root: matched.root, relative: matched.parts.join('/'), parts: matched.parts };
  }
  if (sawSecret) return { ok: false, reason: 'secret', relative: sawSecret };
  if (sawOutside) return { ok: false, reason: 'outside' };
  return { ok: false, reason: 'missing' };
}

/** Resolve `targetPath` against one or more allowed roots asynchronously (following symlinks). */
export async function resolveInRoots(targetPath: string, rootsInput: RootsInput): Promise<RootResolveResult> {
  if (isUnsafeFsPath(targetPath)) return { ok: false, reason: 'missing' };
  const resolvedRoots: string[] = [];
  for (const dir of readRoots(rootsInput)) {
    try {
      const realRoot = await fs.realpath(dir);
      if (!resolvedRoots.includes(realRoot)) resolvedRoots.push(realRoot);
    } catch {
      // Missing or removed root: skip it.
    }
  }
  if (!resolvedRoots.length) return { ok: false, reason: 'missing' };

  if (isAbsolute(targetPath)) {
    let real: string;
    try {
      real = await fs.realpath(targetPath);
    } catch {
      return { ok: false, reason: 'missing' };
    }
    const matched = matchRoot(real, resolvedRoots);
    if (!matched) return { ok: false, reason: 'outside' };
    if (isSecretPath(matched.parts)) return { ok: false, reason: 'secret', relative: matched.parts.join('/') };
    return { ok: true, real, root: matched.root, relative: matched.parts.join('/'), parts: matched.parts };
  }

  let sawOutside = false;
  let sawSecret: string | undefined;
  for (const root of resolvedRoots) {
    let real: string;
    try {
      real = await fs.realpath(resolve(root, targetPath));
    } catch {
      continue;
    }
    const matched = matchRoot(real, resolvedRoots);
    if (!matched) {
      sawOutside = true;
      continue;
    }
    if (isSecretPath(matched.parts)) {
      sawSecret ??= matched.parts.join('/');
      continue;
    }
    return { ok: true, real, root: matched.root, relative: matched.parts.join('/'), parts: matched.parts };
  }
  if (sawSecret) return { ok: false, reason: 'secret', relative: sawSecret };
  if (sawOutside) return { ok: false, reason: 'outside' };
  return { ok: false, reason: 'missing' };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validate and normalize one host for `allowScriptHosts` into an origin (`https://cdn.jsdelivr.net`).
 * Bare hosts become `https://<host>`; `http://` is permitted only for loopback addresses (local tests).
 * Rejects wildcards, paths, queries, whitespace and CSP control characters.
 */
export function normalizeScriptHost(raw: string): string | undefined {
  const trimmed = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!trimmed || trimmed.length > 253 || /[\s;,'"*\\\x00-\x1f\x7f]/.test(trimmed)) return undefined;
  const hasScheme = trimmed.includes('://');
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
  if (!url.hostname || url.hostname.includes('*')) return undefined;
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  if (!url.hostname.includes('.') && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  return url.origin.toLowerCase();
}

/** Validate and deduplicate a list of script hosts. Throws `Error` on an invalid entry. */
export function normalizeScriptHosts(hosts: readonly string[] | undefined): string[] {
  if (!hosts?.length) return [];
  const out: string[] = [];
  for (const host of hosts) {
    const normalized = normalizeScriptHost(host);
    if (!normalized) {
      throw new Error(`Invalid script host "${host}". Give a hostname such as cdn.jsdelivr.net or unpkg.com.`);
    }
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

// Everything non-HTML/non-media/non-PDF is inert: an SVG opened directly must not run its scripts.
const INERT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
// A picture, sound or film opened in a tab of its own: the browser's viewer loads this same URL.
const MEDIA_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
// A PDF viewer uses the browser's built-in PDF plugin; Chromium blocks that plugin under `sandbox`,
// while `nosniff` + `application/pdf` keeps it out of HTML/JS parsing.
const PDF_CSP = "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/**
 * Content-Security-Policy for agent-reachable content served at `/artifacts/<id>` or `/files/<id>`.
 * HTML gets `sandbox allow-scripts` with no network by default; when `allowScriptHosts` is set,
 * those hosts are added to `script-src`, `style-src` and `font-src` only (`connect-src`, `img-src`,
 * `media-src` and `form-action` stay closed).
 */
export function contentSecurityPolicy(kind: ContentKind, allowScriptHosts?: readonly string[]): string {
  if (kind === 'html') {
    const hosts = normalizeScriptHosts(allowScriptHosts);
    const extra = hosts.length ? ` ${hosts.join(' ')}` : '';
    return [
      "default-src 'none'",
      `script-src 'unsafe-inline'${extra}`,
      `style-src 'unsafe-inline'${extra}`,
      'img-src data: blob:',
      'media-src data: blob:',
      `font-src data:${extra}`,
      "form-action 'none'",
      "base-uri 'none'",
      "webrtc 'block'",
      'sandbox allow-scripts',
    ].join('; ');
  }
  if (kind === 'image' || kind === 'audio' || kind === 'video') return MEDIA_CSP;
  if (kind === 'pdf') return PDF_CSP;
  return INERT_CSP;
}

export interface ContentHeaderOptions {
  kind: ContentKind;
  mimeType: string;
  filename: string;
  size: number;
  allowScriptHosts?: readonly string[];
  download?: boolean;
}

/** Shared HTTP headers for artifacts and raw project files. */
export function contentHeaders(options: ContentHeaderOptions): Record<string, string> {
  const safeName = options.filename.replace(/[^\w.-]/g, '_') || 'file';
  const disposition = options.download || options.kind === 'file' ? 'attachment' : 'inline';
  return {
    'content-type': options.mimeType,
    'content-length': String(options.size),
    'content-security-policy': contentSecurityPolicy(options.kind, options.allowScriptHosts),
    'content-disposition': `${disposition}; filename="${safeName}"`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
  };
}

export type ByteRangeResult = { status: 206; start: number; end: number } | { status: 416 } | undefined;

/** Parse a single HTTP `Range: bytes=...` header against a body of `size` bytes. */
export function parseByteRange(rangeHeader: string | undefined, size: number): ByteRangeResult {
  // One range only; anything else gets the whole content, which HTTP allows.
  const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader?.trim() ?? '');
  if (!range || (!range[1] && !range[2])) return undefined;
  // `-N` is the last N bytes.
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) return { status: 416 };
  return { status: 206, start, end };
}
