import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
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
 * so the page shows what the agent works on and nothing else on the machine. Pass a function when
 * the working directory changes per conversation (`ui --home`).
 */
export function createProjectFiles(cwd: string | (() => string | readonly string[])): ProjectFiles {
  return {
    read(path) {
      if (!path || path.includes('\0')) return 'missing';
      const raw = typeof cwd === 'function' ? cwd() : cwd;
      const list = (Array.isArray(raw) ? raw : [raw]).filter((dir): dir is string => typeof dir === 'string' && !!dir);
      if (!list.length) return 'outside';
      const roots: string[] = [];
      for (const dir of list) {
        try {
          roots.push(realpathSync(dir));
        } catch {
          // A root that is gone allows nothing.
        }
      }
      if (!roots.length) return 'missing';
      let real: string;
      try {
        // Links are followed first, so what is checked is the file that would be read.
        real = realpathSync(resolve(roots[0]!, path));
      } catch {
        return 'missing';
      }
      let inside: string | undefined;
      for (const root of roots) {
        const rel = relative(root, real);
        if (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
          inside = rel;
          break;
        }
      }
      if (!inside) return 'outside';
      let descriptor: number;
      try {
        // A pipe would hold the open (and the whole server) until someone writes to it.
        if (!statSync(real).isFile()) return 'missing';
        descriptor = openSync(real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      } catch {
        return 'missing';
      }
      try {
        // Asked of what was opened: the path can be something else by now.
        const stat = fstatSync(descriptor);
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
