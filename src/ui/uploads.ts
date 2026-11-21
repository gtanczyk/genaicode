import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

/** A file the user sent from the browser, kept in the project for the agent to read. */
export interface Upload {
  /** Unguessable; what the page sends back with the prompt. */
  id: string;
  name: string;
  size: number;
  /** Absolute path of the kept file. */
  path: string;
}

/** Where `genaicode ui` keeps what the user attaches. */
export interface Uploads {
  /** Keeps `body` under a new id. Rejects a body over `MAX_UPLOAD_BYTES`. */
  save(name: string, body: Buffer): Upload;
  find(id: string): Upload | undefined;
  /** The bytes of an uploaded image a page can show (`type` is its MIME type); undefined for anything else. */
  image(id: string): { type: string; body: Buffer } | undefined;
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Raster images only: an SVG served from this origin could run script. */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const ID = /^[0-9a-f]{16}$/;

/**
 * Uploads kept in `dir` under `cwd` (default `.genaicode/uploads`): inside the project, so an
 * agent confined to it can read them, owner-only and out of git.
 */
export function createUploads(cwd: string, dir = join('.genaicode', 'uploads')): Uploads {
  const folder = resolve(cwd, dir);
  const find = (id: string): Upload | undefined => {
    if (!ID.test(id) || !existsSync(folder)) return undefined;
    const file = readdirSync(folder).find((entry) => entry.startsWith(`${id}-`));
    if (!file) return undefined;
    const path = join(folder, file);
    return { id, name: file.slice(id.length + 1), size: statSync(path).size, path };
  };
  return {
    save(name, body) {
      if (body.length > MAX_UPLOAD_BYTES) throw new Error('The file is too large.');
      // What users attach can be private: owner-only, and never committed.
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const ignore = join(folder, '.gitignore');
      if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
      const kept =
        basename(name.replace(/\\/g, '/'))
          .replace(/[^\w.\- ]/g, '_')
          .replace(/^\.+/, '')
          .slice(-80) || 'file';
      const id = randomBytes(8).toString('hex');
      const path = join(folder, `${id}-${kept}`);
      writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
      return { id, name: kept, size: body.length, path };
    },
    find,
    image(id) {
      const found = find(id);
      const type = found && IMAGE_TYPES[extname(found.name).toLowerCase()];
      return found && type ? { type, body: readFileSync(found.path) } : undefined;
    },
  };
}
