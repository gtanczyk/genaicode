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
  const { runHook } = await import('./cli/hook.js');
  process.exitCode = await runHook(argv[1], await readStdin(), process.env, process.stdout);
} else {
  const { main } = await import('./cli/main.js');
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());

  process.exitCode = await main({
    argv,
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    signal: controller.signal,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    readStdin,
  });
}
