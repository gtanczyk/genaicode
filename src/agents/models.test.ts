import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  canDiscoverModels,
  createModelCatalog,
  listAgentModels,
  parseAgyModels,
  parseCursorModels,
  parseOpencodeModels,
} from './models.js';

const root = mkdtempSync(join(tmpdir(), 'genaicode-models-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function makeBin(dir: string, name: string, script: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe('model CLI output parsers', () => {
  it('parses agy models output including carriage-return spinner frames and ANSI codes', () => {
    const raw = [
      '\r⠋ Fetching available models...\r⠙ Fetching available models...\rgemini-4-neon-high             Gemini 4 Neon (High)',
      '\x1b[1mgemini-4-neon-medium\x1b[0m           Gemini 4 Neon (Medium)',
      'claude-opus-5-5-high           Claude Opus 5.5 (High)',
      'gemini-4-neon-high             Gemini 4 Neon (High)',
      '',
    ].join('\n');
    expect(parseAgyModels(raw)).toEqual([
      { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
      { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
      { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
    ]);
  });

  it('parses cursor-agent models output and skips headers and tips', () => {
    const raw = [
      'Available models',
      'gpt-5 - GPT-5',
      'sonnet-4-thinking  Claude 4 Sonnet Thinking',
      'Tip: use --model to choose one.',
    ].join('\n');
    expect(parseCursorModels(raw)).toEqual([
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'sonnet-4-thinking', label: 'Claude 4 Sonnet Thinking' },
    ]);
  });

  it('parses opencode models output', () => {
    expect(parseOpencodeModels('anthropic/claude-sonnet-4\nopenai/gpt-5\nnot a model\n')).toEqual([
      { id: 'anthropic/claude-sonnet-4' },
      { id: 'openai/gpt-5' },
    ]);
  });
});

describe('listAgentModels and createModelCatalog', () => {
  it('discovers models from agy and caches results with invalidation', async () => {
    const bin = mkdtempSync(join(root, 'agy-'));
    const countFile = join(bin, 'calls.txt');
    makeBin(
      bin,
      'agy',
      `echo x >> "${countFile}"
if [ "$1" = "models" ]; then
  printf '\\rFetching available models...\\rgemini-4-neon-high   Gemini 4 Neon (High)\\nclaude-opus-5-5-high   Claude Opus 5.5 (High)\\n'
  exit 0
fi
exit 1`,
    );

    expect(canDiscoverModels('antigravity')).toBe(true);
    expect(canDiscoverModels('claude')).toBe(false);

    const direct = await listAgentModels({ name: 'antigravity', command: 'agy' }, { PATH: bin });
    expect(direct).toEqual([
      { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
      { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
    ]);
    expect(await listAgentModels({ name: 'claude', command: 'claude' }, { PATH: bin })).toEqual([]);

    const catalog = createModelCatalog({
      agents: [{ name: 'antigravity', command: 'agy' }],
      getEnv: () => ({ PATH: bin }),
    });
    const [a, b] = await Promise.all([catalog.list('antigravity'), catalog.list('antigravity')]);
    expect(a).toEqual(direct);
    expect(b).toEqual(direct);
    // Cached hit does not spawn again.
    expect(await catalog.list('antigravity')).toEqual(direct);

    // Unknown agent returns empty without failing.
    expect(await catalog.list('unknown')).toEqual([]);

    catalog.invalidate('antigravity');
    expect(await catalog.list('antigravity')).toEqual(direct);
  });

  it('returns empty array when CLI fails or is missing', async () => {
    const bin = mkdtempSync(join(root, 'fail-'));
    makeBin(bin, 'cursor-agent', 'echo "Authentication required" >&2; exit 1');
    expect(await listAgentModels({ name: 'cursor', command: 'cursor-agent' }, { PATH: bin })).toEqual([]);
    expect(await listAgentModels({ name: 'antigravity', command: 'agy' }, { PATH: bin })).toEqual([]);
  });
});
