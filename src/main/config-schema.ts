import { Validator, Schema } from 'jsonschema';

/**
 * This file contains the JSON schema for .genaicoderc configuration.
 * The schema is based on the RcConfig interface and provides comprehensive
 * documentation for all available configuration options.
 *
 * IMPORTANT: Keep this schema in sync with the RcConfig interface in config-lib.ts
 */
export const GENAICODERC_SCHEMA: Schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'GenAIcode Configuration Schema',
  description: 'Configuration schema for .genaicoderc file used by GenAIcode',
  type: 'object',
  properties: {
    rootDir: {
      type: 'string',
      description: `Root directory of the project. All file paths will be relative to this directory.
Default value is '.'.
Examples: '.', 'src', './project'`,
    },
    lintCommand: {
      type: 'string',
      description: `Command to run for linting the code before and after generation. The command should return appropriate exit codes for success/failure.
Examples: 'npm run lint', 'eslint .', 'npm run type-check && npm run lint'`,
    },
    extensions: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^\\.[a-z0-9\\.]+$',
      },
      description: `File extensions that the tool should consider for code generation and analysis.
Examples: ['.js', '.ts', '.tsx', '.md'], ['.py', '.go', '.java'], ['.c', '.h', '.cpp']`,
    },
    ignorePaths: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: `Directories and files that should be excluded from code analysis and generation:
Examples: ['node_modules', 'dist', 'build'], ['coverage', '.vscode', '.github']`,
    },
    importantContext: {
      type: 'object',
      description: 'Configuration for important context that should always be available to the AI model.',
      properties: {
        systemPrompt: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Additional system-level prompts to guide AI behavior and set context.',
        },
        files: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Paths to files that should always be included in the context for code generation.',
        },
      },
    },
    modelOverrides: {
      type: 'object',
      description: 'Override configurations for different AI service models.',
      properties: {
        openai: {
          type: 'object',
          properties: {
            cheap: {
              type: 'string',
              description: `Model to use when cheap flag is enabled for OpenAI compatible service.
Example: ['gpt-4o-mini']`,
            },
            default: {
              type: 'string',
              description: `Default model to use for OpenAI compatible service. Example: ['gpt-4o']`,
            },
            outputTokenLimit: {
              type: 'number',
              description: `Maximum number of tokens to generate in the output for OpenAI compatible service.\nDefaults vary by service (e.g., 8192).`,
            },
          },
        },
        anthropic: {
          type: 'object',
          properties: {
            cheap: {
              type: 'string',
              description: `Model to use when cheap flag is enabled for Anthropic service. Example: ['claude-3-haiku-20240307']`,
            },
            default: {
              type: 'string',
              description: `Default model to use for Anthropic service. Example: ['claude-3-5-sonnet-20240620']`,
            },
            outputTokenLimit: {
              type: 'number',
              description: `Maximum number of tokens to generate in the output for Anthropic service.\nDefaults vary by service (e.g., 8192).`,
            },
          },
        },
        vertexAi: {
          type: 'object',
          properties: {
            cheap: {
              type: 'string',
              description: `Model to use when cheap flag is enabled for Vertex AI service. Example: ['gemini-1.5-flash-001']`,
            },
            default: {
              type: 'string',
              description: `Default model to use for Vertex AI service. Example: ['gemini-1.5-pro-001']`,
            },
          },
        },
        outputTokenLimit: {
          type: 'number',
          description: `Maximum number of tokens to generate in the output for Vertex AI service.\nDefaults vary by service (e.g., 8192).`,
        },
        aiStudio: {
          type: 'object',
          properties: {
            cheap: {
              type: 'string',
              description: `Model to use when cheap flag is enabled for AI Studio service. Example: ['gemini-1.5-flash-001']`,
            },
            default: {
              type: 'string',
              description: `Default model to use for AI Studio service. Example: ['gemini-1.5-pro-001']`,
            },
            outputTokenLimit: {
              type: 'number',
              description: `Maximum number of tokens to generate in the output for AI Studio service.\nDefaults vary by service (e.g., 8192).`,
            },
          },
        },
      },
    },
    plugins: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: `Paths to plugin files that should be loaded by GenAIcode. Plugins can extend functionality by adding custom operations, AI services, or action handlers.
Example: ['./plugins/custom-plugin.js', './examples/genaicode_plugins/genaicode_tracker.js', './examples/genaicode_plugins/nonsense_operation.js']`,
    },
    featuresEnabled: {
      type: 'object',
      description: 'Configuration for enabling/disabling specific features in the tool.',
      properties: {
        appContext: {
          type: 'boolean',
          description: 'Enable/disable the app context feature that provides additional context for code generation.',
        },
      },
    },
  },
  required: ['rootDir'],
  additionalProperties: false,
};

/**
 * Name of the virtual file that contains the schema
 */
export const SCHEMA_VIRTUAL_FILE_NAME = '.genaicoderc.schema.json';

export function validateRcConfig(rcConfig: unknown) {
  const validator = new Validator();
  const result = validator.validate(rcConfig, GENAICODERC_SCHEMA);
  if (!result.valid) {
    throw new Error(`Invalid .genaicoderc configuration: ${result.errors.map((e) => e.stack).join('\n')}`);
  }
}
