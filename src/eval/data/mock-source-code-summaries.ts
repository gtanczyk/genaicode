/**
 * Mock source code summaries for testing purposes, with a small dataset.
 */

import { SourceCodeTree } from '../../files/source-code-tree';

export const MOCK_SOURCE_CODE_SUMMARIES_ROOT_DIR = '/project/src';

export const MOCK_SOURCE_CODE_SUMMARIES: SourceCodeTree = {
  '/project/src/math': {
    'math.ts': {
      summary: 'Core mathematical operations module with basic arithmetic and advanced mathematical functions.',
      dependencies: [{ path: '/project/src/math/math-utils.ts', type: 'local' }],
    },
    'math-utils.ts': {
      summary: 'Utility functions for mathematical computations, including helper methods for core math operations.',
      dependencies: [],
    },
  },
  '/project/src/network': {
    'network-client.ts': {
      summary: 'Network communication module for handling HTTP requests and API interactions.',
      dependencies: [],
    },
  },
  '/project/src/ui': {
    'ui-components.ts': {
      summary: 'User interface components library with reusable React components.',
      dependencies: [],
    },
  },
};
