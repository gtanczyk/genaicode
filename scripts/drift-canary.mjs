#!/usr/bin/env node
// Weekly check that the agents' latest releases still match what genaicode reads.
// Needs no keys: compares published versions with each reader's `verified` stamp, and the
// latest Codex app-server protocol with the fields genaicode reads from it.
// Usage: node scripts/drift-canary.mjs   (after `npm run build`). Exit 1 when something drifted.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { claudeSessions, codexSessions, copilotSessions } from '../dist/agents.js';

/** Whether version `a` is later than `b`, number by number. */
function isNewerVersion(a, b) {
  const [left, right] = [a, b].map((version) => (version.match(/\d+/g) ?? []).map(Number));
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    const difference = (left[at] ?? 0) - (right[at] ?? 0);
    if (difference) return difference > 0;
  }
  return false;
}

const problems = [];
const notes = [];

// 1. Published versions against the version each reader was last checked against.
const packages = [
  { pkg: '@anthropic-ai/claude-code', source: claudeSessions() },
  { pkg: '@openai/codex', source: codexSessions() },
  { pkg: '@github/copilot', source: copilotSessions() },
];
for (const { pkg, source } of packages) {
  let latest;
  try {
    latest = execFileSync('npm', ['view', pkg, 'version'], { encoding: 'utf8' }).trim();
  } catch {
    problems.push(`${source.name}: cannot ask npm for the version of ${pkg}`);
    continue;
  }
  if (source.verified && isNewerVersion(latest, source.verified)) {
    notes.push(
      `${source.name}: ${pkg} ${latest} is newer than the one checked (${source.verified}); run \`genaicode sessions doctor\` on real sessions and bump \`verified\``,
    );
  } else notes.push(`${source.name}: ${latest}, checked ${source.verified}`);
}

// 2. What genaicode reads of Codex's app-server protocol (src/agents/sessions/codex-api.ts).
const contract = {
  'v2/ThreadListParams.ts': ['cursor', 'limit', 'sortKey', 'sourceKinds', 'modelProviders', 'useStateDbOnly'],
  'v2/ThreadListResponse.ts': ['data', 'nextCursor'],
  'v2/ThreadTurnsListParams.ts': ['threadId', 'cursor', 'limit', 'sortDirection', 'itemsView'],
  'v2/ThreadTurnsListResponse.ts': ['data', 'nextCursor'],
  'v2/Thread.ts': [
    'id',
    'preview',
    'ephemeral',
    'parentThreadId',
    'createdAt',
    'updatedAt',
    'status',
    'cwd',
    'model',
    'gitInfo',
    'name',
    'path',
  ],
  // A quoted name is a value (a status, a flag), the others are fields.
  'v2/ThreadStatus.ts': ['"notLoaded"', '"idle"', '"active"', 'activeFlags'],
  'v2/ThreadActiveFlag.ts': ['"waitingOnApproval"', '"waitingOnUserInput"'],
  'v2/Turn.ts': ['items', 'startedAt', 'completedAt'],
  'v2/GitInfo.ts': ['branch', 'originUrl'],
  'v2/FileUpdateChange.ts': ['path', 'diff'],
  'v2/PatchApplyStatus.ts': ['"failed"'],
  // Times every item carries, ahead of its variants.
  'v2/ThreadItem.ts': ['startedAtMs', 'completedAtMs'],
};
// Per union file, the fields read of each `"type": "x"` variant.
const items = {
  userMessage: ['id', 'content'],
  agentMessage: ['id', 'text'],
  commandExecution: ['id', 'command', 'cwd', 'aggregatedOutput', 'exitCode'],
  fileChange: ['id', 'changes', 'status'],
  mcpToolCall: ['id', 'server', 'tool', 'arguments', 'result', 'error'],
  dynamicToolCall: ['id', 'tool', 'arguments', 'contentItems', 'success'],
  webSearch: ['id', 'query'],
};
const variants = { 'v2/ThreadItem.ts': items, 'v2/UserInput.ts': { text: ['text'] } };
const dir = mkdtempSync(join(tmpdir(), 'codex-protocol-'));
try {
  execFileSync('npx', ['-y', '@openai/codex@latest', 'app-server', 'generate-ts', '--out', dir], { stdio: 'ignore' });
  const code = (file) => {
    try {
      // Comments say what a field was; only the declarations count.
      return readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
    } catch {
      return undefined;
    }
  };
  const has = (text, name) =>
    name.startsWith('"') ? text.includes(name) : new RegExp(`(^|[^\\w"])${name}\\??:`).test(text);
  for (const [file, names] of Object.entries(contract)) {
    const text = code(file);
    if (text === undefined) problems.push(`codex protocol: ${file} is gone`);
    else
      for (const name of names.filter((name) => !has(text, name)))
        problems.push(`codex protocol: ${file} has no \`${name}\``);
  }
  for (const [file, types] of Object.entries(variants)) {
    const all = code(file);
    if (all === undefined) {
      problems.push(`codex protocol: ${file} is gone`);
      continue;
    }
    const raw = readFileSync(join(dir, file), 'utf8');
    for (const [type, names] of Object.entries(types)) {
      const at = all.indexOf(`"type": "${type}"`);
      if (at < 0) {
        problems.push(`codex protocol: ${file} has no \`${type}\` variant`);
        continue;
      }
      const next = all.indexOf('"type": "', at + 1);
      let variant = all.slice(at, next < 0 ? undefined : next);
      // A variant may be `{ "type": "x" } & XItem`, its fields in the imported type.
      const named = /^"type": "\w+" \} & (\w+)/.exec(variant)?.[1];
      const from = named && new RegExp(`import type \\{ ${named} \\} from "([^"]+)"`).exec(raw)?.[1];
      if (from) variant += code(join(dirname(file), `${from}.ts`)) ?? '';
      for (const name of names.filter((name) => !has(variant, name)))
        problems.push(`codex protocol: ${type} in ${file} has no \`${name}\``);
    }
  }
} catch (error) {
  problems.push(
    `codex protocol: generate-ts failed (${error instanceof Error ? error.message.split('\n')[0] : error})`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const report = [
  '## Agent drift canary',
  '',
  ...(problems.length ? ['### Drifted', ...problems.map((line) => `- ${line}`), ''] : ['Nothing drifted.', '']),
  '### Versions',
  ...notes.map((line) => `- ${line}`),
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
process.exit(problems.length ? 1 : 0);
