import { FileId } from '../../files/source-code-types.js';

// File ID mapping for mock data
const fileIds: Record<string, FileId> = {
  'src/index.ts': 1 as FileId,
  'src/utils/helper.ts': 2 as FileId,
  'src/utils/formatter.ts': 3 as FileId,
  'src/components/Button.tsx': 4 as FileId,
  'src/components/Input.tsx': 5 as FileId,
  'src/services/api.ts': 6 as FileId,
  'src/services/auth.ts': 7 as FileId,
  'src/types/user.ts': 8 as FileId,
  'src/types/common.ts': 9 as FileId,
  'src/config.ts': 10 as FileId,
};

export const MOCK_SOURCE_CODE_SUMMARIES_ROOT_DIR = '/project';

export const MOCK_SOURCE_CODE_SUMMARIES = {
  'src/index.ts': {
    summary: 'Main entry point of the application. Initializes the app and renders the root component.',
    localDeps: [fileIds['src/components/Button.tsx'], fileIds['src/config.ts']],
    externalDeps: ['react', 'react-dom'],
    tokenCount: 150,
    checksum: 'abc123',
  },
  'src/utils/helper.ts': {
    summary: 'Utility functions for common operations like string manipulation and data transformation.',
    localDeps: [fileIds['src/utils/formatter.ts']],
    externalDeps: ['lodash'],
    tokenCount: 200,
    checksum: 'def456',
  },
  'src/utils/formatter.ts': {
    summary: 'Formatting utilities for dates, numbers, and currency.',
    localDeps: [],
    externalDeps: ['date-fns'],
    tokenCount: 120,
    checksum: 'ghi789',
  },
  'src/components/Button.tsx': {
    summary: 'Reusable button component with various styles and sizes.',
    localDeps: [fileIds['src/types/common.ts']],
    externalDeps: ['react', 'styled-components'],
    tokenCount: 180,
    checksum: 'jkl012',
  },
  'src/components/Input.tsx': {
    summary: 'Input component with validation and error handling.',
    localDeps: [fileIds['src/types/common.ts'], fileIds['src/utils/helper.ts']],
    externalDeps: ['react', 'styled-components'],
    tokenCount: 220,
    checksum: 'mno345',
  },
  'src/services/api.ts': {
    summary: 'API service layer for making HTTP requests to the backend.',
    localDeps: [fileIds['src/config.ts'], fileIds['src/services/auth.ts']],
    externalDeps: ['axios'],
    tokenCount: 300,
    checksum: 'pqr678',
  },
  'src/services/auth.ts': {
    summary: 'Authentication service handling login, logout, and token management.',
    localDeps: [fileIds['src/types/user.ts'], fileIds['src/config.ts']],
    externalDeps: ['jwt-decode'],
    tokenCount: 250,
    checksum: 'stu901',
  },
  'src/types/user.ts': {
    summary: 'TypeScript types and interfaces for user-related data structures.',
    localDeps: [],
    externalDeps: [],
    tokenCount: 80,
    checksum: 'vwx234',
  },
  'src/types/common.ts': {
    summary: 'Common TypeScript types used across the application.',
    localDeps: [],
    externalDeps: [],
    tokenCount: 100,
    checksum: 'yza567',
  },
  'src/config.ts': {
    summary: 'Application configuration including API endpoints and environment variables.',
    localDeps: [],
    externalDeps: [],
    tokenCount: 90,
    checksum: 'bcd890',
  },
};
