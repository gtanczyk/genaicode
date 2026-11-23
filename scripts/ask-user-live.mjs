#!/usr/bin/env node
// Live acceptance check for `ask_user` across installed coding agents.
// Not part of `npm test`: starts real agent CLIs and consumes model tokens.
//
// Usage (after `npm run build`):
//   node scripts/ask-user-live.mjs
//   node scripts/ask-user-live.mjs --agent muse,museLive,codex --delay 0,65 --verbose
//
// Exit 0 when every tested agent passes at every requested delay, 1 otherwise.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  antigravity,
  claude,
  cliVersion,
  codex,
  codexLive,
  copilot,
  createAgentSession,
  cursor,
  findExecutable,
  gemini,
  muse,
  museLive,
  startQuestionChannel,
} from '../dist/agents.js';

const PROMPT =
  'Use the ask_user tool once to ask me which color I prefer (Red, Green, Blue), then tell me in one sentence what I chose.';

const ROSTER = [
  { id: 'codex', create: () => codex() },
  { id: 'codexLive', create: () => codexLive() },
  { id: 'antigravity', create: () => antigravity() },
  { id: 'copilot', create: () => copilot() },
  { id: 'muse', create: () => muse() },
  { id: 'museLive', create: () => museLive() },
  { id: 'gemini', create: () => gemini() },
  { id: 'cursor', create: () => cursor() },
  { id: 'claude', create: () => claude() },
];

const DEFAULT_IDS = ['codex', 'codexLive', 'antigravity', 'copilot', 'muse', 'museLive', 'gemini', 'cursor'];

function parseArgs(argv) {
  let agents;
  let delays = [0, 65];
  let timeoutSec = 180;
  let verbose = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--agent' || arg === '--agents') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      agents = [...(agents ?? []), ...value.split(',').filter(Boolean)];
    } else if (arg.startsWith('--agent=')) {
      agents = [...(agents ?? []), ...arg.slice('--agent='.length).split(',').filter(Boolean)];
    } else if (arg === '--delay' || arg === '--delays') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      delays = value.split(',').map((part) => {
        const n = Number(part);
        if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid delay: ${part}`);
        return n;
      });
    } else if (arg.startsWith('--delay=')) {
      delays = arg
        .slice('--delay='.length)
        .split(',')
        .map((part) => {
          const n = Number(part);
          if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid delay: ${part}`);
          return n;
        });
    } else if (arg === '--timeout') {
      timeoutSec = Number(argv[++i]);
      if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) throw new Error('Invalid --timeout');
    } else if (arg.startsWith('--timeout=')) {
      timeoutSec = Number(arg.slice('--timeout='.length));
      if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) throw new Error('Invalid --timeout');
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/ask-user-live.mjs [options]

Options:
  --agent <ids>    Comma-separated agent ids (default: ${DEFAULT_IDS.join(',')})
                   Available: ${ROSTER.map((r) => r.id).join(', ')}
  --delay <secs>   Comma-separated answer delays in seconds (default: 0,65)
  --timeout <sec>  Per-run timeout in seconds on top of delay (default: 180)
  --verbose        Print full approval requests, tool calls, and errors`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { agents: agents ?? DEFAULT_IDS, delays, timeoutSec, verbose };
}

function oneLine(text, max = 64) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function runCase(entry, delaySec, timeoutSec, verbose) {
  const agent = entry.create();
  const cwd = mkdtempSync(join(tmpdir(), `genaicode-ask-live-${entry.id}-`));
  const channel = await startQuestionChannel();
  const seenIds = new Set();
  const questions = [];
  const extraApprovals = [];
  const timers = [];
  let withdrawnEarly = false;
  let session;

  try {
    session = createAgentSession({
      agent,
      cwd,
      questions: channel,
      task: { timeoutMs: (timeoutSec + delaySec) * 1000 },
    });

    const unsubscribe = session.subscribe((state) => {
      for (const req of state.approvals) {
        if (seenIds.has(req.id)) continue;
        seenIds.add(req.id);
        if (verbose) {
          console.error(`[${entry.id} delay=${delaySec}s] approval-request:`, JSON.stringify(req, null, 2));
        }
        if (req.kind === 'question') {
          questions.push(req);
          const qid = req.questions?.[0]?.id ?? 'q1';
          const answer = () => {
            const ok = session.answer(req.id, { [qid]: ['Green'] });
            if (!ok) withdrawnEarly = true;
            if (verbose) {
              console.error(`[${entry.id} delay=${delaySec}s] answered ${req.id} after ${delaySec}s (accepted=${ok})`);
            }
          };
          if (delaySec === 0) {
            queueMicrotask(answer);
          } else {
            timers.push(setTimeout(answer, delaySec * 1000));
          }
        } else {
          extraApprovals.push(req);
          // Deny unexpected permission prompts so the run finishes instead of hanging.
          queueMicrotask(() => session.approve(req.id, 'deny'));
        }
      }
    });

    session.send(PROMPT);
    await session.idle();
    unsubscribe();

    const turn = session.get().turns.at(-1);
    const entries = turn?.entries ?? [];
    const tools = entries.filter((item) => item.kind === 'tool');
    const toolErrors = tools.filter((item) => item.isError);
    const errors = entries.filter((item) => item.kind === 'error').map((item) => item.message);
    const finalText =
      turn?.result?.text ??
      entries
        .filter((item) => item.kind === 'text')
        .map((item) => item.text)
        .join('\n')
        .trim();

    if (verbose) {
      console.error(
        `[${entry.id} delay=${delaySec}s] result:`,
        JSON.stringify({ result: turn?.result, tools, errors }, null, 2),
      );
    }

    const timedOut =
      withdrawnEarly ||
      turn?.result?.status === 'timeout' ||
      toolErrors.some((tool) => /time(?:d)?\s*out|deadline/i.test(tool.output ?? '')) ||
      errors.some((message) => /time(?:d)?\s*out|deadline/i.test(message));

    const calledTool = questions.length > 0;
    const namesGreen = /\bgreen\b/i.test(finalText ?? '');
    const passed =
      turn?.result?.ok === true &&
      questions.length === 1 &&
      extraApprovals.length === 0 &&
      !timedOut &&
      toolErrors.length === 0 &&
      namesGreen;

    return {
      agent: entry.id,
      delay: `${delaySec}s`,
      calledTool: questions.length === 1 ? 'yes' : `no (${questions.length})`,
      extraApprovals: extraApprovals.length
        ? `${extraApprovals.length} (${extraApprovals.map((r) => r.summary ?? r.kind).join('; ')})`
        : '0',
      timedOut: timedOut ? 'yes' : 'no',
      toolErrors: toolErrors.length,
      finalAnswer: oneLine(finalText || turn?.result?.error || errors[0] || ''),
      status: passed ? 'PASS' : 'FAIL',
      passed,
    };
  } finally {
    for (const timer of timers) clearTimeout(timer);
    session?.close();
    await channel.close().catch(() => {});
    rmSync(cwd, { recursive: true, force: true });
  }
}

function formatTable(rows) {
  const columns = [
    ['Agent', 'agent'],
    ['Version', 'version'],
    ['Delay', 'delay'],
    ['Called tool', 'calledTool'],
    ['Extra approvals', 'extraApprovals'],
    ['Timed out', 'timedOut'],
    ['Status', 'status'],
    ['Final answer', 'finalAnswer'],
  ];
  const widths = columns.map(([header, key]) =>
    Math.max(header.length, ...rows.map((row) => String(row[key] ?? '').length)),
  );
  const line = (values) => values.map((value, i) => String(value).padEnd(widths[i])).join(' | ');
  const sep = widths.map((width) => '-'.repeat(width)).join('-+-');
  return [
    line(columns.map(([header]) => header)),
    sep,
    ...rows.map((row) => line(columns.map(([, key]) => row[key] ?? ''))),
  ].join('\n');
}

async function main() {
  const { agents: requestedIds, delays, timeoutSec, verbose } = parseArgs(process.argv.slice(2));
  const byId = new Map(ROSTER.map((entry) => [entry.id, entry]));
  for (const id of requestedIds) {
    if (!byId.has(id)) throw new Error(`Unknown agent id: ${id}. Available: ${ROSTER.map((r) => r.id).join(', ')}`);
  }

  const rows = [];
  let failures = 0;

  for (const id of requestedIds) {
    const entry = byId.get(id);
    const probe = entry.create();
    const bin = findExecutable(probe.command);
    if (!bin) {
      rows.push({
        agent: id,
        version: '-',
        delay: '-',
        calledTool: '-',
        extraApprovals: '-',
        timedOut: '-',
        status: 'SKIP',
        finalAnswer: `${probe.command} not installed`,
      });
      continue;
    }
    const version = (await cliVersion(probe.command)) ?? 'unknown';
    if (!probe.capabilities.mcp && !probe.capabilities.questions) {
      rows.push({
        agent: id,
        version,
        delay: '-',
        calledTool: '-',
        extraApprovals: '-',
        timedOut: '-',
        status: 'SKIP',
        finalAnswer: 'no capabilities.mcp / capabilities.questions',
      });
      continue;
    }
    for (const delaySec of delays) {
      console.error(`Running ${id} (${version}) with delay=${delaySec}s...`);
      const result = await runCase(entry, delaySec, timeoutSec, verbose);
      rows.push({ ...result, version });
      if (!result.passed) failures += 1;
    }
  }

  console.log('\n' + formatTable(rows));
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
