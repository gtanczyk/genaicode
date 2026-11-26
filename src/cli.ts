#!/usr/bin/env node

const argv = process.argv.slice(2);

const readStdin = async (): Promise<string | undefined> => {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

if (argv[0] === 'hook') {
  // Agents run this on every turn: it loads nothing but what it needs.
  const { runAnswerHook, runHook } = await import('./cli/hook.js');
  if (argv[2] === '--answer') {
    // The agent ends the hook when its own dialog was answered: clean up, then go.
    const controller = new AbortController();
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, () => controller.abort());
    process.exitCode = await runAnswerHook(argv[1], await readStdin(), process.env, process.stdout, {
      signal: controller.signal,
    });
  } else {
    // `hook copilot postToolUse`: an agent whose hook input does not name its event.
    const event = argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined;
    process.exitCode = await runHook(argv[1], await readStdin(), process.env, process.stdout, undefined, event);
  }
} else {
  const { main } = await import('./cli/main.js');
  const controller = new AbortController();
  let interruptGuard: (() => boolean) | undefined;
  process.on('SIGINT', () => {
    if (!interruptGuard || interruptGuard()) controller.abort();
  });
  process.once('SIGTERM', () => controller.abort());

  process.exitCode = await main({
    argv,
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    signal: controller.signal,
    setInterruptGuard: (guard) => {
      interruptGuard = guard;
    },
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    readStdin,
  });
}
