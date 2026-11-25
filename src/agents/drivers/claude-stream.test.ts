import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { claude, claudeArgs, claudeTakesPartialMessages } from './claude.js';
import type { AgentEvent } from '../types.js';

const dir = mkdtempSync(join(tmpdir(), 'genaicode-claude-stream-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Claude Code that lists `--include-partial-messages` in its help (unless FAKE_OLD), and with the
// flag streams its reply as `stream_event` text deltas before the whole message.
function fakeClaude(name: string, old: boolean): string {
  const script = join(dir, `${name}.mjs`);
  writeFileSync(
    script,
    `const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
if (args.includes('--help')) {
  process.stdout.write('Usage: claude [options]\\n  --output-format <format>\\n' + (${old} ? '' : '  --include-partial-messages  Include partial message chunks\\n'));
  process.exit(0);
}
out({ type: 'system', subtype: 'init', session_id: 's-1', model: 'claude-opus-5-5' });
if (args.includes('--include-partial-messages')) {
  for (const text of ['Hel', 'lo ', 'there']) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
}
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello there' }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: 'Hello there' });
process.exit(0);
`,
  );
  const bin = join(dir, name);
  writeFileSync(bin, `#!${process.execPath}\nimport(${JSON.stringify(script)});\n`, { mode: 0o755 });
  return bin;
}

async function events(command: string, partialMessages?: boolean): Promise<AgentEvent[]> {
  const run = claude({ command, steer: false, ...(partialMessages !== undefined ? { partialMessages } : {}) }).run({
    prompt: 'hi',
    cwd: dir,
  });
  const seen: AgentEvent[] = [];
  for await (const event of run) seen.push(event);
  return seen;
}

describe('claude() streaming', () => {
  it('asks a CLI that takes --include-partial-messages for text deltas', async () => {
    const bin = fakeClaude('claude-new', false);
    expect(await claudeTakesPartialMessages(bin)).toBe(true);
    const seen = await events(bin);
    expect(
      seen.filter((event) => event.type === 'text-delta').map((event) => event.type === 'text-delta' && event.text),
    ).toEqual(['Hel', 'lo ', 'there']);
    expect(seen.some((event) => event.type === 'message' && event.text === 'Hello there')).toBe(true);
  });

  it('runs an older CLI as before, the reply arriving whole', async () => {
    const bin = fakeClaude('claude-old', true);
    expect(await claudeTakesPartialMessages(bin)).toBe(false);
    const seen = await events(bin);
    expect(seen.some((event) => event.type === 'text-delta')).toBe(false);
    expect(seen.some((event) => event.type === 'message' && event.text === 'Hello there')).toBe(true);
  });

  it('takes an explicit choice over the probe', async () => {
    const bin = fakeClaude('claude-off', false);
    expect((await events(bin, false)).some((event) => event.type === 'text-delta')).toBe(false);
    expect(await claudeTakesPartialMessages(join(dir, 'missing-claude'))).toBe(false);
  });

  it('asks again after a probe that could not start', async () => {
    const name = 'claude-later';
    const bin = join(dir, name);
    expect(await claudeTakesPartialMessages(bin)).toBe(false);
    // Installed since: the next probe finds the flag.
    expect(fakeClaude(name, false)).toBe(bin);
    expect(await claudeTakesPartialMessages(bin)).toBe(true);
  });

  it('puts the flag after the output format', () => {
    const args = claudeArgs({ prompt: 'p', cwd: dir }, {}, undefined, undefined, false, false, true);
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 3)).toEqual([
      '--output-format',
      'stream-json',
      '--include-partial-messages',
    ]);
    expect(claudeArgs({ prompt: 'p', cwd: dir })).not.toContain('--include-partial-messages');
  });
});
