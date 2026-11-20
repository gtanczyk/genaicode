import { defaultAgents } from '../agents/defaults.js';
import { sendSession } from '../agents/sessions/send.js';
import type { DetachedSend } from './detach-send.js';
import { defaultUpdateDeps, registerRun } from './update.js';

// A separate process so closing the terminal after --detach leaves the turn running.
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
process.once('message', async (request: DetachedSend) => {
  let answered = false;
  const unregister = registerRun(defaultUpdateDeps(process.env).packageRoot);
  process.once('disconnect', () => {
    if (!answered) controller.abort();
  });
  const answer = (ok: boolean, error?: string) => {
    if (answered || !process.connected) return;
    answered = true;
    process.send?.({ ok, error });
  };
  try {
    const agents = defaultAgents().filter((a) => !request.agent || a.name === request.agent);
    const result = await sendSession(agents, request.id, request.prompt, {
      signal: controller.signal,
      permissions: request.sandbox ? { sandbox: request.sandbox } : undefined,
      onEvent(event) {
        if (
          event.type === 'session' ||
          event.type === 'message' ||
          event.type === 'text-delta' ||
          event.type === 'tool-start'
        )
          answer(true);
      },
    });
    answer(result.ok, result.error);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    answer(false, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    unregister();
  }
});
