import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('reads a file under the project by absolute or relative path and detects kind', () => {
    const cwd = project();
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'a.ts'), 'one\ntwo\n');
    writeFileSync(join(cwd, 'README.md'), '# Hello\n');
    writeFileSync(join(cwd, 'page.html'), '<h1>Hi</h1>');
    writeFileSync(join(cwd, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    writeFileSync(join(cwd, 'beep.mp3'), Buffer.from([0x49, 0x44, 0x33, 0x00]));
    writeFileSync(join(cwd, 'clip.webm'), Buffer.from('0123456789'));
    writeFileSync(join(cwd, 'doc.pdf'), Buffer.from('%PDF-1.4\n'));
    writeFileSync(join(cwd, 'bin'), Buffer.from([1, 0, 2]));
    const files = createProjectFiles(cwd);

    const view = {
      path: 'src/a.ts',
      kind: 'text',
      mimeType: 'text/plain; charset=utf-8',
      size: 8,
      text: 'one\ntwo\n',
      truncated: false,
    };
    expect(files.read(join(cwd, 'src', 'a.ts'))).toEqual(view);
    expect(files.read('src/a.ts')).toEqual(view);
    expect(files.read('README.md')).toEqual({
      path: 'README.md',
      kind: 'markdown',
      mimeType: 'text/markdown; charset=utf-8',
      size: 8,
      text: '# Hello\n',
      truncated: false,
    });
    expect(files.read('page.html')).toEqual({
      path: 'page.html',
      kind: 'html',
      mimeType: 'text/html; charset=utf-8',
      size: 11,
      text: '<h1>Hi</h1>',
      truncated: false,
    });
    expect(files.read('shot.png')).toEqual({ path: 'shot.png', kind: 'image', mimeType: 'image/png', size: 6 });
    expect(files.read('beep.mp3')).toEqual({ path: 'beep.mp3', kind: 'audio', mimeType: 'audio/mpeg', size: 4 });
    expect(files.read('clip.webm')).toEqual({ path: 'clip.webm', kind: 'video', mimeType: 'video/webm', size: 10 });
    expect(files.read('doc.pdf')).toEqual({ path: 'doc.pdf', kind: 'pdf', mimeType: 'application/pdf', size: 9 });
    expect(files.read('bin')).toEqual({ path: 'bin', kind: 'other', mimeType: 'application/octet-stream', size: 3 });
  });

  it('refuses what is outside every root, symlinks escaping roots, and secret files/directories', () => {
    const outside = project();
    writeFileSync(join(outside, 'secret'), 'no');
    const cwd = project();
    mkdirSync(join(cwd, '.git'), { recursive: true });
    mkdirSync(join(cwd, '.ssh'), { recursive: true });
    writeFileSync(join(cwd, '.env'), 'KEY=1');
    writeFileSync(join(cwd, '.env.local'), 'KEY=2');
    writeFileSync(join(cwd, 'server.pem'), 'pem');
    writeFileSync(join(cwd, '.git', 'config'), '[core]');
    writeFileSync(join(cwd, '.ssh', 'id_rsa'), 'key');
    const files = createProjectFiles(cwd);

    expect(files.read(join(outside, 'secret'))).toBe('outside');
    expect(files.read(`../${outside.split(/[\\/]/).pop()}/secret`)).toBe('outside');
    if (process.platform !== 'win32') {
      symlinkSync(join(outside, 'secret'), join(cwd, 'link'));
      expect(files.read('link')).toBe('outside');
    }
    expect(files.read('.env')).toBe('secret');
    expect(files.read('.env.local')).toBe('secret');
    expect(files.read('server.pem')).toBe('secret');
    expect(files.read('.git/config')).toBe('secret');
    expect(files.read('.ssh/id_rsa')).toBe('secret');
    expect(files.read('')).toBe('missing');
    expect(files.read('.')).toBe('outside');
    expect(files.read('nope.txt')).toBe('missing');
  });

  it('resolves across multiple dynamic roots in order and handles pack worktrees inside .genaicode', () => {
    const primary = project();
    const secondary = project();
    const worktree = join(primary, '.genaicode', 'worktrees', 't1');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(primary, 'shared.txt'), 'primary');
    writeFileSync(join(secondary, 'shared.txt'), 'secondary');
    writeFileSync(join(secondary, 'only-b.txt'), 'from b');
    writeFileSync(join(worktree, 'task.ts'), 'export const x = 1;');
    writeFileSync(join(worktree, '.env'), 'NO=1');

    let allowed = [primary];
    const files = createProjectFiles(() => allowed);
    expect(files.read(join(secondary, 'only-b.txt'))).toBe('outside');

    allowed = [primary, secondary, worktree];
    // Relative resolves against first root first, then other roots in order.
    expect(files.read('shared.txt')).toMatchObject({ path: 'shared.txt', text: 'primary' });
    expect(files.read('only-b.txt')).toMatchObject({ path: 'only-b.txt', text: 'from b' });
    expect(files.read(join(secondary, 'shared.txt'))).toMatchObject({ path: 'shared.txt', text: 'secondary' });
    // Worktree under .genaicode/worktrees/t1 resolves cleanly relative to the worktree root,
    // while secret files inside that worktree remain refused.
    expect(files.read(join(worktree, 'task.ts'))).toMatchObject({ path: 'task.ts', text: 'export const x = 1;' });
    expect(files.read(join(worktree, '.env'))).toBe('secret');
  });

  it('shows no folder or FIFO and truncates long text files at MAX_FILE_VIEW_BYTES', () => {
    const cwd = project();
    mkdirSync(join(cwd, 'dir'));
    writeFileSync(join(cwd, 'long'), 'x'.repeat(MAX_FILE_VIEW_BYTES + 5));
    const files = createProjectFiles(cwd);
    expect(files.read('dir')).toBe('directory');
    expect(files.capability('dir')).toBeUndefined();
    if (process.platform !== 'win32') {
      // A pipe nobody writes to: reading it must not wait.
      execFileSync('mkfifo', [join(cwd, 'pipe')]);
      expect(files.read('pipe')).toBe('missing');
    }
    const long = files.read('long');
    expect(long).toMatchObject({ kind: 'text', size: MAX_FILE_VIEW_BYTES + 5, truncated: true });
    expect(typeof long === 'object' && long.text?.length).toBe(MAX_FILE_VIEW_BYTES);
  });

  it('mints capability URLs that expire and re-verify the file on every lookup', () => {
    const cwd = project();
    writeFileSync(join(cwd, 'img.png'), Buffer.from([1, 2, 3]));
    writeFileSync(join(cwd, 'note.txt'), 'hi');
    let clock = 1_000;
    const files = createProjectFiles(cwd, { capabilityTtlMs: 500, now: () => clock });

    // onlyKind restricts to image files only.
    expect(files.capability('note.txt', { onlyKind: 'image' })).toBeUndefined();
    const cap = files.capability('img.png', { onlyKind: 'image' });
    expect(cap).toBeDefined();
    expect(files.fromCapability(cap!.id)?.path).toBe('img.png');

    // Sliding expiration: advances clock past TTL -> expired.
    clock += 600;
    expect(files.fromCapability(cap!.id)).toBeUndefined();

    // Re-minting and deleting the file -> lookup returns undefined even before expiry.
    const cap2 = files.capability('img.png');
    expect(cap2).toBeDefined();
    unlinkSync(join(cwd, 'img.png'));
    expect(files.fromCapability(cap2!.id)).toBeUndefined();
  });

  it('serves /api/file, /api/file/raw, /files/<id>, /api/file/images, /api/reveal and /api/settings', async () => {
    const cwd = project();
    const outside = project();
    writeFileSync(join(cwd, 'a.txt'), 'hello');
    writeFileSync(join(cwd, 'demo.webm'), Buffer.from('0123456789'));
    writeFileSync(join(cwd, 'page.html'), '<h1>Page</h1>');
    writeFileSync(join(cwd, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(cwd, '.env'), 'SECRET=1');
    writeFileSync(join(outside, 'other.txt'), 'outside text');

    const revealed: string[] = [];
    const saved: Array<{ artifactCdn: readonly string[] }> = [];
    let cdnHosts: readonly string[] = [];
    const agent = { name: 'echo', command: process.execPath, capabilities: {}, run: () => undefined as never };
    const controller = createChatController({ agents: [agent], cwd, env: {} });
    const ui = await startWebUi({
      controller,
      clientScript: '',
      title: { version: '1', cwd },
      token: 't0k',
      files: createProjectFiles(cwd),
      hostApp: {
        update: () => undefined,
        subscribe: () => () => {},
        relaunch: vi.fn(),
        reveal: (p) => revealed.push(p),
        saveSettings: (s) => saved.push(s),
      },
      settings: {
        artifactCdn: () => cdnHosts,
        setArtifactCdn: (next) => {
          cdnHosts = next;
        },
      },
    });
    const base = ui.url.replace(/\/\?.*$/, '');
    const get = (path: string, token = 't0k') =>
      fetch(`${base}/api/file?path=${encodeURIComponent(path)}`, { headers: { 'x-genaicode-token': token } });
    try {
      expect((await get('a.txt', 'bad')).status).toBe(403);
      const res = await get(join(cwd, 'a.txt'));
      expect(res.status).toBe(200);
      const json = (await res.json()) as { path: string; kind: string; rawUrl: string; text: string; size: number };
      expect(json).toMatchObject({
        path: 'a.txt',
        kind: 'text',
        mimeType: 'text/plain; charset=utf-8',
        size: 5,
        text: 'hello',
        truncated: false,
      });
      expect(json.rawUrl).toMatch(/^\/files\/[0-9a-f]{32}$/);

      // Secret file and outside file both refuse with 403.
      expect((await get('.env')).status).toBe(403);
      expect((await get('/etc/hosts')).status).toBe(403);
      expect((await get('gone')).status).toBe(404);

      // Capability URL works without session token, supports Range and download=1.
      const videoMeta = (await (await get('demo.webm')).json()) as { rawUrl: string };
      const rangeRes = await fetch(`${base}${videoMeta.rawUrl}`, { headers: { range: 'bytes=2-5' } });
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get('content-range')).toBe('bytes 2-5/10');
      expect(rangeRes.headers.get('content-security-policy')).toContain("media-src 'self'");
      expect(await rangeRes.text()).toBe('2345');
      expect((await fetch(`${base}${videoMeta.rawUrl}`, { headers: { range: 'bytes=50-' } })).status).toBe(416);

      // GET /api/file/raw requires token and sends shared CSP headers.
      expect((await fetch(`${base}/api/file/raw?path=page.html`)).status).toBe(403);
      const htmlRaw = await fetch(`${base}/api/file/raw?path=page.html`, { headers: { 'x-genaicode-token': 't0k' } });
      expect(htmlRaw.status).toBe(200);
      expect(htmlRaw.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
      expect(htmlRaw.headers.get('content-disposition')).toBe('inline; filename="page.html"');
      const htmlDl = await fetch(`${base}/api/file/raw?path=page.html&download=1`, {
        headers: { 'x-genaicode-token': 't0k' },
      });
      expect(htmlDl.headers.get('content-disposition')).toBe('attachment; filename="page.html"');

      // POST /api/file/images mints capability URLs ONLY for image kinds.
      const imgsRes = await fetch(`${base}/api/file/images`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': 't0k' },
        body: JSON.stringify({ paths: ['pic.png', 'a.txt', '.env', join(outside, 'other.txt')] }),
      });
      expect(imgsRes.status).toBe(200);
      const imgs = (await imgsRes.json()) as { urls: Record<string, string> };
      expect(Object.keys(imgs.urls)).toEqual(['pic.png']);
      expect(imgs.urls['pic.png']).toMatch(/^\/files\/[0-9a-f]{32}$/);

      // POST /api/reveal allows in-root and existing outside files, refuses secrets & missing.
      const reveal = (path: string, tok = 't0k') =>
        fetch(`${base}/api/reveal`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-genaicode-token': tok },
          body: JSON.stringify({ path }),
        });
      expect((await reveal('a.txt', 'bad')).status).toBe(403);
      expect((await reveal('a.txt')).status).toBe(200);
      expect((await reveal(join(outside, 'other.txt'))).status).toBe(200);
      expect((await reveal('.env')).status).toBe(403);
      expect((await reveal('missing.txt')).status).toBe(404);
      expect(revealed).toHaveLength(2);

      // POST /api/settings validates hosts, updates live HTML CSP, and persists through hostApp.
      const badSettings = await fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': 't0k' },
        body: JSON.stringify({ artifactCdn: ['*'] }),
      });
      expect(badSettings.status).toBe(400);
      const okSettings = await fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': 't0k' },
        body: JSON.stringify({ artifactCdn: ['cdn.jsdelivr.net', 'unpkg.com'] }),
      });
      expect(okSettings.status).toBe(200);
      expect(saved).toEqual([{ artifactCdn: ['https://cdn.jsdelivr.net', 'https://unpkg.com'] }]);
      const htmlWithCdn = await fetch(`${base}/api/file/raw?path=page.html`, {
        headers: { 'x-genaicode-token': 't0k' },
      });
      expect(htmlWithCdn.headers.get('content-security-policy')).toContain(
        "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
      );
    } finally {
      await ui.close();
      controller.close();
    }
  });

  it('follows dynamic conversation roots when given a function', () => {
    const first = project();
    const second = project();
    writeFileSync(join(first, 'a.txt'), 'from first');
    writeFileSync(join(second, 'b.txt'), 'from second');
    let current = first;
    const files = createProjectFiles(() => current);
    expect(files.read('a.txt')).toMatchObject({ path: 'a.txt', text: 'from first' });
    expect(files.read(join(second, 'b.txt'))).toBe('outside');
    current = second;
    expect(files.read('b.txt')).toMatchObject({ path: 'b.txt', text: 'from second' });
    expect(files.read(join(first, 'a.txt'))).toBe('outside');
  });
});
