import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createChatController } from './controller.js';
import { createProjectFiles, MAX_FILE_VIEW_BYTES } from './files.js';
import { startWebUi } from './web/server.js';

// Under the repository: a project in a temporary directory is somebody's scratch work.
const roots: string[] = [];
const project = () => {
  const root = mkdtempSync(join(process.cwd(), 'node_modules', '.genaicode-files-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('project files shown in the page', () => {
  it('reads a file under the project by absolute or relative path', () => {
    const cwd = project();
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'a.ts'), 'one\ntwo\n');
    const files = createProjectFiles(cwd);
    const view = { path: 'src/a.ts', size: 8, text: 'one\ntwo\n', truncated: false };
    expect(files.read(join(cwd, 'src', 'a.ts'))).toEqual(view);
    expect(files.read('src/a.ts')).toEqual(view);
  });

  it('refuses what is outside the project, also through a link or dots', () => {
    const outside = project();
    writeFileSync(join(outside, 'secret'), 'no');
    const cwd = project();
    const files = createProjectFiles(cwd);
    expect(files.read(join(outside, 'secret'))).toBe('outside');
    expect(files.read(`../${outside.split(/[\\/]/).pop()}/secret`)).toBe('outside');
    if (process.platform !== 'win32') {
      symlinkSync(join(outside, 'secret'), join(cwd, 'link'));
      expect(files.read('link')).toBe('outside');
    }
    expect(files.read('')).toBe('missing');
    expect(files.read('.')).toBe('outside');
    expect(files.read('nope.txt')).toBe('missing');
  });

  it('shows no folder and no binary file, and only the start of a long one', () => {
    const cwd = project();
    mkdirSync(join(cwd, 'dir'));
    writeFileSync(join(cwd, 'bin'), Buffer.from([1, 0, 2]));
    writeFileSync(join(cwd, 'long'), 'x'.repeat(MAX_FILE_VIEW_BYTES + 5));
    const files = createProjectFiles(cwd);
    expect(files.read('dir')).toBe('missing');
    if (process.platform !== 'win32') {
      // A pipe nobody writes to: reading it must not wait.
      execFileSync('mkfifo', [join(cwd, 'pipe')]);
      expect(files.read('pipe')).toBe('missing');
    }
    expect(files.read('bin')).toBe('binary');
    const long = files.read('long');
    expect(long).toMatchObject({ size: MAX_FILE_VIEW_BYTES + 5, truncated: true });
    expect(typeof long === 'object' && long.text.length).toBe(MAX_FILE_VIEW_BYTES);
  });

  it('is served to the page with the token only', async () => {
    const cwd = project();
    writeFileSync(join(cwd, 'a.txt'), 'hello');
    const agent = { name: 'echo', command: process.execPath, capabilities: {}, run: () => undefined as never };
    const controller = createChatController({ agents: [agent], cwd, env: {} });
    const ui = await startWebUi({
      controller,
      clientScript: '',
      title: { version: '1', cwd },
      token: 't0k',
      files: createProjectFiles(cwd),
    });
    const base = ui.url.replace(/\/\?.*$/, '');
    const get = (path: string, token = 't0k') =>
      fetch(`${base}/api/file?path=${encodeURIComponent(path)}`, { headers: { 'x-genaicode-token': token } });
    try {
      expect((await get('a.txt', 'bad')).status).toBe(403);
      const res = await get(join(cwd, 'a.txt'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ path: 'a.txt', size: 5, text: 'hello', truncated: false });
      expect((await get('/etc/hosts')).status).toBe(403);
      expect((await get('gone')).status).toBe(404);
    } finally {
      await ui.close();
      controller.close();
    }
  });
});
