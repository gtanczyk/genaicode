import { memo, useState, type ReactNode } from 'react';

// A small, safe Markdown subset for agent replies: paragraphs, headings, lists, task lists,
// quotes, tables, fenced code, inline code, bold, italic, strikethrough, links and images.
// Everything is a React element or text node, so raw HTML shows as text.
// Links must be http(s) or mailto and open in a new tab. A link to a path on disk shows its label
// as a `gc-file-link` button carrying `data-gc-file` and optional line/column data attributes.
// Images `![alt](target)`: local paths render a thumbnail when the host resolves them via
// `imageUrl` (or fall back to a file link); remote http(s) URLs show a click-to-load chip unless
// `remoteImages="load"`; `data:` targets are left as plain text.

/** Place inside a file parsed from `:12`, `:12:3`, `#L12` or `#L12-L20`. All numbers are 1-based. */
export interface FilePosition {
  line: number;
  endLine?: number;
  column?: number;
}

export interface MarkdownProps {
  text: string;
  streaming?: boolean;
  className?: string;
  /** Resolve a local path in `![alt](path)` to an image URL (e.g. capability URL). */
  imageUrl?(path: string): string | undefined;
  /**
   * How `![alt](https://...)` images load: `'click'` (default, placeholder chip until clicked so
   * a reply cannot make the page call a URL on its own) or `'load'`.
   */
  remoteImages?: 'click' | 'load';
  /** Resolve relative file links (`./...`, `../...`) against this directory. */
  fileBase?: string;
  /** Only render file links as clickable buttons when they resolve inside one of these project roots. */
  fileRoot?: string | readonly string[];
}

// Every repetition is bounded, so text full of unclosed markers stays linear to scan.
// Images must precede links so `![alt](target)` is not split into `!` + link.
// Angle-delimited destinations can include spaces and parentheses. Use the same grammar for
// thumbnails discovered by the host and links rendered in the transcript.
function destination(prefix: RegExp): string {
  return String.raw`(?:<${prefix.source}[^<>\r\n]{1,2000}>|${prefix.source}[^)\s]{1,2000})`;
}
const localTarget = destination(
  /(?:[Ff][Ii][Ll][Ee]:\/\/(?:[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt])?\/|\/|\.{1,2}\/|[A-Za-z]:[\\/])/,
);
const FILE_URI_PREFIX = /^[Ff][Ii][Ll][Ee]:\/\/(?:[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt])?(?=\/)/;
const imageLabel = /!\[[^[\]\n]{0,500}\]\(/;
const linkLabel = /\[[^[\]\n]{1,500}\]\(/;
const LOCAL_IMAGE = new RegExp(String.raw`${imageLabel.source}(?<localImage>${localTarget})\)`, 'g');
const INLINE = new RegExp(
  [
    /(`[^`\n]{1,1000}`)|(\*\*[^*\n]{1,1000}\*\*)|(~~[^~\n]{1,1000}~~)|(\*[^*\s][^*\n]{0,1000}\*)/.source,
    String.raw`${imageLabel.source}(?<remoteImage>${destination(/https?:\/\//)})\)`,
    LOCAL_IMAGE.source,
    String.raw`${linkLabel.source}(?<url>${destination(/(?:https?:\/\/|mailto:)/)})\)`,
    String.raw`${linkLabel.source}(?<file>${localTarget})\)`,
    /https?:\/\/[^\s<>()]{0,2000}[^\s<>().,;:!?'"]/.source,
  ].join('|'),
  'g',
);

function unwrapDestination(target: string): string {
  return target.startsWith('<') ? target.slice(1, -1) : target;
}

/** Split a file link target (path or `file://` URI) into its path and optional `:12`, `:12:3`, `#L12` or `#L12-L20` position. */
export function parseFileTarget(target: string): { path: string; position?: FilePosition } {
  const isFileUri = FILE_URI_PREFIX.test(target);
  let normalized = isFileUri ? target.replace(FILE_URI_PREFIX, '') : target;
  if (isFileUri && /^\/[A-Za-z]:[\\/]/.test(normalized)) normalized = normalized.slice(1);
  const decodePath = (raw: string): string => {
    if (!isFileUri) return raw;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  const hash = normalized.lastIndexOf('#L');
  if (hash > 0) {
    const tail = normalized.slice(hash + 2);
    const range = /^(\d{1,7})(?:C(\d{1,5}))?(?:-L(\d{1,7})(?:C\d{1,5})?)?$/.exec(tail);
    if (range) {
      const line = Number(range[1]);
      const col = range[2] ? Number(range[2]) : undefined;
      const end = range[3] ? Number(range[3]) : undefined;
      const path = decodePath(normalized.slice(0, hash));
      if (line >= 1) {
        const position: FilePosition = {
          line,
          ...(end !== undefined && end > line ? { endLine: end } : {}),
          ...(col !== undefined && col >= 1 ? { column: col } : {}),
        };
        return { path, position };
      }
      return { path };
    }
  }
  const nums: number[] = [];
  let end = normalized.length;
  for (let part = 0; part < 2; part++) {
    let at = end;
    while (at > 0 && normalized[at - 1] >= '0' && normalized[at - 1] <= '9') at--;
    if (at === end || at < 2 || normalized[at - 1] !== ':') break;
    nums.unshift(Number(normalized.slice(at, end)));
    end = at - 1;
  }
  const path = decodePath(normalized.slice(0, end));
  if (nums.length >= 1 && nums[0]! >= 1 && nums[0]! <= 9_999_999) {
    const position: FilePosition = {
      line: nums[0]!,
      ...(nums[1] !== undefined && nums[1] >= 1 && nums[1] <= 99_999 ? { column: nums[1] } : {}),
    };
    return { path, position };
  }
  return { path };
}

/** Format a `FilePosition` as `12`, `12:3` or `12-20`. */
export function formatFilePosition(position: FilePosition): string {
  if (position.endLine && position.endLine > position.line) return `${position.line}-${position.endLine}`;
  if (position.column) return `${position.line}:${position.column}`;
  return String(position.line);
}

/** Read a `FilePosition` back from a clicked `[data-gc-file]` element. */
export function readFileLinkPosition(element: Element): FilePosition | undefined {
  const line = Number(element.getAttribute('data-gc-line'));
  if (!Number.isInteger(line) || line < 1) return undefined;
  const endLine = Number(element.getAttribute('data-gc-end-line'));
  const column = Number(element.getAttribute('data-gc-column'));
  return {
    line,
    ...(Number.isInteger(endLine) && endLine > line ? { endLine } : {}),
    ...(Number.isInteger(column) && column >= 1 ? { column } : {}),
  };
}

/** Extract unique local paths referenced by `![alt](path)` outside fenced code blocks. */
export function extractLocalImagePaths(text: string): string[] {
  const found: string[] = [];
  const lines = text.split('\n');
  let activeFence: { marker: string } | undefined;
  for (const line of lines) {
    if (activeFence) {
      const t = line.trim();
      if (t.length >= activeFence.marker.length && t === activeFence.marker[0].repeat(t.length)) {
        activeFence = undefined;
      }
      continue;
    }
    const open = fence(line);
    if (open) {
      activeFence = open;
      continue;
    }
    for (const match of line.matchAll(LOCAL_IMAGE)) {
      const { path } = parseFileTarget(unwrapDestination(match.groups!.localImage!));
      if (path && !found.includes(path)) found.push(path);
    }
  }
  return found;
}

function remoteLabel(src: string): string {
  try {
    const parsed = new URL(src);
    const rest = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    const full = `${parsed.host}${rest}`;
    return full.length > 48 ? `${full.slice(0, 47)}…` : full;
  } catch {
    return src.length > 48 ? `${src.slice(0, 47)}…` : src;
  }
}

function RemoteImage({ src, alt, autoLoad }: { src: string; alt: string; autoLoad: boolean }) {
  // Consent is bound to the exact URL so a later update to a different src requires a fresh click.
  const [approvedSrc, setApprovedSrc] = useState<string>();
  const loaded = autoLoad || approvedSrc === src;
  const label = remoteLabel(src);
  if (!loaded) {
    return (
      <span className="gc-md-image-chip" title={alt ? `${alt} — ${src}` : src}>
        <span className="gc-md-image-chip-label">Image: {label}</span>
        <button type="button" className="gc-md-image-load" onClick={() => setApprovedSrc(src)}>
          Load
        </button>
      </span>
    );
  }
  return (
    <a className="gc-md-image-link" href={src} target="_blank" rel="noopener noreferrer" title={alt || src}>
      <img className="gc-md-image" src={src} alt={alt || label} loading="lazy" referrerPolicy="no-referrer" />
    </a>
  );
}

function link(href: string, label: ReactNode, key: number) {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

interface InlineOptions {
  imageUrl?: (path: string) => string | undefined;
  remoteImages?: 'click' | 'load';
  fileBase?: string;
  fileRoot?: string | readonly string[];
}

/** Trim trailing `/` or `\` linearly (no regex backtracking). */
export function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === '/' || path[end - 1] === '\\')) end -= 1;
  return path.slice(0, end);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

/** Resolve a POSIX or Windows file path against `base` (handling `.` and `..`) without `node:path`. */
export function resolveFilePath(path: string, base: string): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const raw = isAbsolutePath(path) ? path : `${trimTrailingSlashes(base)}/${path}`;
  const drive = /^[A-Za-z]:/.exec(raw)?.[0] ?? '';
  const rest = drive ? raw.slice(2) : raw;
  const rooted = rest.startsWith('/') || rest.startsWith('\\');
  const parts: string[] = [];
  for (const segment of rest.split(/[\\/]/)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop();
      else if (!rooted) parts.push('..');
    } else {
      parts.push(segment);
    }
  }
  const joined = parts.join(sep);
  return drive ? `${drive}${rooted ? sep : ''}${joined}` : `${rooted ? sep : ''}${joined || (rooted ? '' : '.')}`;
}

/** Whether `target` equals `root` or lies inside it (browser-safe string check). */
export function isPathWithin(target: string, root: string): boolean {
  if (!root || !target) return false;
  const norm = (value: string) => {
    const clean = trimTrailingSlashes(value.replace(/\\/g, '/'));
    return clean || (value.startsWith('/') || value.startsWith('\\') ? '/' : '');
  };
  const a = norm(target);
  const b = norm(root);
  if (!a || !b) return false;
  if (a === b) return true;
  return b === '/' ? a.startsWith('/') : a.startsWith(`${b}/`);
}

function isWithinFileRoots(target: string, fileRoot: string | readonly string[] | undefined): boolean {
  if (fileRoot === undefined) return true;
  if (typeof fileRoot === 'string') return isPathWithin(target, fileRoot);
  return fileRoot.some((root) => isPathWithin(target, root));
}

function fileButton(
  target: string,
  label: ReactNode,
  key: number,
  options: InlineOptions,
  extra?: { className?: string; title?: string },
): ReactNode {
  const { path: rawPath, position } = parseFileTarget(target);
  const path = options.fileBase ? resolveFilePath(rawPath, options.fileBase) : rawPath;
  const title = extra?.title ?? (position ? `${path}:${formatFilePosition(position)}` : path);
  const openable = isWithinFileRoots(path, options.fileRoot);
  if (!openable) {
    return (
      <span key={key} className={extra?.className ?? 'gc-file-link'} title={title}>
        {label}
      </span>
    );
  }
  return (
    <button
      key={key}
      type="button"
      className={extra?.className ?? 'gc-file-link'}
      data-gc-file={path}
      data-gc-line={position ? String(position.line) : undefined}
      data-gc-end-line={position?.endLine ? String(position.endLine) : undefined}
      data-gc-column={position?.column ? String(position.column) : undefined}
      title={title}
    >
      {label}
    </button>
  );
}

/** `links` is false inside a link label, so no <a> or <button> ends up inside another. */
function inline(text: string, options: InlineOptions, links = true): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token] = match;
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (match[1]) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key++}>{inline(token.slice(2, -2), options, links)}</strong>);
    else if (match[3]) out.push(<del key={key++}>{inline(token.slice(2, -2), options, links)}</del>);
    else if (match[4]) out.push(<em key={key++}>{inline(token.slice(1, -1), options, links)}</em>);
    else if (match.groups?.remoteImage) {
      // Remote image: ![alt](https://...)
      const alt = token.slice(2, token.indexOf(']'));
      const src = unwrapDestination(match.groups.remoteImage);
      out.push(
        links ? (
          <RemoteImage key={`${key++}:${src}`} src={src} alt={alt} autoLoad={options.remoteImages === 'load'} />
        ) : (
          <span key={key++}>{alt || remoteLabel(src)}</span>
        ),
      );
    } else if (match.groups?.localImage) {
      // Local image: ![alt](/abs/or/./rel)
      const alt = token.slice(2, token.indexOf(']'));
      const target = unwrapDestination(match.groups.localImage);
      const { path: rawPath } = parseFileTarget(target);
      const path = options.fileBase ? resolveFilePath(rawPath, options.fileBase) : rawPath;
      const openable = isWithinFileRoots(path, options.fileRoot);
      const resolved = openable ? options.imageUrl?.(path) : undefined;
      if (resolved && links) {
        out.push(
          <button key={key++} type="button" className="gc-md-image-btn" data-gc-file={path} title={alt || path}>
            <img
              className="gc-md-image"
              src={resolved}
              alt={alt || path.split(/[\\/]/).pop() || path}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </button>,
        );
      } else if (links) {
        out.push(fileButton(target, alt || path, key++, options));
      } else {
        out.push(<span key={key++}>{alt || path}</span>);
      }
    } else if (match.groups?.url) {
      const label = inline(token.slice(1, token.indexOf(']')), options, false);
      out.push(links ? link(unwrapDestination(match.groups.url), label, key++) : <span key={key++}>{label}</span>);
    } else if (match.groups?.file) {
      // A link to a file on disk, as agents write them: the label, path, and optional line position.
      const label = inline(token.slice(1, token.indexOf(']')), options, false);
      out.push(
        links ? (
          fileButton(unwrapDestination(match.groups.file), label, key++, options)
        ) : (
          <span key={key++}>{label}</span>
        ),
      );
    } else {
      out.push(links ? link(token, token, key++) : token);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Block syntax is matched on trimmed lines, without regexes that backtrack over whitespace.
function fence(line: string): { marker: string; lang: string } | undefined {
  const t = line.trim();
  const char = t[0];
  if (char !== '`' && char !== '~') return undefined;
  let length = 0;
  while (t[length] === char) length += 1;
  if (length < 3) return undefined;
  const marker = char.repeat(length);
  const lang = t.slice(length).trim();
  return { marker, lang: /^[\w+-]{1,40}$/.test(lang) ? lang : '' };
}
function heading(line: string): { level: number; text: string } | undefined {
  const t = line.trimStart();
  let level = 0;
  while (level < 7 && t[level] === '#') level += 1;
  if (level === 0 || level > 6 || (t[level] !== ' ' && t[level] !== '\t')) return undefined;
  return { level, text: t.slice(level).trim() };
}
/** The item's text, or undefined when `line` is not a list item. */
function item(line: string): string | undefined {
  const t = line.trimStart();
  const marker = /^(?:[-*+]|\d{1,9}[.)])/.exec(t)?.[0];
  if (!marker || (t[marker.length] !== ' ' && t[marker.length] !== '\t')) return undefined;
  return t.slice(marker.length).trimStart();
}
const isQuote = (line: string) => line.trimStart().startsWith('>');
const unquote = (line: string) => {
  const t = line.trimStart().slice(1);
  return t.startsWith(' ') ? t.slice(1) : t;
};
type Align = 'left' | 'center' | 'right' | undefined;

/** The cells of a table row; `\|` is a literal pipe. */
function cells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const out: string[] = [''];
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] === '\\' && t[i + 1] === '|') out[out.length - 1] += t[++i];
    else if (t[i] === '|') out.push('');
    else out[out.length - 1] += t[i];
  }
  return out.map((cell) => cell.trim());
}
/** The column alignments when `line` is a table's delimiter row, such as `|---|:--:|`. */
function delimiter(line: string): Align[] | undefined {
  if (!line.includes('-')) return undefined;
  const aligns: Align[] = [];
  for (const cell of cells(line)) {
    if (!/^:?-+:?$/.test(cell)) return undefined;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : undefined);
  }
  return aligns;
}
/** A table starts at `i` when a row with a pipe is followed by a delimiter row of as many columns. */
function tableAt(lines: string[], i: number): Align[] | undefined {
  if (!lines[i].includes('|') || i + 1 >= lines.length) return undefined;
  const aligns = delimiter(lines[i + 1]);
  return aligns && aligns.length === cells(lines[i]).length ? aligns : undefined;
}
/** A task item's checkbox state and text, or undefined for a plain item. */
function task(text: string): { done: boolean; text: string } | undefined {
  const box = /^\[([ xX])\](?:[ \t]|$)/.exec(text);
  return box ? { done: box[1] !== ' ', text: text.slice(box[0].length) } : undefined;
}

const isRule = (line: string) => /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.replace(/[ \t]/g, ''));

/** Render `text` as Markdown. `streaming` adds a blinking caret after it. Re-renders only when a prop changes. */
export const Markdown = memo(function Markdown({
  text,
  streaming,
  className,
  imageUrl,
  remoteImages,
  fileBase,
  fileRoot,
}: MarkdownProps) {
  const options: InlineOptions = { imageUrl, remoteImages, fileBase, fileRoot };
  return (
    <div className={['gc-md', streaming ? 'gc-caret' : '', className ?? ''].filter(Boolean).join(' ')}>
      {blocks(text.trimEnd().split('\n'), options)}
    </div>
  );
});

// Deeper quotes render as plain text, so a reply full of '>' cannot exhaust the stack.
const MAX_QUOTE_DEPTH = 8;

function blocks(lines: string[], options: InlineOptions, depth = 0): ReactNode[] {
  const quote = (line: string) => depth < MAX_QUOTE_DEPTH && isQuote(line);
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const open = fence(line);
    if (open) {
      const body: string[] = [];
      i += 1;
      // Closed by the same character, at least as many times, and nothing else on the line.
      const closes = (text: string) => {
        const t = text.trim();
        return t.length >= open.marker.length && t === open.marker[0].repeat(t.length);
      };
      while (i < lines.length && !closes(lines[i])) body.push(lines[i++]);
      i += 1;
      out.push(
        <pre key={key++}>
          <code className={open.lang ? `language-${open.lang}` : undefined}>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (isRule(line)) {
      out.push(<hr key={key++} />);
      i += 1;
      continue;
    }
    const title = heading(line);
    if (title) {
      // h1 in a reply would outrank the host page's own headings.
      const Tag = `h${Math.min(6, title.level + 1)}` as 'h2';
      out.push(<Tag key={key++}>{inline(title.text, options)}</Tag>);
      i += 1;
      continue;
    }
    const aligns = tableAt(lines, i);
    if (aligns) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      // Short rows are padded and long rows cut, so every row has the header's columns.
      const row = (values: string[], Cell: 'th' | 'td') =>
        aligns.map((align, n) => (
          <Cell key={n} style={align ? { textAlign: align } : undefined}>
            {inline(values[n] ?? '', options)}
          </Cell>
        ));
      out.push(
        <div key={key++} className="gc-md-table">
          <table>
            <thead>
              <tr>{row(head, 'th')}</tr>
            </thead>
            {rows.length > 0 && (
              <tbody>
                {rows.map((values, n) => (
                  <tr key={n}>{row(values, 'td')}</tr>
                ))}
              </tbody>
            )}
          </table>
        </div>,
      );
      continue;
    }
    if (quote(line)) {
      const quoted: string[] = [];
      while (i < lines.length && quote(lines[i])) quoted.push(unquote(lines[i++]));
      out.push(<blockquote key={key++}>{blocks(quoted, options, depth + 1)}</blockquote>);
      continue;
    }
    if (item(line) !== undefined) {
      const start = parseInt(line, 10);
      const ordered = !Number.isNaN(start);
      const items: string[] = [];
      for (; i < lines.length; i += 1) {
        const next = item(lines[i]);
        // A list of the other kind starts a new list.
        if (next !== undefined && items.length && Number.isNaN(parseInt(lines[i], 10)) === ordered) break;
        if (next !== undefined) items.push(next);
        // An indented line continues the item above it.
        else if (lines[i].startsWith('  ') && lines[i].trim()) items[items.length - 1] += `\n${lines[i].trim()}`;
        else break;
      }
      const children = items.map((text, n) => {
        const box = task(text);
        return box ? (
          <li key={n} className="gc-md-task">
            <input type="checkbox" checked={box.done} disabled />
            {inline(box.text, options)}
          </li>
        ) : (
          <li key={n}>{inline(text, options)}</li>
        );
      });
      out.push(
        ordered ? (
          <ol key={key++} start={start !== 1 ? start : undefined}>
            {children}
          </ol>
        ) : (
          <ul key={key++}>{children}</ul>
        ),
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !fence(lines[i]) &&
      !heading(lines[i]) &&
      item(lines[i]) === undefined &&
      !quote(lines[i]) &&
      !tableAt(lines, i) &&
      (para.length === 0 || !isRule(lines[i]))
    ) {
      para.push(lines[i++]);
    }
    out.push(<p key={key++}>{inline(para.join('\n'), options)}</p>);
  }
  return out;
}
