import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** A project file as the page shows it. */
export interface FileView {
  /** Relative to the project folder. */
  path: string;
  /** Size on disk, in bytes. */
  size: number;
  /** The start of the file, as text. */
  text: string;
  /** True when the file is longer than what `text` holds. */
  truncated: boolean;
}

/** Why a file is not shown. */
export type FileRefusal = 'outside' | 'missing' | 'binary';

/** Reads project files for `genaicode ui` to show. */
export interface ProjectFiles {
  read(path: string): FileView | FileRefusal;
}

export const MAX_FILE_VIEW_BYTES = 512 * 1024;

/**
 * Files under `cwd` only: a path that leaves it, or a link inside it that points out, is refused,
 * so the page shows what the agent works on and nothing else on the machine.
 */
export function createProjectFiles(cwd: string): ProjectFiles {
  return {
    read(path) {
      if (!path || path.includes('\0')) return 'missing';
      let root: string;
      let real: string;
      try {
        root = realpathSync(cwd);
        // Links are followed first, so what is checked is the file that would be read.
        real = realpathSync(resolve(cwd, path));
      } catch {
        return 'missing';
      }
      const inside = relative(root, real);
      if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return 'outside';
      let descriptor: number;
      try {
        descriptor = openSync(real, 'r');
      } catch {
        return 'missing';
      }
      try {
        const stat = statSync(real);
        if (!stat.isFile()) return 'missing';
        const body = Buffer.alloc(Math.min(stat.size, MAX_FILE_VIEW_BYTES));
        const read = readSync(descriptor, body, 0, body.length, 0);
        const shown = body.subarray(0, read);
        if (shown.includes(0)) return 'binary';
        return {
          path: inside.split(sep).join('/'),
          size: stat.size,
          text: shown.toString('utf8'),
          truncated: stat.size > read,
        };
      } catch {
        return 'missing';
      } finally {
        closeSync(descriptor);
      }
    },
  };
}
