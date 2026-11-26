import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { genaicodeHomeDir } from '../agents/sessions/workspace.js';
import type { SavedPackTask } from '../agents/pack.js';
import type { SessionState } from '../agents/session.js';
import type { ChatSummary } from './hub.js';
import type { ConversationMeta } from './controller.js';

export interface SavedChat {
  conversation: ConversationMeta;
  session: Pick<
    SessionState,
    'agent' | 'cwd' | 'model' | 'effort' | 'mode' | 'usage' | 'costUsd' | 'turns' | 'sessionId' | 'truncatedReason'
  >;
  packs: Record<string, SavedPackTask[]>;
  interrupted: boolean;
  drafts?: string[];
}

export function chatStore(env: NodeJS.ProcessEnv, cwd: string, home: boolean) {
  const workspace = createHash('sha256')
    .update(JSON.stringify([home, cwd]))
    .digest('hex');
  const dir = join(genaicodeHomeDir(env), 'ui-chats', workspace);
  const valid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
  // Queue atomic replacements in submission order. Capture the snapshot before the next turn changes it.
  const writes = new Map<string, Promise<void>>();
  const write = (name: string, data: unknown) => {
    const json = JSON.stringify(data);
    const work = (writes.get(name) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const file = join(dir, name);
        const tmp = file + '.' + randomUUID() + '.tmp';
        await writeFile(tmp, json, { mode: 0o600 });
        await rename(tmp, file);
      });
    writes.set(name, work);
    return work.finally(() => {
      if (writes.get(name) === work) writes.delete(name);
    });
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
    saveIndex: (ids: string[], shown: string, chats: ChatSummary[]) => write('ui-chats.json', { ids, shown, chats }),
    async index(): Promise<{ ids: string[]; shown: string; chats?: ChatSummary[] } | undefined> {
      try {
        const data = JSON.parse(await readFile(join(dir, 'ui-chats.json'), 'utf8'));
        if (
          valid(data.shown) &&
          Array.isArray(data.ids) &&
          data.ids.every(valid) &&
          (data.ids.includes(data.shown) || data.chats?.some((row: ChatSummary) => row?.chat === data.shown))
        )
          return data;
      } catch {
        /* Older installations have only the native session stores. */
      }
    },
  };
}
