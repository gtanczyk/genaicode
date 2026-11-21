import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createChatController } from './controller.js';
import { splitAttached, withAttached } from './format.js';
import { createUploads, MAX_UPLOAD_BYTES } from './uploads.js';
import { startWebUi } from './web/server.js';

// Under the repository: a project in a temporary directory is somebody's scratch work.
const roots: string[] = [];
const project = () => {
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-uploads-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('files sent with a prompt', () => {
  it('are kept in the project, owner-only and out of git, under a name that cannot leave the folder', () => {
    const cwd = project();
    const uploads = createUploads(cwd);
    const kept = uploads.save('../../.ssh/id rsa?.PNG', Buffer.from('png'));
    expect(kept.path).toBe(join(cwd, '.genaicode', 'uploads', `${kept.id}-id rsa_.PNG`));
    expect(readFileSync(kept.path, 'utf8')).toBe('png');
    if (process.platform !== 'win32') expect(statSync(kept.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(cwd, '.genaicode', 'uploads', '.gitignore'), 'utf8')).toBe('*\n');
    expect(uploads.find(kept.id)).toEqual(kept);
    expect(uploads.find('../x')).toBeUndefined();
    expect(uploads.find('0'.repeat(16))).toBeUndefined();
    // Only raster images are shown back to the page.
    expect(uploads.image(kept.id)).toEqual({ type: 'image/png', body: Buffer.from('png') });
    expect(uploads.image(uploads.save('page.svg', Buffer.from('<svg/>')).id)).toBeUndefined();
    expect(uploads.save('...', Buffer.alloc(0)).name).toBe('file');
    expect(() => uploads.save('big', Buffer.alloc(MAX_UPLOAD_BYTES + 1))).toThrow('too large');
  });

  it('are named to the agent at the end of the prompt, and taken off it again for the bubble', () => {
    const id = 'ab'.repeat(8);
    const sent = withAttached(' Fix this \n', [`/w/.genaicode/uploads/${id}-shot.png`, 'C:\\w\\notes.txt']);
    expect(sent).toBe(
      `Fix this\n\nAttached files (read them from disk):\n- /w/.genaicode/uploads/${id}-shot.png\n- C:\\w\\notes.txt`,
    );
    expect(splitAttached(sent)).toEqual({
      text: 'Fix this',
      files: [
        { path: `/w/.genaicode/uploads/${id}-shot.png`, name: 'shot.png', id },
        { path: 'C:\\w\\notes.txt', name: 'notes.txt' },
      ],
    });
    expect(withAttached('hi', [])).toBe('hi');
    expect(splitAttached(withAttached('', ['/a/b.txt']))).toEqual({
      text: '',
      files: [{ path: '/a/b.txt', name: 'b.txt' }],
    });
    // Words that only look like it stay as typed.
    const typed = 'see\n\nAttached files (read them from disk):\nnone';
    expect(splitAttached(typed)).toEqual({ text: typed, files: [] });
  });

  it('are taken by the page server with the token, and go to the agent with the prompt', async () => {
    const cwd = project();
    const prompts: string[] = [];
    const agent = {
      name: 'echo',
      command: process.execPath,
      capabilities: {},
      run: (task: { prompt: string }) => {
        prompts.push(task.prompt);
        return undefined as never;
      },
    };
    const controller = createChatController({ agents: [agent], cwd, env: {} });
    const uploads = createUploads(cwd);
    const ui = await startWebUi({
      controller,
      clientScript: '',
      title: { version: '1', cwd },
      token: 't0k',
      uploads,
    });
    const base = ui.url.replace(/\/\?.*$/, '');
    const auth = { 'x-genaicode-token': 't0k' };
    const post = (body: unknown) =>
      fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      expect((await fetch(`${base}/api/upload?name=a.png`, { method: 'POST', body: 'x' })).status).toBe(403);
      const res = await fetch(`${base}/api/upload?name=a.png`, { method: 'POST', headers: auth, body: 'x' });
      expect(res.status).toBe(200);
      const kept = (await res.json()) as { id: string; name: string; size: number };
      expect(kept).toEqual({ id: expect.stringMatching(/^[0-9a-f]{16}$/), name: 'a.png', size: 1 });
      // The page shows the image without the token; nothing else is served from there.
      const image = await fetch(`${base}/uploads/${kept.id}`);
      expect(image.headers.get('content-type')).toBe('image/png');
      expect(image.headers.get('content-security-policy')).toContain('sandbox');
      expect((await fetch(`${base}/uploads/${'0'.repeat(16)}`)).status).toBe(404);
      const big = await fetch(`${base}/api/upload?name=big.bin`, {
        method: 'POST',
        headers: auth,
        body: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
      }).then(
        (reply) => reply.status,
        () => 413,
      );
      expect(big).toBe(413);

      expect((await post({ type: 'submit', text: 'look', files: ['nope'] })).status).toBe(400);
      expect((await post({ type: 'submit', text: 'look', files: 'a' })).status).toBe(400);
      // A command of the host's takes no files.
      expect((await post({ type: 'submit', text: '/help', files: [kept.id] })).status).toBe(200);
      expect(controller.get().notices.some((notice) => notice.text.includes('not with a command'))).toBe(true);
      expect(prompts).toEqual([]);
      expect((await post({ type: 'submit', text: 'look', files: [kept.id] })).status).toBe(200);
      expect(controller.get().session.turns.at(-1)?.prompt).toBe(withAttached('look', [uploads.find(kept.id)!.path]));
    } finally {
      await ui.close();
      controller.close();
    }
  });
});
