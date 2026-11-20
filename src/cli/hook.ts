import { waitForAnswer, type WaitOptions } from '../agents/sessions/answer.js';
import { hookInput, hookOutput } from '../agents/sessions/hook-input.js';
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
  /** The event the hook was installed for, for an agent whose input does not name it (Copilot). */
  name?: string,
): Promise<number> {
  let own = name;
  try {
    const raw: unknown = JSON.parse(input ?? '');
    const named = (raw as { hook_event_name?: unknown } | null)?.hook_event_name;
    own ??= typeof named === 'string' ? named : undefined;
    const event = agent ? hookInput(agent, raw, own) : raw;
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
  } catch {
    // A hook that fails would show an error in the agent for nothing the user can act on.
  }
  // Some hooks answer in JSON (Claude Code's `Stop`, every one of Cursor's and Gemini's): this one
  // decides nothing, and is printed even when the report failed.
  const output = hookOutput(agent ?? '', own);
  if (output) stdout.write(output);
  return 0;
}

/**
 * `genaicode hook <agent> --answer`: the `PermissionRequest` hook that holds the question open
 * for the tower. The agent's own dialog shows it meanwhile; an answer given here is printed as
 * the hook's decision, and with none (answered in the agent, timed out) it decides nothing.
 */
export async function runAnswerHook(
  agent: string | undefined,
  input: string | undefined,
  env: NodeJS.ProcessEnv,
  stdout: { write(text: string): unknown },
  options: Omit<WaitOptions, 'env'> = {},
): Promise<number> {
  try {
    const event: unknown = JSON.parse(input ?? '');
    if (!agent || (event as { hook_event_name?: unknown } | null)?.hook_event_name !== 'PermissionRequest') return 0;
    const decision = await waitForAnswer(agent, event, { ...options, env });
    if (decision) {
      const message = decision.behavior === 'deny' ? (decision.message ?? 'Denied from genaicode.') : undefined;
      stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: decision.behavior, ...(message ? { message } : {}) },
          },
        })}\n`,
      );
    }
  } catch {
    // The agent's own dialog still decides.
  }
  return 0;
}
