import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { SessionTurn } from './session.js';

/** Where `createAgentSession` writes handoff transcripts, relative to the session's cwd. */
export const HANDOFF_DIR = join('.genaicode', 'handoff');

const RECAP_MAX = 4_000;

/**
 * The text that goes before the first prompt of an agent taking over a conversation: who talked,
 * a short recap of the latest turns, and where the full transcript is.
 */
export function handoffPreamble(turns: readonly SessionTurn[], file: string | undefined): string {
  const agents = [...new Set(turns.map((turn) => turn.agent))].join(', ');
  const lines = [
    `You are taking over a conversation that the user had with another coding agent (${agents}) in this workspace.`,
    'Recap of what was said (latest last):',
    '',
    recap(turns, file ? RECAP_MAX : RECAP_MAX * 2),
    '',
  ];
  if (file) {
    lines.push(
      `The full transcript, with tool calls, their output and changed files, is in \`${file}\`.`,
      'Read it only when the recap is not enough.',
      '',
    );
  }
  lines.push("The user's new message follows.", '', '---', '');
  return lines.join('\n');
}

/** Write the turns as Markdown under `dir` (relative to `cwd`). Returns the path to give the agent. */
export function writeHandoff(cwd: string, dir: string, agent: string, turns: readonly SessionTurn[]): string {
  const folder = resolve(cwd, dir);
  // Transcripts can hold secrets from prompts and tool output: owner-only.
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // Keep transcripts out of git, also in a folder that already has its own ignore rules.
  const ignore = join(folder, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  else {
    const rules = readFileSync(ignore, 'utf8');
    if (!/^(\*|\*\.handoff\.md)\s*$/m.test(rules)) {
      appendFileSync(ignore, `${rules.endsWith('\n') || !rules ? '' : '\n'}*.handoff.md\n`);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(folder, `${stamp}-${randomBytes(3).toString('hex')}-${agent.replace(/[^\w.-]/g, '_')}.handoff.md`);
  writeFileSync(file, handoffTranscript(turns), { flag: 'wx', mode: 0o600 });
  const inside = relative(resolve(cwd), file);
  return inside && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) ? inside.split(sep).join('/') : file;
}

/** The whole conversation as Markdown, for the agent to read on demand. */
export function handoffTranscript(turns: readonly SessionTurn[]): string {
  const out = ['# Conversation so far', ''];
  for (const turn of turns) {
    out.push(`## Turn ${turn.id} · ${turn.agent}`, '', '**User:**', '', quote(turn.prompt), '');
    for (const entry of turn.entries) {
      switch (entry.kind) {
        case 'text':
          out.push(`**${turn.agent}:**`, '', entry.text.trim(), '');
          break;
        case 'input':
          out.push('**User (during the turn):**', '', quote(entry.text), '');
          break;
        case 'tool': {
          // The session already bounds tool output (`maxToolOutput`); the file keeps all of it.
          const input = entry.input === undefined ? '' : ` ${inline(entry.input)}`;
          out.push(`- tool \`${entry.name}\`${input}${entry.isError ? ' (failed)' : ''}`);
          if (entry.output?.trim()) out.push(fence(entry.output.trim()));
          out.push('');
          break;
        }
        case 'files':
          out.push(`- changed files: ${entry.paths.map((path) => `\`${path}\``).join(', ')}`, '');
          break;
        case 'approval': {
          const what = entry.request.summary ?? entry.request.kind;
          out.push(`- approval: ${what} → ${entry.decision ?? 'unanswered'}`, '');
          break;
        }
        case 'error':
          out.push(`- error: ${entry.message}`, '');
          break;
      }
    }
    const final = turn.result?.text?.trim();
    if (final && !turn.entries.some((entry) => entry.kind === 'text' && entry.text.trim() === final)) {
      out.push(`**${turn.agent}:**`, '', final, '');
    }
    if (turn.result && !turn.result.ok) {
      const error = turn.result.error?.trim();
      const told = error && turn.entries.some((entry) => entry.kind === 'error' && entry.message.includes(error));
      out.push(`_Turn ended: ${turn.result.status}${error && !told ? ` (${error})` : ''}_`, '');
    }
  }
  return out.join('\n');
}

/** User prompts and the agent's last answer per turn, newest kept when over `max`. */
function recap(turns: readonly SessionTurn[], max: number): string {
  const blocks = turns.map((turn) => {
    const lines = [`User: ${turn.prompt.trim()}`];
    for (const entry of turn.entries) if (entry.kind === 'input') lines.push(`User: ${entry.text.trim()}`);
    const last = turn.entries.findLast((entry) => entry.kind === 'text');
    const answer = turn.result?.text?.trim() || (last?.kind === 'text' ? last.text.trim() : '');
    lines.push(`${turn.agent}: ${answer || '(no answer)'}`);
    return lines.join('\n');
  });
  const text = blocks.join('\n\n');
  return text.length <= max ? text : `… (earlier turns left out)\n${text.slice(text.length - max)}`;
}

function inline(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function fence(text: string): string {
  const ticks = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  return `${ticks}\n${text}\n${ticks}`;
}
