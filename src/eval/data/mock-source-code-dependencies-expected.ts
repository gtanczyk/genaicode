import { MOCK_SOURCE_CODE_DEPENDENCIES } from './mock-source-code-dependencies';

/**
 * Expected dependency information extracted from source code
 */
export interface ExpectedDependencyInfo {
  /** The absolute path or package name of the dependency */
  path: string;
  /** Whether this is a local file or external package */
  type: 'local' | 'external';
}

/**
 * Expected results for each test case
 */
export interface ExpectedResult {
  /** List of dependencies that should be extracted */
  dependencies: ExpectedDependencyInfo[];
  /** Expected summary for happy path tests */
  summary?: string;
}

/**
 * Expected results for each mock source code example
 */
export const MOCK_SOURCE_CODE_DEPENDENCIES_EXPECTED: Record<
  keyof typeof MOCK_SOURCE_CODE_DEPENDENCIES,
  ExpectedResult
> = {
  'esm-relative': {
    dependencies: [
      { path: '/project/src/fs/read-file.ts', type: 'local' },
      { path: '/project/src/fs/write-file.ts', type: 'local' },
      { path: '/project/src/utils/path-validator.ts', type: 'local' },
      { path: '/project/src/utils/types.ts', type: 'local' },
    ],
    summary: 'File processing utility with read, write, and path validation functionality.',
  },

  'esm-relative-no-contents': {
    dependencies: [
      { path: '/project/src/fs/read-file.ts', type: 'local' },
      { path: '/project/src/fs/write-file.ts', type: 'local' },
      { path: '/project/src/utils/path-validator.ts', type: 'local' },
      { path: '/project/src/utils/types.ts', type: 'local' },
    ],
    summary: 'File processing utility with read, write, and path validation functionality.',
  },

  'esm-packages': {
    dependencies: [
      { path: 'axios', type: 'external' },
      { path: 'zod', type: 'external' },
      { path: '@internal/logger', type: 'external' },
    ],
    summary: 'API service with data fetching, validation, and logging.',
  },

  'commonjs-relative': {
    dependencies: [
      { path: '/project/src/db/connection', type: 'local' },
      { path: '/project/src/lib/query', type: 'local' },
      { path: '/project/src/config/database.json', type: 'local' },
    ],
    summary: 'Database initialization module with connection and query setup.',
  },

  'commonjs-packages': {
    dependencies: [
      { path: 'path', type: 'external' },
      { path: 'fs-extra', type: 'external' },
      { path: 'webpack', type: 'external' },
      { path: 'commander', type: 'external' },
      { path: '/project/src/webpack.config.js', type: 'local' },
    ],
    summary: 'Build script using webpack with CLI argument parsing.',
  },

  'mixed-imports': {
    dependencies: [
      { path: 'path', type: 'external' },
      { path: 'fs', type: 'external' },
      { path: 'chalk', type: 'external' },
      { path: 'glob', type: 'external' },
      { path: '/project/src/legacy/old-module', type: 'local' },
    ],
    summary: 'File processing utility using both ESM and CommonJS modules.',
  },

  'edge-cases': {
    dependencies: [
      { path: '/project/src/features/types', type: 'local' },
      { path: '@internal/types', type: 'external' },
      { path: 'webpack', type: 'external' },
      { path: '/project/src/features/plugins', type: 'local' },
      { path: '/project/src/features/polyfills', type: 'local' },
      { path: '/project/src/features/config.json', type: 'local' },
      { path: '@scope/plugin/path', type: 'external' },
      { path: '/project/src/features/somewhere', type: 'local' },
    ],
    summary: 'Dynamic plugin loader with various import patterns and type imports.',
  },
};

/**
 * Test cases for validating dependency extraction
 */
export const DEPENDENCY_EXTRACTION_TEST_CASES = [
  {
    name: 'ESM imports with relative paths',
    key: 'esm-relative' as const,
    description: 'Should correctly resolve relative ESM imports and type imports',
  },
  {
    name: 'ESM imports with relative paths but no contents',
    key: 'esm-relative-no-contents' as const,
    description: 'Should correctly resolve relative ESM imports and type imports',
  },
  {
    name: 'ESM imports with package names',
    key: 'esm-packages' as const,
    description: 'Should identify external package dependencies from ESM imports',
  },
  {
    name: 'CommonJS require with relative paths',
    key: 'commonjs-relative' as const,
    description: 'Should correctly resolve relative paths in require statements',
  },
  {
    name: 'CommonJS require with package names',
    key: 'commonjs-packages' as const,
    description: 'Should identify external package dependencies from require statements',
  },
  {
    name: 'Mixed ESM and CommonJS imports',
    key: 'mixed-imports' as const,
    description: 'Should handle mixed use of ESM and CommonJS imports in the same file',
  },
  {
    name: 'Edge cases',
    key: 'edge-cases' as const,
    description: 'Should handle dynamic imports, type imports, and other edge cases',
  },
] as const;
