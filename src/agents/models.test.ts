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

  it('parses Windows CRLF model output cleanly across all parsers', () => {
    expect(
      parseAgyModels('gemini-4-neon-high   Gemini 4 Neon (High)\r\nclaude-opus-5-5-high   Claude Opus 5.5\r\n'),
    ).toEqual([
      { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
      { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5' },
    ]);
    expect(parseCursorModels('gpt-5 - GPT-5\r\n')).toEqual([{ id: 'gpt-5', label: 'GPT-5' }]);
    expect(parseOpencodeModels('openai/gpt-5\r\n')).toEqual([{ id: 'openai/gpt-5' }]);
  });

  it('keys catalog cache by directory and does not reuse stale in-flight probes after invalidate()', async () => {
    const bin = mkdtempSync(join(root, 'cwd-'));
    const dirA = mkdtempSync(join(root, 'dir-a-'));
    const dirB = mkdtempSync(join(root, 'dir-b-'));
    const started = join(bin, 'started');
    makeBin(
      bin,
      'opencode',
      `dir="\${PWD##*/}"
if [ "$GENAICODE_ACCT" = "acct1" ]; then
  echo 1 > "${started}"
  /bin/sleep 0.25
fi
echo "$GENAICODE_ACCT/$dir"`,
    );
    let acct = 'acct1';
    const catalog = createModelCatalog({
      agents: [{ name: 'opencode', command: 'opencode' }],
      getEnv: () => ({ PATH: bin, GENAICODE_ACCT: acct }),
    });
    const first = catalog.list('opencode', { cwd: dirA });
    // Account changes mid-flight: invalidating forces the next ordinary request to start a fresh probe.
    acct = 'acct2';
    catalog.invalidate('opencode');
    const [stale, fresh, otherDir] = await Promise.all([
      first,
      catalog.list('opencode', { cwd: dirA }),
      catalog.list('opencode', { cwd: dirB }),
    ]);
    expect(stale).toEqual([{ id: `acct1/${dirA.split('/').pop()}` }]);
    expect(fresh).toEqual([{ id: `acct2/${dirA.split('/').pop()}` }]);
    expect(otherDir).toEqual([{ id: `acct2/${dirB.split('/').pop()}` }]);
  });

  it('does not let an older probe overwrite a newer refresh result in the cache', async () => {
    const bin = mkdtempSync(join(root, 'refresh-race-'));
    makeBin(
      bin,
      'opencode',
      `if [ "$GENAICODE_REV" = "old" ]; then
  /bin/sleep 0.25
  echo "openai/old-model"
else
  echo "openai/new-model"
fi`,
    );
    let rev = 'old';
    const catalog = createModelCatalog({
      agents: [{ name: 'opencode', command: 'opencode' }],
      getEnv: () => ({ PATH: bin, GENAICODE_REV: rev }),
    });
    const slowOld = catalog.list('opencode');
    rev = 'new';
    const fastNew = await catalog.list('opencode', { refresh: true });
    expect(fastNew).toEqual([{ id: 'openai/new-model' }]);
    expect(await slowOld).toEqual([{ id: 'openai/old-model' }]);
    // Subsequent cached lookup must return the newer refresh result, not the stale probe.
    expect(await catalog.list('opencode')).toEqual([{ id: 'openai/new-model' }]);
  });

  it('ignores prototype property names like constructor in listAgentModels()', async () => {
    expect(await listAgentModels({ name: 'constructor', command: process.execPath })).toEqual([]);
    expect(await listAgentModels({ name: 'toString', command: process.execPath })).toEqual([]);
  });

  it('returns empty array when CLI fails or is missing', async () => {
    const bin = mkdtempSync(join(root, 'fail-'));
    makeBin(bin, 'cursor-agent', 'echo "Authentication required" >&2; exit 1');
    expect(await listAgentModels({ name: 'cursor', command: 'cursor-agent' }, { PATH: bin })).toEqual([]);
    expect(await listAgentModels({ name: 'antigravity', command: 'agy' }, { PATH: bin })).toEqual([]);
  });
});
