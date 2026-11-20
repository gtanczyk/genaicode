import { fork } from 'node:child_process';
import type { SandboxPolicy } from '../agents/types.js';

export interface DetachedSend {
  id: string;
  prompt: string;
  agent?: string;
  sandbox?: SandboxPolicy;
}

/** The worker owns the entire turn, including its claim. It acknowledges the agent's first event. */
export async function detachSend(request: DetachedSend, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const child = fork(new URL('./send-worker.js', import.meta.url), [], {
    detached: true,
    stdio: 'ignore',
    execArgv: [],
    env,
  });
  const stop = () => {
    child.kill('SIGTERM');
  };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => reject(new Error('The background sender exited before the session started.')));
      child.once('message', (message: { ok: boolean; error?: string }) => {
        if (message.ok) resolve();
        else reject(new Error(message.error ?? 'The agent could not resume this session.'));
      });
      child.send(request, (error) => {
        if (error) reject(error);
      });
    });
    return child.pid!;
  } finally {
    signal?.removeEventListener('abort', stop);
    if (child.connected) child.disconnect();
    child.unref();
  }
}
