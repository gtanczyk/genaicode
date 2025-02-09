import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContextSourceCode } from './source-code-utils.js';
import { FileId, SourceCodeMap } from './source-code-types.js';
import * as readFiles from './read-files.js';

// Mock the getSourceCode function
vi.mock('./read-files.js', () => ({
  getSourceCode: vi.fn(),
}));

const FILE_ID = 'id1' as FileId;

describe('getContextSourceCode', () => {
  const mockOptions = {
    aiService: 'vertex-ai' as const,
    askQuestion: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty SourceCodeMap for empty input array', () => {
    const result = getContextSourceCode([], mockOptions);
    expect(result).toEqual({});
    expect(readFiles.getSourceCode).not.toHaveBeenCalled();
  });

  it('should handle single file without dependencies or dependents', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file.ts': {
        fileId: FILE_ID,
        content: 'console.log("test");',
        dependencies: [],
      },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual({
      '/path/to/file.ts': {
        content: 'console.log("test");',
        dependencies: [],
        fileId: FILE_ID,
      },
    });
    expect(readFiles.getSourceCode).toHaveBeenCalledTimes(1);
  });

  it('should handle single file with one dependency', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file.ts': {
        fileId: FILE_ID,
        content: 'import { helper } from "./helper";',
        dependencies: [{ path: '/path/to/helper.ts', type: 'local' }],
      },
      '/path/to/helper.ts': { fileId: FILE_ID, content: 'export const helper = () => {};', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual({
      '/path/to/file.ts': {
        fileId: FILE_ID,
        content: 'import { helper } from "./helper";',
        dependencies: [{ path: '/path/to/helper.ts', type: 'local' }],
      },
      '/path/to/helper.ts': { fileId: FILE_ID, content: 'export const helper = () => {};', dependencies: [] },
    });
  });

  it('should handle single file with multiple dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file.ts': {
        fileId: FILE_ID,
        content: 'import stuff',
        dependencies: [
          { path: '/path/to/helper1.ts', type: 'local' },
          { path: '/path/to/helper2.ts', type: 'local' },
        ],
      },
      '/path/to/helper1.ts': { fileId: FILE_ID, content: 'helper1 content', dependencies: [] },
      '/path/to/helper2.ts': { fileId: FILE_ID, content: 'helper2 content', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });

  it('should handle single file with reverse dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file.ts': { fileId: FILE_ID, content: 'export const util = () => {};', dependencies: [] },
      '/path/to/dependent1.ts': {
        fileId: FILE_ID,
        content: 'import { util } from "./file";',
        dependencies: [{ path: '/path/to/file.ts', type: 'local' }],
      },
      '/path/to/dependent2.ts': {
        fileId: FILE_ID,
        content: 'import { util } from "./file";',
        dependencies: [{ path: '/path/to/file.ts', type: 'local' }],
      },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });

  it('should handle multiple files with shared dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file1.ts': {
        fileId: FILE_ID,
        content: 'file1 content',
        dependencies: [{ path: '/path/to/shared.ts', type: 'local' }],
      },
      '/path/to/file2.ts': {
        fileId: FILE_ID,
        content: 'file2 content',
        dependencies: [{ path: '/path/to/shared.ts', type: 'local' }],
      },
      '/path/to/shared.ts': { fileId: FILE_ID, content: 'shared content', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file1.ts', '/path/to/file2.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });

  it('should handle multiple files with reverse dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/utils1.ts': { fileId: FILE_ID, content: 'utils1 content', dependencies: [] },
      '/path/to/utils2.ts': { fileId: FILE_ID, content: 'utils2 content', dependencies: [] },
      '/path/to/dependent1.ts': {
        fileId: FILE_ID,
        content: 'dependent1 content',
        dependencies: [
          { path: '/path/to/utils1.ts', type: 'local' },
          { path: '/path/to/utils2.ts', type: 'local' },
        ],
      },
      '/path/to/dependent2.ts': {
        fileId: FILE_ID,
        content: 'dependent2 content',
        dependencies: [{ path: '/path/to/utils1.ts', type: 'local' }],
      },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/utils1.ts', '/path/to/utils2.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });

  it('should handle files not found in source code map', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/existing.ts': { fileId: FILE_ID, content: 'existing content', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/existing.ts', '/path/to/non-existing.ts'], mockOptions);

    expect(result).toEqual({
      '/path/to/existing.ts': {
        content: 'existing content',
        dependencies: [],
        fileId: FILE_ID,
      },
    });
  });

  it('should handle circular dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file1.ts': {
        fileId: FILE_ID,
        content: 'file1 content',
        dependencies: [{ path: '/path/to/file2.ts', type: 'local' }],
      },
      '/path/to/file2.ts': {
        fileId: FILE_ID,
        content: 'file2 content',
        dependencies: [{ path: '/path/to/file1.ts', type: 'local' }],
      },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file1.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });

  it('should handle files with summary instead of content', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file.ts': {
        fileId: FILE_ID,
        summary: 'File summary',
        dependencies: [{ path: '/path/to/dep.ts', type: 'local' }],
      },
      '/path/to/dep.ts': { fileId: FILE_ID, content: 'dep content', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });
});
