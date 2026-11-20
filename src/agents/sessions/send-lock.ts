import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { liveDir } from './live.js';

/** Publish a nonempty directory atomically. A second tower cannot claim it until the turn ends. */
export function claimSession(source: string, id: string, env?: NodeJS.ProcessEnv): (() => void) | undefined {
  const root = join(dirname(liveDir(env)), 'sending');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const key = createHash('sha256')
    .update(JSON.stringify([source, id]))
    .digest('hex');
  const lock = join(root, key);
  const staging = mkdtempSync(join(root, '.claim-'));
  const owner = `${process.pid}-${randomUUID()}`;
  const claim = () => {
    try {
      renameSync(staging, lock);
      return true;
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
      throw error;
    }
  };
  try {
    writeFileSync(join(staging, owner), '', { mode: 0o600 });
    if (!claim()) {
      // Recover only the exact marker left by a crashed process. A new owner has a different name.
      let previous: string | undefined;
      try {
        [previous] = readdirSync(lock);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (previous) {
        const pid = Number(previous.split('-')[0]);
        if (!Number.isSafeInteger(pid) || pid <= 0 || alive(pid)) return undefined;
        rmSync(join(lock, previous), { force: true });
      }
      removeEmpty(lock);
      if (!claim()) return undefined;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return () => {
    rmSync(join(lock, owner), { force: true });
    removeEmpty(lock);
  };
}

function removeEmpty(dir: string): void {
  try {
    rmdirSync(dir);
  } catch (error) {
    // Another sender may already have claimed the empty directory or removed it.
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
