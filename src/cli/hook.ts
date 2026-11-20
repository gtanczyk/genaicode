import { recordHook } from '../agents/sessions/live.js';
import { noticeFor, readNotify, sendNotice, type Notice } from '../agents/sessions/notify.js';

/**
 * `genaicode hook <agent>`: what an agent's hook runs. Notes what the session is doing from the
 * hook's input on stdin and never gets in the agent's way: no output it would act on, exit 0.
 */
export async function runHook(
  agent: string | undefined,
  input: string | undefined,
  env: NodeJS.ProcessEnv,
  stdout: { write(text: string): unknown },
  send: (notice: Notice) => unknown = (notice) => sendNotice(notice),
): Promise<number> {
  try {
    const event: unknown = JSON.parse(input ?? '');
    if (agent) {
      // `genaicode notify on`: a question asked, or a turn over, shows on the desktop.
      const settings = await readNotify(env);
      const wanted = settings.approval || settings.done;
      let notice: Notice | undefined;
      await recordHook(agent, event, {
        env,
        ...(wanted ? { onRecord: (before, after) => void (notice = noticeFor(before, after, settings)) } : {}),
      });
      if (notice) send(notice);
    }
    // A `Stop` hook answers in JSON; an empty object decides nothing.
    const name = (event as { hook_event_name?: unknown } | null)?.hook_event_name;
    if (name === 'Stop') stdout.write('{}\n');
  } catch {
    // A hook that fails would show an error in the agent for nothing the user can act on.
  }
  return 0;
}
