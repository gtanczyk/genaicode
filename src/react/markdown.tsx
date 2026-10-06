import type { ReactNode } from 'react';

// A small, safe Markdown subset for agent replies: paragraphs, headings, lists, quotes, fenced
// code, inline code, bold, italic and links. Everything is a React text node, so HTML in the
// text shows as text. Links must be http(s) or mailto and open in a new tab.

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\(((?:https?:\/\/|mailto:)[^)\s]+)\))|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

function link(href: string, label: ReactNode, key: number) {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token] = match;
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (match[1]) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key++}>{inline(token.slice(2, -2))}</strong>);
    else if (match[3]) out.push(<em key={key++}>{inline(token.slice(1, -1))}</em>);
    else if (match[4]) out.push(link(match[5], inline(token.slice(1, token.indexOf(']'))), key++));
    else out.push(link(token, token, key++));
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^\s*([-*+]|\d+[.)])\s+/;
const QUOTE = /^\s*>\s?/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

/** Render `text` as Markdown. `streaming` adds a blinking caret after it. */
export function Markdown({ text, streaming, className }: { text: string; streaming?: boolean; className?: string }) {
  return (
    <div className={['gc-md', streaming ? 'gc-caret' : '', className ?? ''].filter(Boolean).join(' ')}>
      {blocks(text.replace(/\s+$/, '').split('\n'))}
    </div>
  );
}

function blocks(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
      i += 1;
      out.push(
        <pre key={key++}>
          <code className={fence[2] ? `language-${fence[2]}` : undefined}>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push(<hr key={key++} />);
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      // h1 in a reply would outrank the host page's own headings.
      const Tag = `h${Math.min(6, heading[1].length + 1)}` as 'h2';
      out.push(<Tag key={key++}>{inline(heading[2])}</Tag>);
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(lines[i++].replace(QUOTE, ''));
      out.push(<blockquote key={key++}>{blocks(quoted)}</blockquote>);
      continue;
    }
    if (ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const start = ordered ? parseInt(line, 10) : undefined;
      const items: string[] = [];
      while (i < lines.length && (ITEM.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i])))) {
        // An indented line continues the item above it.
        if (ITEM.test(lines[i])) items.push(lines[i].replace(ITEM, ''));
        else items[items.length - 1] += `\n${lines[i].trim()}`;
        i += 1;
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
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !ITEM.test(lines[i]) &&
      !QUOTE.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    out.push(<p key={key++}>{inline(para.join('\n'))}</p>);
  }
  return out;
}
