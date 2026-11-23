#!/usr/bin/env node
// Live verification for Codex's own `request_user_input` tool (Plan mode and the
// `default_mode_request_user_input` feature flag), plus one-question-tool-per-turn checks.
// Not part of `npm test`. Runs against the real installed `codex` CLI after `npm run build`.
//
// Usage:
//   node scripts/ask-user-live.mjs [--mode plan|flag|both] [--case single|multi|skip|other|all]
//                                  [--delay <sec>] [--effort <level>] [--verbose]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { codexLive, createAgentSession, prepareCodexLive, startQuestionChannel } from '../dist/agents.js';

const VALID_MODES = new Set(['plan', 'flag', 'both']);
const VALID_CASES = new Set(['single', 'multi', 'skip', 'other']);

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'both' },
    case: { type: 'string', default: 'all' },
    delay: { type: 'string', default: '0' },
    effort: { type: 'string', default: 'low' },
    verbose: { type: 'boolean', default: false },
  },
});

if (!VALID_MODES.has(values.mode)) {
  console.error(`Invalid --mode: ${values.mode}. Expected plan, flag, or both.`);
  process.exit(2);
}

const selectedCases =
  values.case === 'all'
    ? [...VALID_CASES]
    : values.case
        .split(',')
        .map((part) => part.trim())
        .filter((part, index, list) => part.length > 0 && list.indexOf(part) === index);
if (
  !selectedCases.length ||
  (values.case !== 'all' && values.case.split(',').some((part) => !VALID_CASES.has(part.trim())))
) {
  console.error(
    `Invalid --case: ${values.case}. Expected all or a comma-separated subset of ${[...VALID_CASES].join(',')}.`,
  );
  process.exit(2);
}

const delaySec = Number(values.delay);
if (!Number.isFinite(delaySec) || delaySec < 0) {
  console.error(`Invalid --delay: ${values.delay}`);
  process.exit(2);
}

const runTimeoutMs = Math.max(120, delaySec + 120) * 1000;

const version = (() => {
  try {
    return execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();
console.log(
  `Codex: ${version} | mode=${values.mode} | case=${values.case} | delay=${delaySec}s | effort=${values.effort}`,
);

function pickOption(question, pattern, fallback) {
  return question?.options?.find((opt) => pattern.test(opt.label))?.label ?? fallback;
}

function baseLabel(label) {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const modes = values.mode === 'both' ? ['plan', 'flag'] : [values.mode];
const cases = [
  {
    id: 'single',
    prompt:
      'Call the request_user_input tool once to ask me one single-choice question: "Which color?" with options Red, Green, Blue. After I answer, reply with ONLY the color I picked.',
    answer: (req) => {
      const choice = pickOption(req.questions[0], /green/i, 'Green');
      return { [req.questions[0].id]: [choice] };
    },
    check: (text, req, sent) => {
      const picked = baseLabel(sent?.[req?.questions?.[0]?.id]?.[0] ?? 'Green');
      return new RegExp(escapeRegExp(picked), 'i').test(text);
    },
  },
  {
    id: 'multi',
    prompt:
      'Call the request_user_input tool once with TWO questions in the same call: (1) "Which database?" with options Postgres and SQLite; (2) "Which features?" with options Search, Export, Audit. After I answer, summarize both of my answers in one short sentence.',
    answer: (req) => {
      const out = {};
      if (req.questions[0]) out[req.questions[0].id] = [pickOption(req.questions[0], /postgres/i, 'Postgres')];
      if (req.questions[1]) {
        const search = pickOption(req.questions[1], /search/i, 'Search');
        const exp = pickOption(req.questions[1], /export/i, 'Export');
        out[req.questions[1].id] = [search === exp ? search : `${search}, ${exp}`];
      }
      return out;
    },
    check: (text, req, sent) => {
      const db = baseLabel(sent?.[req?.questions?.[0]?.id]?.[0] ?? 'Postgres');
      const features = (sent?.[req?.questions?.[1]?.id]?.[0] ?? 'Search, Export')
        .split(/\s*,\s*/)
        .map(baseLabel)
        .filter(Boolean);
      return (
        (req?.questions?.length ?? 0) >= 2 &&
        new RegExp(escapeRegExp(db), 'i').test(text) &&
        features.every((feature) => new RegExp(escapeRegExp(feature), 'i').test(text))
      );
    },
  },
  {
    id: 'skip',
    prompt:
      'Call the request_user_input tool once to ask me "Which framework?" with options React and Vue. If I do not answer, decide yourself and say what you chose in one short sentence.',
    answer: () => undefined,
    check: (text) => /(react|vue)/i.test(text),
  },
  {
    id: 'other',
    prompt:
      'Call the request_user_input tool once to ask me "Which port should the server use?" with options 3000 and 8080, allowing a custom Other answer. After I answer, reply with the port I gave.',
    answer: (req) => ({ [req.questions[0].id]: ['4242'] }),
    check: (text) => text.includes('4242'),
  },
].filter((item) => selectedCases.includes(item.id));

const cwd = mkdtempSync(join(tmpdir(), 'genaicode-ask-user-live-'));
const rows = [];

async function wait(ms, signal) {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function withTimeout(promise, ms, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`Timed out after ${Math.round(ms / 1000)}s`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  const driverOptions = { onlyTaskMcpServers: 'when-listed', sandbox: 'read-only' };
  const agent = codexLive(driverOptions);
  for (const mode of modes) {
    for (const item of cases) {
      let seen;
      let sent;
      let withdrew = false;
      const t0 = Date.now();
      const run = agent.run({
        prompt: item.prompt,
        cwd,
        effort: values.effort,
        timeoutMs: runTimeoutMs,
        ...(mode === 'plan'
          ? { mode: 'plan' }
          : { extraArgs: ['-c', 'features.default_mode_request_user_input=true'] }),
        onQuestion: async (req, signal) => {
          seen = req;
          if (delaySec > 0) await wait(delaySec * 1000, signal);
          if (signal?.aborted) {
            withdrew = true;
            return undefined;
          }
          sent = item.answer(req);
          return sent;
        },
      });
      for await (const event of run) {
        if (values.verbose && (event.type === 'approval-resolved' || event.type === 'error')) {
          console.log(`  [${mode}/${item.id}] event:`, JSON.stringify(event));
        }
      }
      const result = await run.result;
      const elapsed = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
      const text = (result.text ?? '').replace(/\s+/g, ' ').trim();
      const ok = result.ok && Boolean(seen) && !withdrew && item.check(text, seen, sent);
      rows.push({
        mode,
        case: item.id,
        ok,
        asked: Boolean(seen),
        withdrew,
        elapsed,
        text: text.slice(0, 80),
      });
      if (values.verbose) {
        console.log(`\n--- ${mode}/${item.id} (${elapsed}) ---`);
        console.log('raw request.detail:', JSON.stringify(seen?.detail, null, 2));
        console.log('response answers:', JSON.stringify(sent));
        console.log('final text:', text);
      }
    }
  }

  // Also verify one-question-tool-per-turn inside an AgentSession with a question channel:
  // in Plan mode `genaicode_ask` is stripped before spawning Codex (verified via prepareCodexLive)
  // and Codex calls its native `request_user_input`.
  if (modes.includes('plan') && selectedCases.includes('single')) {
    const channel = await startQuestionChannel();
    let capturedTask;
    const spyAgent = {
      ...agent,
      run(task) {
        capturedTask = task;
        return agent.run({ ...task, timeoutMs: runTimeoutMs });
      },
    };
    const session = createAgentSession({
      agent: spyAgent,
      cwd,
      effort: values.effort,
      mode: 'plan',
      questions: channel,
    });
    const handledIds = new Set();
    const questionIds = [];
    const unexpectedApprovals = [];
    let chosenColor = 'Green';
    const stopSub = session.subscribe((state) => {
      for (const pending of state.approvals) {
        if (handledIds.has(pending.id)) continue;
        handledIds.add(pending.id);
        if (pending.kind !== 'question' || !pending.questions?.length) {
          unexpectedApprovals.push(pending.id);
          session.approve(pending.id, 'deny');
          continue;
        }
        questionIds.push(pending.id);
        const q = pending.questions[0];
        chosenColor = pickOption(q, /green/i, 'Green');
        session.answer(pending.id, { [q.id]: [chosenColor] });
      }
    });
    const t0 = Date.now();
    try {
      session.send(
        'Ask me which color I prefer (Red, Green, Blue) using your question tool, then reply with ONLY the color I picked.',
      );
      await withTimeout(session.idle(), runTimeoutMs + 10_000, () => session.stop());
      const turn = session.get().turns[0];
      const text = (turn?.result?.text ?? '').replace(/\s+/g, ' ').trim();
      const attachedBySession = Boolean(capturedTask?.mcpServers?.some((s) => s.name === channel.mcpServer.name));
      const preparedPlan = capturedTask ? await prepareCodexLive(capturedTask, driverOptions) : { args: [] };
      const preparedDefault = capturedTask
        ? await prepareCodexLive({ ...capturedTask, mode: 'default' }, driverOptions)
        : { args: [] };
      const strippedInPlan = !preparedPlan.args.some((arg) => arg.includes(channel.mcpServer.name));
      const keptInDefault = preparedDefault.args.some((arg) => arg.includes(channel.mcpServer.name));
      const usedOwnTool = questionIds.length === 1 && !questionIds[0].startsWith('ask-');
      const ok =
        Boolean(turn?.result?.ok) &&
        attachedBySession &&
        strippedInPlan &&
        keptInDefault &&
        usedOwnTool &&
        unexpectedApprovals.length === 0 &&
        new RegExp(escapeRegExp(chosenColor), 'i').test(text);
      rows.push({
        mode: 'plan+session',
        case: 'own-tool-only',
        ok,
        asked: questionIds.length > 0,
        withdrew: false,
        elapsed: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
        text: text.slice(0, 80),
      });
      if (values.verbose) {
        console.log(`\n--- plan+session/own-tool-only ---`);
        console.log({
          attachedBySession,
          strippedInPlan,
          keptInDefault,
          usedOwnTool,
          unexpectedApprovals,
          chosenColor,
          text,
        });
      }
    } finally {
      stopSub();
      session.close();
      await channel.close();
    }
  }
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.table(rows);
process.exit(rows.length > 0 && rows.every((row) => row.ok) ? 0 : 1);
