#!/usr/bin/env node

import { main } from './cli/main.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

process.exitCode = await main({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  signal: controller.signal,
  interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  readStdin: async () => {
    if (process.stdin.isTTY) return undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  },
});
