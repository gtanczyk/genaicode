import { FileId } from '../../files/source-code-types.js';

// Generate file IDs for a large mock dataset
const generateFileIds = (): Record<string, FileId> => {
  const ids: Record<string, FileId> = {};
  let counter = 1;

  const files = [
    // Core modules
    'src/index.ts',
    'src/main.ts',
    'src/bootstrap.ts',
    'src/app.ts',

    // Utilities - 20 files
    ...Array.from({ length: 20 }, (_, i) => `src/utils/util-${i}.ts`),

    // Components - 30 files
    ...Array.from({ length: 30 }, (_, i) => `src/components/Component-${i}.tsx`),

    // Services - 15 files
    ...Array.from({ length: 15 }, (_, i) => `src/services/service-${i}.ts`),

    // Hooks - 10 files
    ...Array.from({ length: 10 }, (_, i) => `src/hooks/hook-${i}.ts`),

    // Types - 12 files
    ...Array.from({ length: 12 }, (_, i) => `src/types/type-${i}.ts`),

    // Store/State - 8 files
    ...Array.from({ length: 8 }, (_, i) => `src/store/store-${i}.ts`),

    // API - 5 files
    ...Array.from({ length: 5 }, (_, i) => `src/api/api-${i}.ts`),

    // Config - 3 files
    'src/config/index.ts',
    'src/config/constants.ts',
    'src/config/env.ts',

    // Middleware - 4 files
    ...Array.from({ length: 4 }, (_, i) => `src/middleware/middleware-${i}.ts`),
  ];

  for (const file of files) {
    ids[file] = counter++ as FileId;
  }

  return ids;
};

const fileIds = generateFileIds();

// Helper function to create mock summaries
const createMockSummary = (
  summary: string,
  localDeps: FileId[] = [],
  externalDeps: string[] = [],
  tokenCount: number = 100,
) => ({
  summary,
  localDeps,
  externalDeps,
  tokenCount,
  checksum: `checksum-${Math.random().toString(36).substr(2, 9)}`,
});

// Generate large mock dataset
const generateMockSummaries = () => {
  const summaries: Record<string, ReturnType<typeof createMockSummary>> = {};
  const fileArray = Object.entries(fileIds);

  for (let i = 0; i < fileArray.length; i++) {
    const [filePath] = fileArray[i];

    // Determine dependencies based on file type
    const localDeps: FileId[] = [];
    const externalDeps: string[] = [];
    let tokenCount = 100 + Math.random() * 400;

    if (filePath.includes('components')) {
      // Components depend on hooks and types
      if (i > 3) {
        localDeps.push(fileIds[fileArray[Math.floor(Math.random() * 10) + 3][0]]);
      }
      externalDeps.push('react', 'styled-components');
      tokenCount = 150 + Math.random() * 300;
    } else if (filePath.includes('services')) {
      // Services depend on API and types
      if (i > 5) {
        localDeps.push(fileIds[fileArray[Math.floor(Math.random() * 5) + 5][0]]);
      }
      externalDeps.push('axios');
      tokenCount = 200 + Math.random() * 300;
    } else if (filePath.includes('hooks')) {
      // Hooks depend on utils and types
      if (i > 2) {
        localDeps.push(fileIds[fileArray[Math.floor(Math.random() * 3) + 2][0]]);
      }
      externalDeps.push('react');
      tokenCount = 120 + Math.random() * 200;
    } else if (filePath.includes('utils')) {
      // Utils may depend on other utils
      if (i > 1 && Math.random() > 0.5) {
        localDeps.push(fileIds[fileArray[Math.floor(Math.random() * 2) + 1][0]]);
      }
      externalDeps.push('lodash');
      tokenCount = 100 + Math.random() * 200;
    } else if (filePath.includes('types')) {
      // Types have no dependencies
      externalDeps.push();
      tokenCount = 50 + Math.random() * 100;
    } else if (filePath.includes('api')) {
      // API depends on types and config
      if (i > 0) {
        localDeps.push(fileIds[fileArray[Math.floor(Math.random() * 1) + 0][0]]);
      }
      externalDeps.push('axios');
      tokenCount = 150 + Math.random() * 250;
    } else if (filePath.includes('store')) {
      // Store depends on types and services
      if (i > 2) {
        localDeps.push(fileIds[fileArray[Math.floor(Math.random() * 3) + 2][0]]);
      }
      externalDeps.push('redux', 'redux-thunk');
      tokenCount = 200 + Math.random() * 300;
    } else if (filePath.includes('middleware')) {
      // Middleware depends on config
      if (i > 0) {
        localDeps.push(fileIds[fileArray[0][0]]);
      }
      externalDeps.push('express');
      tokenCount = 120 + Math.random() * 200;
    } else {
      // Core files
      externalDeps.push('react', 'react-dom');
      tokenCount = 150 + Math.random() * 200;
    }

    summaries[filePath] = createMockSummary(
      `Summary for ${filePath}`,
      localDeps,
      externalDeps.filter(Boolean),
      Math.round(tokenCount),
    );
  }

  return summaries;
};

export const MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR = '/project';

export const MOCK_SOURCE_CODE_SUMMARIES_LARGE = generateMockSummaries();
