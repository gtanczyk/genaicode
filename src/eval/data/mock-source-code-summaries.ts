/**
 * Mock source code summaries for testing purposes, with a small dataset.
 */

import { generateFileId } from '../../files/file-id-utils';
import { SourceCodeMap } from '../../files/source-code-types';

export const MOCK_SOURCE_CODE_SUMMARIES_ROOT_DIR = '/project/src';

export const MOCK_SOURCE_CODE_SUMMARIES: SourceCodeMap = {
  '/project/src/math/math.ts': {
    fileId: generateFileId('/project/src/math/math.ts'),
    summary: 'Core mathematical operations module with basic arithmetic and advanced mathematical functions.',
    dependencies: [{ path: '/project/src/math/math-utils.ts', type: 'local' }],
  },
  '/project/src/math/math-utils.ts': {
    fileId: generateFileId('/project/src/math/math-utils.ts'),
    summary: 'Utility functions for mathematical computations, including helper methods for core math operations.',
    dependencies: [],
  },
  '/project/src/network/network-client.ts': {
    fileId: generateFileId('/project/src/network/network-client.ts'),
    summary: 'Network communication module for handling HTTP requests and API interactions.',
    dependencies: [],
  },
  '/project/src/ui/ui-components.ts': {
    fileId: generateFileId('/project/src/ui/ui-components.ts'),
    summary: 'User interface components library with reusable React components.',
    dependencies: [],
  },
};
