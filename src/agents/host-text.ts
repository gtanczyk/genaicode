/**
 * Text a host such as `pack()` adds to a person's prompt, kept apart from the person's own words so
 * titles and prompt previews come from what the person asked.
 */

/** The tag around a briefing put into a prompt. */
export const BRIEFING_TAG = 'genaicode-briefing';

const OPEN = `<${BRIEFING_TAG}>`;
const CLOSE = `</${BRIEFING_TAG}>`;
const PREAMBLE = 'Added by genaicode, not written by the person: how to use the tools this session has.';
/** How a generated block starts; a person mentioning the tag does not write this. */
const BLOCK_START = `\n\n${OPEN}\n\n${PREAMBLE}\n\n`;

/**
 * Find the start of a trailing generated `<genaicode-briefing>` block in linear time, matching
 * both the multi-line form and a one-line / cut-short title or preview (including cuts mid-preamble).
 */
function trailingBriefingIndex(text: string): number {
  for (let pos = text.lastIndexOf(OPEN); pos >= 0; pos = pos > 0 ? text.lastIndexOf(OPEN, pos - 1) : -1) {
    // Must be at start of string or preceded by whitespace.
    if (pos > 0 && !/\s/.test(text[pos - 1]!)) continue;
    let start = pos;
    while (start > 0 && /\s/.test(text[start - 1]!)) start -= 1;
    const afterTag = text.slice(pos + OPEN.length);
    // A title cut right after the opening tag by `oneLine()` ends with Unicode `…`.
    if (afterTag === '…') return start;
    if (!afterTag || !/^\s/.test(afterTag)) continue;
    const after = afterTag.trimStart();
    if (!after) continue;
    const isFull = after.startsWith(PREAMBLE);
    const hasEllipsis = after.endsWith('…');
    const trimmedCut = hasEllipsis ? after.slice(0, -1) : after;
    // In explicitly truncated titles (`…`), even a short preamble prefix (e.g. `<genaicode-briefing> Ad…`)
    // identifies the generated block; without `…`, require >= 5 preamble chars so ordinary tag mentions stay intact.
    const isTruncatedPreamble = !isFull && (hasEllipsis || trimmedCut.length >= 5) && PREAMBLE.startsWith(trimmedCut);
    if (!isFull && !isTruncatedPreamble) continue;
    const close = after.indexOf(CLOSE);
    if (close < 0 || close === after.trimEnd().length - CLOSE.length) return start;
  }
  return -1;
}

/**
 * Briefings earlier genaicode versions put in front of the prompt: `pack()`'s default and
 * `delegationBrief()`, recognized by their first lines, then lines with no blank one between them,
 * then a blank line and the person's prompt. Each line matches one way only, so a briefing cut off
 * before its blank line cannot make the match backtrack for ever.
 */
const LEGACY = [
  /^You lead a pack of coding agents on this machine\. Besides doing work yourself, you can hand parts of it to the\nothers through the `pack` MCP tools\. Agents available: [^\n]*\.\n- `agents` lists them with their limits\.[^\n]*(?:\n[^\S\n]*\S[^\n]*)*\n\s*\n/,
  /^Other coding agents on this machine \([^\n]*\) are available through the `pack` MCP tools\.\nWhen asked to involve another agent \(a second opinion, a review, a parallel piece of work\), use `delegate`\nand `wait`, never its CLI from a shell:[^\n]*(?:\n[^\S\n]*\S[^\n]*)*\n\s*\n/,
];

/**
 * How the recap `handoffPreamble()` puts before the person's first message to an agent taking over a
 * conversation starts and ends ("Continue here", `run --from`).
 */
export const HANDOFF_OPEN = 'You are taking over a conversation that the user had with another coding agent (';
export const HANDOFF_CLOSE = "The user's new message follows.";
// Its end, also when the text was put on one line (a title, a preview); the recap can quote an
// earlier takeover, so the last one counts.
const HANDOFF_END = /(?:^|\s)The user's new message follows\.\s+---(?:\s+|$)/g;

/**
 * Without a takeover recap in front: the words after it, or nothing when the text was cut short
 * inside the recap.
 */
function withoutHandoff(text: string): string {
  if (!text.startsWith(HANDOFF_OPEN)) return text;
  let end = -1;
  for (const match of text.matchAll(HANDOFF_END)) end = match.index + match[0].length;
  return end < 0 ? '' : text.slice(end).trimStart();
}

/** The person's prompt first, so an agent that names a session after its first words names it after the request. */
export function withBriefing(prompt: string, brief: string): string {
  const note = brief.trim();
  if (!note) return prompt;
  // Merge into an existing trailing briefing block so there is at most one `<genaicode-briefing>` block.
  const at = prompt.lastIndexOf(BLOCK_START);
  if (at >= 0) {
    const tail = prompt.slice(at + BLOCK_START.length);
    if (tail.endsWith(CLOSE)) {
      const existing = tail.slice(0, -CLOSE.length).trimEnd();
      return `${prompt.slice(0, at)}${BLOCK_START}${existing}\n\n${note}\n\n${CLOSE}`;
    }
  }
  return `${prompt}${BLOCK_START}${note}\n\n${CLOSE}`;
}

/**
 * Whether the text opens with a briefing an earlier genaicode version put in front of the prompt, or
 * with the recap an agent taking over a conversation gets.
 */
export function hasLeadingBriefing(text: string): boolean {
  const start = text.trimStart();
  if (start.startsWith(HANDOFF_OPEN)) return true;
  return LEGACY.some((lead) => lead.test(start));
}

/**
 * What the person wrote: without the trailing block `withBriefing()` adds (also when the text was
 * cut short inside it), a briefing older versions put in front, or the recap an agent taking over a
 * conversation gets in front of the person's message (empty when cut short inside that recap).
 */
export function personText(text: string): string {
  let out = withoutHandoff(text.trimStart());
  for (const lead of LEGACY) out = out.replace(lead, '');
  const at = trailingBriefingIndex(out);
  if (at >= 0) out = out.slice(0, at);
  return out.trim();
}
