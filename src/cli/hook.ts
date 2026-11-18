import { recordHook } from '../agents/sessions/live.js';

/**
 * `genaicode hook <agent>`: what an agent's hook runs. Notes what the session is doing from the
 * hook's input on stdin and never gets in the agent's way: no output it would act on, exit 0.
 */
export async function runHook(
  agent: string | undefined,
  input: string | undefined,
  env: NodeJS.ProcessEnv,
  stdout: { write(text: string): unknown },
): Promise<number> {
  try {
    const event: unknown = JSON.parse(input ?? '');
    if (agent) await recordHook(agent, event, { env });
    // A `Stop` hook answers in JSON; an empty object decides nothing.
    const name = (event as { hook_event_name?: unknown } | null)?.hook_event_name;
    if (name === 'Stop') stdout.write('{}\n');
  } catch {
    // A hook that fails would show an error in the agent for nothing the user can act on.
  }
  return 0;
}
