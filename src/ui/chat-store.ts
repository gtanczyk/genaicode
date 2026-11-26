import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { genaicodeHomeDir } from '../agents/sessions/workspace.js';
import type { SavedPackTask } from '../agents/pack.js';
import type { SessionState } from '../agents/session.js';
import type { ConversationMeta } from './controller.js';

export interface SavedChat {
  conversation: ConversationMeta;
  session: Pick<
    SessionState,
    'agent' | 'cwd' | 'model' | 'effort' | 'mode' | 'usage' | 'costUsd' | 'turns' | 'sessionId' | 'truncatedReason'
  >;
  packs: Record<string, SavedPackTask[]>;
  interrupted: boolean;
}

export function chatStore(env: NodeJS.ProcessEnv, cwd: string, home: boolean) {
  const workspace = createHash('sha256')
    .update(JSON.stringify([home, cwd]))
    .digest('hex');
  const dir = join(genaicodeHomeDir(env), 'ui-chats', workspace);
  const valid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
  const write = async (name: string, data: unknown) => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, name);
    const tmp = file + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, file);
  };
  return {
    async read(id: string): Promise<SavedChat | undefined> {
      if (!valid(id)) return;
      try {
        const data = JSON.parse(await readFile(join(dir, id + '.json'), 'utf8')) as SavedChat;
        if (data.conversation?.id === id && Array.isArray(data.session?.turns) && data.packs) return data;
      } catch {
        /* A missing record cannot be reopened. */
      }
    },
    save: (data: SavedChat) => write(data.conversation.id + '.json', data),
    saveIndex: (ids: string[], shown: string) => write('ui-chats.json', { ids, shown }),
    async index(): Promise<{ ids: string[]; shown: string } | undefined> {
      try {
        const data = JSON.parse(await readFile(join(dir, 'ui-chats.json'), 'utf8'));
        if (valid(data.shown) && Array.isArray(data.ids) && data.ids.every(valid) && data.ids.includes(data.shown))
          return data;
      } catch {
        /* Older installations have only the native session stores. */
      }
    },
  };
}
