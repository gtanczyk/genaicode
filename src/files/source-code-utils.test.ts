import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContextSourceCode } from './source-code-utils.js';
import { SourceCodeMap } from './source-code-types.js';
import * as readFiles from './read-files.js';

// Mock the getSourceCode function
vi.mock('./read-files.js', () => ({
  getSourceCode: vi.fn(),
}));

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
        fileId: 'id1',
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
        fileId: 'id1',
      },
    });
    expect(readFiles.getSourceCode).toHaveBeenCalledTimes(1);
  });

  it('should handle single file with one dependency', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file.ts': {
        fileId: 'id1',
        content: 'import { helper } from "./helper";',
        dependencies: [{ path: '/path/to/helper.ts', type: 'local' }],
      },
      '/path/to/helper.ts': { fileId: 'id1', content: 'export const helper = () => {};', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual({
      '/path/to/file.ts': {
        fileId: 'id1',
        content: 'import { helper } from "./helper";',
        dependencies: [{ path: '/path/to/helper.ts', type: 'local' }],
      },
      '/path/to/helper.ts': { fileId: 'id1', content: 'export const helper = () => {};', dependencies: [] },
    });
  });

  it('should handle single file with multiple dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file.ts': {
        fileId: 'id1',
        content: 'import stuff',
        dependencies: [
          { path: '/path/to/helper1.ts', type: 'local' },
          { path: '/path/to/helper2.ts', type: 'local' },
        ],
      },
      '/path/to/helper1.ts': { fileId: 'id1', content: 'helper1 content', dependencies: [] },
      '/path/to/helper2.ts': { fileId: 'id1', content: 'helper2 content', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });

  it('should handle single file with reverse dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file.ts': { fileId: 'id1', content: 'export const util = () => {};', dependencies: [] },
      '/path/to/dependent1.ts': {
        fileId: 'id1',
        content: 'import { util } from "./file";',
        dependencies: [{ path: '/path/to/file.ts', type: 'local' }],
      },
      '/path/to/dependent2.ts': {
        fileId: 'id1',
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
        fileId: 'id1',
        content: 'file1 content',
        dependencies: [{ path: '/path/to/shared.ts', type: 'local' }],
      },
      '/path/to/file2.ts': {
        fileId: 'id1',
        content: 'file2 content',
        dependencies: [{ path: '/path/to/shared.ts', type: 'local' }],
      },
      '/path/to/shared.ts': { fileId: 'id1', content: 'shared content', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file1.ts', '/path/to/file2.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });

  it('should handle multiple files with reverse dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/utils1.ts': { fileId: 'id1', content: 'utils1 content', dependencies: [] },
      '/path/to/utils2.ts': { fileId: 'id1', content: 'utils2 content', dependencies: [] },
      '/path/to/dependent1.ts': {
        fileId: 'id1',
        content: 'dependent1 content',
        dependencies: [
          { path: '/path/to/utils1.ts', type: 'local' },
          { path: '/path/to/utils2.ts', type: 'local' },
        ],
      },
      '/path/to/dependent2.ts': {
        fileId: 'id1',
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
      '/path/to/existing.ts': { fileId: 'id1', content: 'existing content', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/existing.ts', '/path/to/non-existing.ts'], mockOptions);

    expect(result).toEqual({
      '/path/to/existing.ts': {
        content: 'existing content',
        dependencies: [],
        fileId: 'id1',
      },
    });
  });

  it('should handle circular dependencies', () => {
    const mockSourceCodeMap: SourceCodeMap = {
      '/path/to/file1.ts': {
        fileId: 'id1',
        content: 'file1 content',
        dependencies: [{ path: '/path/to/file2.ts', type: 'local' }],
      },
      '/path/to/file2.ts': {
        fileId: 'id1',
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
        fileId: 'id1',
        summary: 'File summary',
        dependencies: [{ path: '/path/to/dep.ts', type: 'local' }],
      },
      '/path/to/dep.ts': { fileId: 'id1', content: 'dep content', dependencies: [] },
    };

    vi.mocked(readFiles.getSourceCode).mockReturnValue(mockSourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(mockSourceCodeMap);
  });
});
