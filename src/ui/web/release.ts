import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeOf } from '../../agents/sessions/files.js';
import { compareVersions, installedReleaseNotes } from '../../cli/update.js';

export interface UiRelease {
  version: string;
  previous?: string;
  notes: string;
  announce: boolean;
}

/** A desktop server gets a new port on each launch. Keep its version beside the desktop settings. */
export function uiRelease(version: string, env: NodeJS.ProcessEnv, desktop: boolean): () => UiRelease {
  const dir = env.GENAICODE_HOME ?? join(homeOf(env), '.genaicode');
  const file = join(dir, 'desktop-version');
  let previous: string | undefined;
  if (desktop) {
    try {
      const saved = readFileSync(file, 'utf8').trim();
      if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(saved)) previous = saved;
    } catch {
      // First launch, including an upgrade from before the app remembered its version.
    }
  }
  const from = previous && compareVersions(previous, version) < 0 ? previous : undefined;
  const notes = installedReleaseNotes(version, from);
  let announce = desktop && previous !== version;
  // Called once a page connects. Reconnects and reloads can still open the same notes by hand.
  return () => {
    const release = { version, previous: from, notes, announce };
    if (announce) {
      announce = false;
      try {
        mkdirSync(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, version);
        renameSync(tmp, file);
      } catch {
        // A read-only home must not keep the app from opening.
      }
    }
    return release;
  };
}
