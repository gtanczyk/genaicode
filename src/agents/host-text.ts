/**
 * Text a host such as `pack()` adds to a person's prompt, kept apart from the person's own words so
 * titles and summaries come from what the person asked. A lead with `capabilities.instructions`
 * gets its briefing as system instructions instead; this covers the agents that do not.
 */

/** The tag around a briefing put into a prompt. */
export const BRIEFING_TAG = 'genaicode-briefing';

const TAGGED = new RegExp(`\\s*<${BRIEFING_TAG}>[\\s\\S]*?(?:</${BRIEFING_TAG}>|$)\\s*`, 'g');

/**
 * Briefings earlier genaicode versions put in front of the prompt (`pack()`'s and `delegationBrief()`'s
 * first lines): a block of lines with no blank line in it, then a blank line and the prompt.
 */
const LEGACY_LEADS = ['You lead a pack of coding agents on this machine.', 'Other coding agents on this machine ('];

/** The person's prompt first, so an agent that names a session after its first words names it after the request. */
export function withBriefing(prompt: string, brief: string): string {
  if (!brief.trim()) return prompt;
  return [
    prompt,
    `<${BRIEFING_TAG}>`,
    'Added by genaicode, not written by the person: how to use the tools this session has.',
    brief.trim(),
    `</${BRIEFING_TAG}>`,
  ].join('\n\n');
}

/** What the person wrote, without a briefing genaicode added (tagged, or in front as older versions put it). */
export function personText(text: string): string {
  let out = text;
  const start = out.trimStart();
  if (LEGACY_LEADS.some((lead) => start.startsWith(lead))) {
    const end = start.indexOf('\n\n');
    out = end < 0 ? '' : start.slice(end + 2);
  }
  return out.replace(TAGGED, '\n\n').trim();
}
