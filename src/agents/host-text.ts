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
 * Briefings earlier genaicode versions put in front of the prompt: `pack()`'s default and
 * `delegationBrief()`, recognized by their first lines, then lines with no blank one between them,
 * then a blank line and the person's prompt.
 */
const LEGACY = [
  /^You lead a pack of coding agents on this machine\. Besides doing work yourself, you can hand parts of it to the\nothers through the `pack` MCP tools\. Agents available: [^\n]*\.\n- `agents` lists them with their limits\.[^\n]*(?:\n[^\n]*\S[^\n]*)*\n\s*\n/,
  /^Other coding agents on this machine \([^\n]*\) are available through the `pack` MCP tools\.\nWhen asked to involve another agent \(a second opinion, a review, a parallel piece of work\), use `delegate`\nand `wait`, never its CLI from a shell:[^\n]*(?:\n[^\n]*\S[^\n]*)*\n\s*\n/,
];

/** The person's prompt first, so an agent that names a session after its first words names it after the request. */
export function withBriefing(prompt: string, brief: string): string {
  if (!brief.trim()) return prompt;
  return `${prompt}${BLOCK_START}${brief.trim()}\n\n${CLOSE}`;
}

/** Whether the text opens with a briefing an earlier genaicode version put in front of the prompt. */
export function hasLeadingBriefing(text: string): boolean {
  const start = text.trimStart();
  return LEGACY.some((lead) => lead.test(start));
}

/**
 * What the person wrote: without the trailing block `withBriefing()` adds (also when the text was
 * cut short inside it), or a briefing older versions put in front.
 */
export function personText(text: string): string {
  let out = text.trimStart();
  for (const lead of LEGACY) out = out.replace(lead, '');
  const at = out.lastIndexOf(BLOCK_START);
  if (at >= 0) {
    const block = out.slice(at + BLOCK_START.length).trimEnd();
    const close = block.indexOf(CLOSE);
    if (close < 0 || close === block.length - CLOSE.length) out = out.slice(0, at);
  }
  return out.trim();
}
