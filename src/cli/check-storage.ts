import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const testStorageMiB = 1024;

/** Linux mounts its bounded tmpfs inside bubblewrap. macOS mounts a private sparse image. */
export async function withTestStorage<T>(run: (scratch: string) => Promise<T>): Promise<T> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'genaicode-test-')));
  const mount = join(directory, 'volume');
  const image = join(directory, 'check.sparseimage');
  const parentDevice = (await stat(directory)).dev;
  const hdiutil = (args: string[]) =>
    exec('/usr/bin/hdiutil', args, { timeout: 60_000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
  const mounted = async () => (await stat(mount)).dev !== parentDevice;
  let mountReady = false;
  const detach = async () => {
    if (!mountReady || !(await mounted())) return;
    await hdiutil(['detach', '-quiet', mount]).catch(() => hdiutil(['detach', '-quiet', '-force', mount]));
    if (await mounted()) throw new Error('Unable to detach the private test volume at ' + mount);
  };
  try {
    if (process.platform !== 'darwin') return await run(directory);
    await mkdir(mount, { mode: 0o700 });
    mountReady = true;
    await hdiutil([
      'create',
      '-quiet',
      '-type',
      'SPARSE',
      '-size',
      testStorageMiB + 'm',
      '-fs',
      'Case-sensitive APFS',
      '-volname',
      'genaicode-test',
      image,
    ]);
    await hdiutil(['attach', '-quiet', '-nobrowse', '-noautoopen', '-mountpoint', mount, image]);
    if (!(await mounted())) throw new Error('The private test volume did not mount.');
    return await run(mount);
  } finally {
    await detach();
    await rm(directory, { recursive: true, force: true });
  }
}
