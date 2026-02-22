import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import mime from 'mime-types';
import sizeOf from 'image-size';
import { getSourceCode, getImageAssets } from './read-files.js';
import { getSourceFiles, getImageAssetFiles } from './find-files.js';
import { verifySourceCodeLimit } from '../prompt/limits.js';
import * as cliParams from '../cli/cli-params.js';
import { rcConfig } from '../main/config.js';
import { getSummary } from './summary-cache.js';
import { generateFileId } from './file-id-utils.js';

vi.mock('fs');
vi.mock('mime-types');
vi.mock('image-size');
vi.mock('./summary-cache.js');
vi.mock('./find-files.js', () => ({
  getImageAssetFiles: vi.fn(),
  getSourceFiles: vi.fn(),
}));
vi.mock('../prompt/limits.js');
vi.mock('../cli/cli-params.js', () => ({
  taskFile: null,
  contentMask: null,
  disableExplanations: true,
  ignorePatterns: [],
}));
vi.mock('../main/config.js', () => ({
  rcConfig: { rootDir: '/home/project' },
  importantContext: {},
  rcConfigSchemaFilePath: '/path/to/rcConfigSchema.json',
  modelOverrides: {},
}));

describe('read-files', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).contentMask = undefined;
    vi.mocked(getSummary).mockImplementation((file) => ({ summary: `Summary of ${file}` }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getSourceCode', () => {
    it('should return source code summaries for all files', () => {
      const mockFiles = ['/home/project/file1.js', '/home/project/file2.js'];
      vi.mocked(getSourceFiles).mockReturnValue(mockFiles);
      vi.mocked(fs).existsSync.mockReturnValue(true);
      vi.mocked(fs).readFileSync.mockImplementation((file) => `Content of ${file}`);
      rcConfig.rootDir = '/home/project';

      const result = getSourceCode({ taskFile: undefined }, { aiService: 'vertex-ai', askQuestion: false });

      expect(result).toEqual({
        '/home/project/file1.js': {
          fileId: generateFileId('/home/project/file1.js'),
          summary: 'Summary of /home/project/file1.js',
        },
        '/home/project/file2.js': {
          fileId: generateFileId('/home/project/file2.js'),
          summary: 'Summary of /home/project/file2.js',
        },
      });
      expect(verifySourceCodeLimit).toHaveBeenCalled();
    });

    it('should apply content mask when specified', () => {
      const mockFiles = ['/home/project/file1.js', '/home/project/subfolder/file2.js'];
      vi.mocked(getSourceFiles).mockReturnValue(mockFiles);
      vi.mocked(fs).existsSync.mockReturnValue(true);
      vi.mocked(fs).readFileSync.mockImplementation((file) => `Content of ${file}`);
      rcConfig.rootDir = '/home/project';

      const result = getSourceCode(
        { taskFile: undefined },
        { aiService: 'vertex-ai', contentMask: 'subfolder', askQuestion: false },
      );

      expect(result).toEqual({
        '/home/project/file1.js': {
          fileId: generateFileId('/home/project/file1.js'),
          summary: 'Summary of /home/project/file1.js',
        },
        '/home/project/subfolder/file2.js': {
          fileId: generateFileId('/home/project/subfolder/file2.js'),
          summary: 'Summary of /home/project/subfolder/file2.js',
        },
      });
    });

    it('should include task file when specified', () => {
      const mockFiles = ['/home/project/file1.js'];
      vi.mocked(getSourceFiles).mockReturnValue(mockFiles);
      vi.mocked(fs).existsSync.mockReturnValue(true);
      vi.mocked(fs).readFileSync.mockImplementation((file) => `Content of ${file}`);
      rcConfig.rootDir = '/home/project';

      const result = getSourceCode(
        { taskFile: '/home/project/task.md' },
        { aiService: 'vertex-ai', askQuestion: false },
      );

      expect(result).toEqual({
        '/home/project/file1.js': {
          fileId: generateFileId('/home/project/file1.js'),
          summary: 'Summary of /home/project/file1.js',
        },
        '/home/project/task.md': {
          content: 'Content of /home/project/task.md',
          fileId: generateFileId('/home/project/task.md'),
        },
      });
    });
  });

  describe('getImageAssets', () => {
    it('should return image assets information', () => {
      const mockImageFiles = ['/home/project/image1.png', '/home/project/image2.jpg'];
      vi.mocked(getImageAssetFiles).mockReturnValue(mockImageFiles);
      vi.mocked(mime).lookup.mockImplementation((file) => (file.endsWith('.png') ? 'image/png' : 'image/jpeg'));
      vi.mocked(sizeOf).mockImplementation(() => ({ width: 100, height: 200 }));

      const result = getImageAssets();

      expect(result).toEqual({
        '/home/project/image1.png': { mimeType: 'image/png', width: 100, height: 200 },
        '/home/project/image2.jpg': { mimeType: 'image/jpeg', width: 100, height: 200 },
      });
      expect(verifySourceCodeLimit).toHaveBeenCalled();
    });
  });
});
