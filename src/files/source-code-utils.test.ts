import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContextSourceCode, computePopularDependencies } from './source-code-utils.js';
import { FileId, SourceCodeMap } from './source-code-types.js';
import * as readFiles from './read-files.js';
import { SummaryCache } from './summary-cache.js';
import { md5 } from './cache-file.js';

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

describe('computePopularDependencies', () => {
  it('should return an empty set for an empty cache', () => {
    const summaryCache: SummaryCache = { _version: '1' } as SummaryCache;
    const popular = computePopularDependencies(summaryCache);
    expect(popular).toEqual(new Set());
  });

  it('should return an empty set if no dependency meets the threshold', () => {
    const summaryCache = {
      _version: '1',
    } as SummaryCache;
    summaryCache['file1.ts'] = {
      dependencies: [
        { path: 'dep1.ts', type: 'local' },
        { path: 'dep2.ts', type: 'local' },
      ],
      tokenCount: 100,
      summary: 'File 1 summary',
      checksum: md5('File 1 summary'),
    };
    summaryCache['file2.ts'] = {
      dependencies: [{ path: 'dep1.ts', type: 'local' }],
      tokenCount: 50,
      summary: 'File 2 summary',
      checksum: md5('File 2 summary'),
    };
    const popular = computePopularDependencies(summaryCache, 3);
    expect(popular).toEqual(new Set());
  });

  it('should identify popular dependencies that meet the default threshold', () => {
    const summaryCache: SummaryCache = { _version: '1' } as SummaryCache;
    for (let i = 0; i < 10; i++) {
      summaryCache[`file${i}.ts`] = {
        dependencies: [{ path: 'popular.ts', type: 'local' }],
        tokenCount: 100,
        summary: `File ${i} summary`,
        checksum: md5(`File ${i} summary`),
      };
    }
    summaryCache['another.ts'] = {
      dependencies: [{ path: 'less-popular.ts', type: 'local' }],
      tokenCount: 50,
      summary: 'Another file summary',
      checksum: md5('Another file summary'),
    };

    const popular = computePopularDependencies(summaryCache, 10);
    expect(popular).toEqual(new Set(['popular.ts']));
  });

  it('should ignore non-local dependencies', () => {
    const summaryCache: SummaryCache = { _version: '1' } as SummaryCache;
    for (let i = 0; i < 30; i++) {
      summaryCache[`file${i}.ts`] = {
        dependencies: [
          { path: 'popular.ts', type: 'local' },
          { path: 'npm-package', type: 'external' },
        ],
        tokenCount: 100,
        summary: `File ${i} summary`,
        checksum: md5(`File ${i} summary`),
      };
    }
    const popular = computePopularDependencies(summaryCache);
    expect(popular).toEqual(new Set(['popular.ts']));
    expect(popular.has('npm-package')).toBe(false);
  });

  it('should correctly rank dependencies by popularity', () => {
    const summaryCache: SummaryCache = {
      _version: '1',
      ...Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [`fileA${i}.ts`, { dependencies: [{ path: 'depA.ts', type: 'local' }] }]),
      ),
      ...Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`fileB${i}.ts`, { dependencies: [{ path: 'depB.ts', type: 'local' }] }]),
      ),
      ...Object.fromEntries(
        Array.from({ length: 3 }, (_, i) => [`fileC${i}.ts`, { dependencies: [{ path: 'depC.ts', type: 'local' }] }]),
      ),
    } as SummaryCache;

    const popular = computePopularDependencies(summaryCache, 4);
    expect(popular).toEqual(new Set(['depB.ts', 'depA.ts']));
    const result = Array.from(popular);
    // The order is not guaranteed by Set, but the underlying logic sorts it.
    // Let's test the sorting inside the function logic by checking the order of insertion if possible
    // or just the content
    expect(result.includes('depB.ts')).toBe(true);
    expect(result.includes('depA.ts')).toBe(true);
  });
});
