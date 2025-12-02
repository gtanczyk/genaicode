import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContextSourceCode, computePopularDependencies } from './source-code-utils.js';
import { FileId, SourceCodeMap, FileContent } from './source-code-types.js';
import * as readFiles from './read-files.js';
import { SummaryCache } from './summary-cache.js';
import { md5 } from './cache-file.js';
import { generateFileId } from './file-id-utils.js';

// Mock the getSourceCode function
vi.mock('./read-files.js', () => ({
  getSourceCode: vi.fn(),
}));

// Helper to create a SourceCodeMap with unique FileIds and correct dependency structure
function createTestSourceCodeMap(
  rawMap: Record<
    string,
    { content?: string; summary?: string; dependencies?: { path: string; type: 'local' | 'external' }[] }
  >,
): {
  sourceCodeMap: SourceCodeMap;
  fileIDtoPathMap: Map<FileId, string>;
  pathToIdMap: Map<string, FileId>;
} {
  const sourceCodeMap: SourceCodeMap = {};
  const fileIDtoPathMap: Map<FileId, string> = new Map();
  const pathToIdMap: Map<string, FileId> = new Map();

  // First pass: assign unique FileIds and populate basic info
  for (const filePath in rawMap) {
    const fileId = generateFileId(filePath);
    sourceCodeMap[filePath] = {
      fileId,
      ...(rawMap[filePath].content !== undefined ? { content: rawMap[filePath].content ?? null } : {}),
      ...(rawMap[filePath].summary !== undefined ? { summary: rawMap[filePath].summary } : {}),
    } as FileContent;
    fileIDtoPathMap.set(fileId, filePath);
    pathToIdMap.set(filePath, fileId);
  }

  // Second pass: resolve localDeps using assigned FileIds
  for (const filePath in rawMap) {
    const deps = rawMap[filePath].dependencies;
    if (deps && deps.length > 0) {
      const localDeps: FileId[] = [];
      const externalDeps: string[] = [];
      for (const dep of deps) {
        if (dep.type === 'local') {
          const depFileId = pathToIdMap.get(dep.path);
          if (depFileId) {
            localDeps.push(depFileId);
          }
        } else {
          externalDeps.push(dep.path);
        }
      }
      if (localDeps.length > 0) {
        (sourceCodeMap[filePath] as FileContent).localDeps = localDeps;
      }
      if (externalDeps.length > 0) {
        (sourceCodeMap[filePath] as FileContent).externalDeps = externalDeps;
      }
    }
  }

  return { sourceCodeMap, fileIDtoPathMap, pathToIdMap };
}

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
    const rawMockSourceCode = {
      '/path/to/file.ts': {
        content: 'console.log("test");',
      },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(sourceCodeMap);
    expect(readFiles.getSourceCode).toHaveBeenCalledTimes(1);
  });

  it('should handle single file with one dependency', () => {
    const rawMockSourceCode = {
      '/path/to/file.ts': {
        content: 'import { helper } from "./helper";',
        dependencies: [{ path: '/path/to/helper.ts', type: 'local' }],
      },
      '/path/to/helper.ts': { content: 'export const helper = () => {};' },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(sourceCodeMap);
  });

  it('should handle single file with multiple dependencies', () => {
    const rawMockSourceCode = {
      '/path/to/file.ts': {
        content: 'import stuff',
        dependencies: [
          { path: '/path/to/helper1.ts', type: 'local' },
          { path: '/path/to/helper2.ts', type: 'local' },
        ],
      },
      '/path/to/helper1.ts': { content: 'helper1 content' },
      '/path/to/helper2.ts': { content: 'helper2 content' },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(sourceCodeMap);
  });

  it('should handle single file with reverse dependencies', () => {
    const rawMockSourceCode = {
      '/path/to/file.ts': { content: 'export const util = () => {};' },
      '/path/to/dependent1.ts': {
        content: 'import { util } from "./file";',
        dependencies: [{ path: '/path/to/file.ts', type: 'local' }],
      },
      '/path/to/dependent2.ts': {
        content: 'import { util } from "./file";',
        dependencies: [{ path: '/path/to/file.ts', type: 'local' }],
      },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(sourceCodeMap);
  });

  it('should handle multiple files with shared dependencies', () => {
    const rawMockSourceCode = {
      '/path/to/file1.ts': {
        content: 'file1 content',
        dependencies: [{ path: '/path/to/shared.ts', type: 'local' }],
      },
      '/path/to/file2.ts': {
        content: 'file2 content',
        dependencies: [{ path: '/path/to/shared.ts', type: 'local' }],
      },
      '/path/to/shared.ts': { content: 'shared content' },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/file1.ts', '/path/to/file2.ts'], mockOptions);

    expect(result).toEqual(sourceCodeMap);
  });

  it('should handle multiple files with reverse dependencies', () => {
    const rawMockSourceCode = {
      '/path/to/utils1.ts': { content: 'utils1 content' },
      '/path/to/utils2.ts': { content: 'utils2 content' },
      '/path/to/dependent1.ts': {
        content: 'dependent1 content',
        dependencies: [
          { path: '/path/to/utils1.ts', type: 'local' },
          { path: '/path/to/utils2.ts', type: 'local' },
        ],
      },
      '/path/to/dependent2.ts': {
        content: 'dependent2 content',
        dependencies: [{ path: '/path/to/utils1.ts', type: 'local' }],
      },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/utils1.ts', '/path/to/utils2.ts'], mockOptions);

    expect(result).toEqual(sourceCodeMap);
  });

  it('should handle files not found in source code map', () => {
    const rawMockSourceCode = {
      '/path/to/existing.ts': { content: 'existing content' },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/existing.ts', '/path/to/non-existing.ts'], mockOptions);

    expect(result).toEqual({
      '/path/to/existing.ts': sourceCodeMap['/path/to/existing.ts'],
    });
  });

  it('should handle circular dependencies', () => {
    const rawMockSourceCode = {
      '/path/to/file1.ts': {
        content: 'file1 content',
        dependencies: [{ path: '/path/to/file2.ts', type: 'local' }],
      },
      '/path/to/file2.ts': {
        content: 'file2 content',
        dependencies: [{ path: '/path/to/file1.ts', type: 'local' }],
      },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/file1.ts'], mockOptions);

    expect(result).toEqual(sourceCodeMap);
  });

  it('should handle files with summary instead of content', () => {
    const rawMockSourceCode = {
      '/path/to/file.ts': {
        summary: 'File summary',
        dependencies: [{ path: '/path/to/dep.ts', type: 'local' }],
      },
      '/path/to/dep.ts': { content: 'dep content' },
    };
    const { sourceCodeMap } = createTestSourceCodeMap(rawMockSourceCode);

    vi.mocked(readFiles.getSourceCode).mockReturnValue(sourceCodeMap);

    const result = getContextSourceCode(['/path/to/file.ts'], mockOptions);

    expect(result).toEqual(sourceCodeMap);
  });
});

describe('computePopularDependencies', () => {
  it('should return an empty set for an empty cache', () => {
    const summaryCache: SummaryCache = { _version: '1' } as SummaryCache;
    const { sourceCodeMap } = createTestSourceCodeMap({});
    const popular = computePopularDependencies(sourceCodeMap, summaryCache);
    expect(popular).toEqual(new Set());
  });

  it('should return an empty set if no dependency meets the threshold', () => {
    const rawSourceCode = {
      'file1.ts': {
        content: 'File 1 content',
        dependencies: [
          { path: 'dep1.ts', type: 'local' },
          { path: 'dep2.ts', type: 'local' },
        ],
      },
      'file2.ts': { content: 'File 2 content', dependencies: [{ path: 'dep1.ts', type: 'local' }] },
      'dep1.ts': { content: 'Dep 1 content' },
      'dep2.ts': { content: 'Dep 2 content' },
    };
    const { sourceCodeMap, pathToIdMap } = createTestSourceCodeMap(rawSourceCode);

    const summaryCache: SummaryCache = { _version: '1' } as SummaryCache;
    summaryCache['file1.ts'] = {
      localDeps: [pathToIdMap.get('dep1.ts')!, pathToIdMap.get('dep2.ts')!],
      tokenCount: 100,
      summary: 'File 1 summary',
      checksum: md5('File 1 summary'),
    };
    summaryCache['file2.ts'] = {
      localDeps: [pathToIdMap.get('dep1.ts')!],
      tokenCount: 50,
      summary: 'File 2 summary',
      checksum: md5('File 2 summary'),
    };

    const popular = computePopularDependencies(sourceCodeMap, summaryCache, 3);
    expect(popular).toEqual(new Set());
  });

  it('should identify popular dependencies that meet the default threshold', () => {
    const rawSourceCode: Record<
      string,
      { content?: string; dependencies?: { path: string; type: 'local' | 'external' }[] }
    > = {};
    const summaryCache: SummaryCache = { _version: '1' } as SummaryCache;

    for (let i = 0; i < 10; i++) {
      rawSourceCode[`file${i}.ts`] = { dependencies: [{ path: 'popular.ts', type: 'local' }] };
    }
    rawSourceCode['another.ts'] = { dependencies: [{ path: 'less-popular.ts', type: 'local' }] };
    rawSourceCode['popular.ts'] = { content: 'popular content' };
    rawSourceCode['less-popular.ts'] = { content: 'less popular content' };

    const { sourceCodeMap, pathToIdMap } = createTestSourceCodeMap(rawSourceCode);

    for (let i = 0; i < 10; i++) {
      summaryCache[`file${i}.ts`] = {
        localDeps: [pathToIdMap.get('popular.ts')!],
        tokenCount: 100,
        summary: `File ${i} summary`,
        checksum: md5(`File ${i} summary`),
      };
    }
    summaryCache['another.ts'] = {
      localDeps: [pathToIdMap.get('less-popular.ts')!],
      tokenCount: 50,
      summary: 'Another file summary',
      checksum: md5('Another file summary'),
    };

    const popular = computePopularDependencies(sourceCodeMap, summaryCache, 10);
    expect(popular).toEqual(new Set(['popular.ts']));
  });

  it('should ignore non-local dependencies', () => {
    const rawSourceCode: Record<
      string,
      { content?: string; dependencies?: { path: string; type: 'local' | 'external' }[] }
    > = {};
    const summaryCache: SummaryCache = { _version: '1' } as SummaryCache;

    for (let i = 0; i < 30; i++) {
      rawSourceCode[`file${i}.ts`] = {
        dependencies: [
          { path: 'popular.ts', type: 'local' },
          { path: 'npm-package', type: 'external' },
        ],
      };
    }
    rawSourceCode['popular.ts'] = { content: 'popular content' };

    const { sourceCodeMap, pathToIdMap } = createTestSourceCodeMap(rawSourceCode);

    for (let i = 0; i < 30; i++) {
      summaryCache[`file${i}.ts`] = {
        localDeps: [pathToIdMap.get('popular.ts')!],
        externalDeps: ['npm-package'],
        tokenCount: 100,
        summary: `File ${i} summary`,
        checksum: md5(`File ${i} summary`),
      };
    }

    const popular = computePopularDependencies(sourceCodeMap, summaryCache);
    expect(popular).toEqual(new Set(['popular.ts']));
    expect(popular.has('npm-package')).toBe(false);
  });

  it('should correctly rank dependencies by popularity', () => {
    const rawSourceCode: Record<
      string,
      { content?: string; dependencies?: { path: string; type: 'local' | 'external' }[] }
    > = {};
    const summaryCache: SummaryCache = { _version: '1' } as SummaryCache;

    for (let i = 0; i < 5; i++) {
      rawSourceCode[`fileA${i}.ts`] = { dependencies: [{ path: 'depA.ts', type: 'local' }] };
    }
    for (let i = 0; i < 10; i++) {
      rawSourceCode[`fileB${i}.ts`] = { dependencies: [{ path: 'depB.ts', type: 'local' }] };
    }
    for (let i = 0; i < 3; i++) {
      rawSourceCode[`fileC${i}.ts`] = { dependencies: [{ path: 'depC.ts', type: 'local' }] };
    }
    rawSourceCode['depA.ts'] = { content: 'depA content' };
    rawSourceCode['depB.ts'] = { content: 'depB content' };
    rawSourceCode['depC.ts'] = { content: 'depC content' };

    const { sourceCodeMap, pathToIdMap } = createTestSourceCodeMap(rawSourceCode);

    for (let i = 0; i < 5; i++) {
      summaryCache[`fileA${i}.ts`] = {
        localDeps: [pathToIdMap.get('depA.ts')!],
        tokenCount: 1,
        summary: '',
        checksum: md5(''),
      };
    }
    for (let i = 0; i < 10; i++) {
      summaryCache[`fileB${i}.ts`] = {
        localDeps: [pathToIdMap.get('depB.ts')!],
        tokenCount: 1,
        summary: '',
        checksum: md5(''),
      };
    }
    for (let i = 0; i < 3; i++) {
      summaryCache[`fileC${i}.ts`] = {
        localDeps: [pathToIdMap.get('depC.ts')!],
        tokenCount: 1,
        summary: '',
        checksum: md5(''),
      };
    }

    const popular = computePopularDependencies(sourceCodeMap, summaryCache, 4);
    expect(popular).toEqual(new Set(['depB.ts', 'depA.ts']));
  });
});
