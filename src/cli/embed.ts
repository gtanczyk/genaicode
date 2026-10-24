import { readFileSync } from 'node:fs';

/**
 * `genaicode embed` hands the work to the agent: it sends the shipped instructions and
 * whatever the user asked for, and the agent reads the project and decides how to wire it in.
 */

/** What the user's chat shows for the request; the agent gets `embedPrompt` instead. */
export function embedRequest(request: string | undefined): string {
  return request ? `Embed genaicode in this project: ${request}` : 'Embed genaicode in this project.';
}

/** The skill's instructions, then the directory, the version to install and the user's request. */
export function embedPrompt(
  instructions: string,
  { cwd, version, request }: { cwd: string; version: string; request?: string },
): string {
  return [
    stripFrontmatter(instructions).trim(),
    '## Your task',
    [
      `Embed genaicode in the project in ${cwd}.`,
      `The current genaicode release is ${version}: depend on \`^${version}\`.`,
      request ? `The user asked: ${request}` : 'The user did not say which integration; choose as described above.',
      'Do the steps now. If a choice is genuinely unclear, ask the user one short question and stop there.',
    ].join('\n'),
  ].join('\n\n');
}

/** The skill file without its YAML header. */
export function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

/** The instructions as shipped: `docs/skills/genaicode-embed/SKILL.md` in the package. */
export function readEmbedInstructions(): string {
  return readFileSync(new URL('../../docs/skills/genaicode-embed/SKILL.md', import.meta.url), 'utf8');
}
