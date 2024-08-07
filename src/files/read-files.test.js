import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import mime from 'mime-types';
import sizeOf from 'image-size';
import { getSourceCode, getImageAssets } from './read-files.js';
import { getSourceFiles, getImageAssetFiles } from './find-files.js';
import { verifySourceCodeLimit } from '../prompt/limits.js';
import * as cliParams from '../cli/cli-params.js';
import { rcConfig } from '../main/config.js';

vi.mock('fs');
vi.mock('mime-types');
vi.mock('image-size');
vi.mock('./find-files.js', () => ({
  getImageAssetFiles: vi.fn(),
  getSourceFiles: vi.fn(),
}));
vi.mock('../prompt/limits.js');
vi.mock('../cli/cli-params.js', () => ({
  taskFile: null,
  contentMask: null,
}));
vi.mock('../main/config.js', () => ({
  rcConfig: { rootDir: '/home/project' },
}));

describe('read-files', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).contentMask = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getSourceCode', () => {
    it('should return source code for all files', () => {
      const mockFiles = ['/home/project/file1.js', '/home/project/file2.js'];
      getSourceFiles.mockReturnValue(mockFiles);
      fs.readFileSync.mockImplementation((file) => `Content of ${file}`);
      rcConfig.rootDir = '/home/project';

      const result = getSourceCode();

      expect(result).toEqual({
        '/home/project/file1.js': { content: 'Content of /home/project/file1.js' },
        '/home/project/file2.js': { content: 'Content of /home/project/file2.js' },
      });
      expect(verifySourceCodeLimit).toHaveBeenCalled();
    });

    it('should apply content mask when specified', () => {
      const mockFiles = ['/home/project/file1.js', '/home/project/subfolder/file2.js'];
      getSourceFiles.mockReturnValue(mockFiles);
      fs.readFileSync.mockImplementation((file) => `Content of ${file}`);
      rcConfig.rootDir = '/home/project';
      vi.mocked(cliParams).contentMask = 'subfolder';

      const result = getSourceCode();

      expect(result).toEqual({
        '/home/project/file1.js': { content: null },
        '/home/project/subfolder/file2.js': {
          content: 'Content of /home/project/subfolder/file2.js',
        },
      });
    });

    it('should include task file when specified', () => {
      const mockFiles = ['/home/project/file1.js'];
      getSourceFiles.mockReturnValue(mockFiles);
      fs.readFileSync.mockImplementation((file) => `Content of ${file}`);
      rcConfig.rootDir = '/home/project';
      vi.mocked(cliParams).taskFile = '/home/project/task.md';

      const result = getSourceCode();

      expect(result).toEqual({
        '/home/project/file1.js': { content: 'Content of /home/project/file1.js' },
        '/home/project/task.md': { content: 'Content of /home/project/task.md' },
      });
    });
  });

  describe('getImageAssets', () => {
    it('should return image assets information', () => {
      const mockImageFiles = ['/home/project/image1.png', '/home/project/image2.jpg'];
      getImageAssetFiles.mockReturnValue(mockImageFiles);
      mime.lookup.mockImplementation((file) => (file.endsWith('.png') ? 'image/png' : 'image/jpeg'));
      sizeOf.mockImplementation(() => ({ width: 100, height: 200 }));

      const result = getImageAssets();

      expect(result).toEqual({
        '/home/project/image1.png': { mimeType: 'image/png', width: 100, height: 200 },
        '/home/project/image2.jpg': { mimeType: 'image/jpeg', width: 100, height: 200 },
      });
      expect(verifySourceCodeLimit).toHaveBeenCalled();
    });
  });
});
