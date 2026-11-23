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
import { codexLive, createAgentSession, startQuestionChannel } from '../dist/agents.js';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'both' },
    case: { type: 'string', default: 'all' },
    delay: { type: 'string', default: '0' },
    effort: { type: 'string', default: 'low' },
    verbose: { type: 'boolean', default: false },
  },
});

const delaySec = Number(values.delay);
if (!Number.isFinite(delaySec) || delaySec < 0) {
  console.error(`Invalid --delay: ${values.delay}`);
  process.exit(2);
}

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

const modes = values.mode === 'both' ? ['plan', 'flag'] : [values.mode];
const cases = [
  {
    id: 'single',
    prompt:
      'Call the request_user_input tool once to ask me one single-choice question: "Which color?" with options Red, Green, Blue. After I answer, reply with ONLY the color I picked.',
    answer: (req) => ({ [req.questions[0].id]: [req.questions[0].options[1]?.label ?? 'Green'] }),
    check: (text) => /green/i.test(text),
  },
  {
    id: 'multi',
    prompt:
      'Call the request_user_input tool once with TWO questions in the same call: (1) "Which database?" with options Postgres and SQLite; (2) "Which features?" with options Search, Export, Audit. After I answer, summarize both of my answers in one short sentence.',
    answer: (req) => {
      const out = {};
      if (req.questions[0]) out[req.questions[0].id] = [req.questions[0].options[0]?.label ?? 'Postgres'];
      if (req.questions[1]) out[req.questions[1].id] = ['Search, Export'];
      return out;
    },
    check: (text, req) => (req?.questions?.length ?? 0) >= 2 && /postgres/i.test(text) && /search/i.test(text),
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
].filter((item) => values.case === 'all' || values.case.split(',').includes(item.id));

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

try {
  const agent = codexLive({ onlyTaskMcpServers: 'when-listed', sandbox: 'read-only' });
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
      const ok = result.ok && Boolean(seen) && !withdrew && item.check(text, seen);
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
  // in Plan mode `genaicode_ask` is dropped and Codex calls `request_user_input`.
  if (modes.includes('plan') && (values.case === 'all' || values.case.split(',').includes('single'))) {
    const channel = await startQuestionChannel();
    const session = createAgentSession({
      agent,
      cwd,
      effort: values.effort,
      mode: 'plan',
      questions: channel,
    });
    const askedIds = [];
    const stopSub = session.subscribe((state) => {
      const pending = state.approvals[0];
      if (!pending || askedIds.includes(pending.id)) return;
      askedIds.push(pending.id);
      const q = pending.questions?.[0];
      if (q) session.answer(pending.id, { [q.id]: [q.options[1]?.label ?? 'Green'] });
    });
    const t0 = Date.now();
    try {
      session.send(
        'Ask me which color I prefer (Red, Green, Blue) using your question tool, then reply with ONLY the color I picked.',
      );
      await session.idle();
      const turn = session.get().turns[0];
      const text = (turn?.result?.text ?? '').replace(/\s+/g, ' ').trim();
      const usedOwnTool = askedIds.length === 1 && !askedIds[0].startsWith('ask-');
      const ok = Boolean(turn?.result?.ok) && usedOwnTool && /green/i.test(text);
      rows.push({
        mode: 'plan+session',
        case: 'own-tool-only',
        ok,
        asked: askedIds.length > 0,
        withdrew: false,
        elapsed: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
        text: text.slice(0, 80),
      });
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
process.exit(rows.every((row) => row.ok) ? 0 : 1);
