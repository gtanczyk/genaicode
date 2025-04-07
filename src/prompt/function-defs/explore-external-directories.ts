import { FunctionDef } from '../../ai-service/common-types.js';

/**
 * Function definition for exploreExternalDirectories
 *
 * Use this function to explore directories located outside the project's root directory.
 * User confirmation is required.
 */
export const exploreExternalDirectories: FunctionDef = {
  name: 'exploreExternalDirectories',
  description:
    "Use this function to explore directories located outside the project's root directory. User confirmation is required. Returns a list of file paths matching the criteria.",
  parameters: {
    type: 'object',
    properties: {
      directories: {
        type: 'array',
        items: {
          type: 'string',
        },
        minLength: 1,
        description: 'An array of absolute or relative directory paths for the external directories to explore.',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to explore directories recursively (default: false).',
      },
      depth: {
        type: 'number',
        description: 'Maximum depth for directory exploration. Must be 0 if not recursive. Must be >= 0.',
      },
      searchPhrases: {
        type: 'array',
        items: {
          type: 'string',
        },
        description:
          'Optional array of phrases to search for within file content (case-insensitive). Returns files containing ALL phrases.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of file paths to return (default: 50).',
      },
      reason: {
        type: 'string',
        description: 'The reason why exploring these external directories is needed for the current task.',
      },
    },
    required: ['directories', 'reason', 'depth'], // Added depth here
  },
};

export type ExploreExternalDirectoriesArgs = {
  directories: string[];
  recursive?: boolean;
  depth: number; // Made depth required
  searchPhrases?: string[];
  maxResults?: number;
  reason: string;
};
