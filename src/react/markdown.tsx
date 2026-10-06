import type { ReactNode } from 'react';

// A small, safe Markdown subset for agent replies: paragraphs, headings, lists, quotes, fenced
// code, inline code, bold, italic and links. Everything is a React text node, so HTML in the
// text shows as text. Links must be http(s) or mailto and open in a new tab.

// Every repetition is bounded, so text full of unclosed markers stays linear to scan.
const INLINE =
  /(`[^`\n]{1,1000}`)|(\*\*[^*\n]{1,1000}\*\*)|(\*[^*\s][^*\n]{0,1000}\*)|(\[[^[\]\n]{1,500}\]\(((?:https?:\/\/|mailto:)[^)\s]{1,2000})\))|(https?:\/\/[^\s<>()]{0,2000}[^\s<>().,;:!?'"])/g;

function link(href: string, label: ReactNode, key: number) {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/** `links` is false inside a link label, so no <a> ends up inside another. */
function inline(text: string, links = true): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token] = match;
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (match[1]) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key++}>{inline(token.slice(2, -2), links)}</strong>);
    else if (match[3]) out.push(<em key={key++}>{inline(token.slice(1, -1), links)}</em>);
    else if (match[4]) {
      const label = inline(token.slice(1, token.indexOf(']')), false);
      out.push(links ? link(match[5], label, key++) : <span key={key++}>{label}</span>);
    } else out.push(links ? link(token, token, key++) : token);
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
const isRule = (line: string) => /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.replace(/[ \t]/g, ''));

/** Render `text` as Markdown. `streaming` adds a blinking caret after it. */
export function Markdown({ text, streaming, className }: { text: string; streaming?: boolean; className?: string }) {
  return (
    <div className={['gc-md', streaming ? 'gc-caret' : '', className ?? ''].filter(Boolean).join(' ')}>
      {blocks(text.trimEnd().split('\n'))}
    </div>
  );
}

// Deeper quotes render as plain text, so a reply full of '>' cannot exhaust the stack.
const MAX_QUOTE_DEPTH = 8;

function blocks(lines: string[], depth = 0): ReactNode[] {
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
      out.push(<Tag key={key++}>{inline(title.text)}</Tag>);
      i += 1;
      continue;
    }
    if (quote(line)) {
      const quoted: string[] = [];
      while (i < lines.length && quote(lines[i])) quoted.push(unquote(lines[i++]));
      out.push(<blockquote key={key++}>{blocks(quoted, depth + 1)}</blockquote>);
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
      const children = items.map((item, n) => <li key={n}>{inline(item)}</li>);
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
      !quote(lines[i])
    ) {
      para.push(lines[i++]);
    }
    out.push(<p key={key++}>{inline(para.join('\n'))}</p>);
  }
  return out;
}
