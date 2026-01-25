import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import mock from 'mock-fs';
import fs from 'fs';
import path from 'path';
import tar from 'tar-stream';
import { Readable } from 'stream';
import { extractTarStreamToDirectory } from './docker-utils.js';

describe('extractTarStreamToDirectory', () => {
  const destPath = '/test-output';

  beforeEach(() => {
    mock({
      [destPath]: {}, // The destination directory
    });
  });

  afterEach(() => {
    mock.restore();
  });

  const createTarStream = (files: { name: string; content: string }[]): Readable => {
    const pack = tar.pack();
    for (const file of files) {
      pack.entry({ name: file.name }, file.content);
    }
    pack.finalize();
    return pack;
  };

  test('should extract a single file correctly', async () => {
    const files = [{ name: 'file.txt', content: 'hello world' }];
    const tarStream = createTarStream(files);
    const validator = () => true;

    await extractTarStreamToDirectory(tarStream, destPath, validator);

    const extractedContent = fs.readFileSync(path.join(destPath, 'file.txt'), 'utf-8');
    expect(extractedContent).toBe('hello world');
  });

  test('should extract a nested directory structure', async () => {
    const files = [
      { name: 'root.txt', content: 'root file' },
      { name: 'nested/file.txt', content: 'nested file' },
    ];
    const tarStream = createTarStream(files);
    const validator = () => true;

    await extractTarStreamToDirectory(tarStream, destPath, validator);

    const rootContent = fs.readFileSync(path.join(destPath, 'root.txt'), 'utf-8');
    expect(rootContent).toBe('root file');

    const nestedContent = fs.readFileSync(path.join(destPath, 'nested/file.txt'), 'utf-8');
    expect(nestedContent).toBe('nested file');
    expect(fs.existsSync(path.join(destPath, 'nested'))).toBe(true);
  });

  test('should prevent directory traversal (zip-slip)', async () => {
    const files = [{ name: '../../malicious.txt', content: 'pwned' }];
    const tarStream = createTarStream(files);
    const validator = (filePath: string) => filePath.startsWith(destPath);

    await expect(extractTarStreamToDirectory(tarStream, destPath, validator)).rejects.toThrow(
      'Refusing to write outside project root: /malicious.txt',
    );

    // Verify the malicious file was not created
    expect(fs.existsSync('/malicious.txt')).toBe(false);
  });

  test('should handle stream errors gracefully', async () => {
    const errorStream = new Readable({
      read() {
        this.destroy(new Error('Stream read error'));
      },
    });
    const validator = () => true;

    await expect(extractTarStreamToDirectory(errorStream, destPath, validator)).rejects.toThrow('Stream read error');
  });

  test('should create directories as needed', async () => {
    // tar-stream can have directory entries explicitly
    const pack = tar.pack();
    pack.entry({ name: 'new-dir/', type: 'directory' });
    pack.entry({ name: 'new-dir/another-dir/file.txt', type: 'file' }, 'content');
    pack.finalize();

    const validator = () => true;
    await extractTarStreamToDirectory(pack, destPath, validator);

    expect(fs.statSync(path.join(destPath, 'new-dir')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(destPath, 'new-dir/another-dir')).isDirectory()).toBe(true);
    const content = fs.readFileSync(path.join(destPath, 'new-dir/another-dir/file.txt'), 'utf-8');
    expect(content).toBe('content');
  });
});
