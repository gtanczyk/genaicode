import { Validator, Schema } from 'jsonschema';
import { RcConfig } from './config-types.js';

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
      description: `Root directory of the project. All file paths will be relative to this directory.\\nDefault value is '.'.\\nExamples: '.', 'src', './project'`,
    },
    lintCommand: {
      type: 'string',
      description: `Command to run for linting the code. Deprecated in favor of 'projectCommands.lint', but kept for backward compatibility. The command should return appropriate exit codes for success/failure.\\nExamples: 'npm run lint', 'eslint .', 'npm run type-check && npm run lint'`,
    },
    projectCommands: {
      type: 'object',
      description:
        'A map of named project-specific commands that can be executed by the AI, such as tests, builds, or formatters.',
      additionalProperties: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command string to execute. Can include shell operators.' },
          description: { type: 'string', description: 'A brief description of what the command does.' },
          defaultArgs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Default arguments to pass to the command.',
          },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Environment variables to set for the command execution.',
          },
          workingDir: {
            type: 'string',
            description: 'The working directory to run the command in. Defaults to rootDir.',
          },
          aliases: { type: 'array', items: { type: 'string' }, description: 'Optional aliases for the command name.' },
          autoApprove: {
            type: ['boolean', 'string'],
            description: `Determines if the command should be executed without user confirmation.
- If 'true', the command is always executed without a prompt.
- If a 'string', it's a natural language condition evaluated by the AI against the command's context (name, arguments, etc.). If the AI determines the condition is met, the command runs without a prompt.
- If 'false' or not provided, the user will always be prompted for confirmation.`,
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    extensions: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^\\.[a-z0-9\\.]+$',
      },
      description: `File extensions that the tool should consider for code generation and analysis.\\nExamples: ['.js', '.ts', '.tsx', '.md'], ['.py', '.go', '.java'], ['.c', '.h', '.cpp']`,
    },
    ignorePaths: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: `Directories and files that should be excluded from code analysis and generation:\\nExamples: ['node_modules', 'dist', 'build'], ['coverage', '.vscode', '.github']`,
    },
    popularDependencies: {
      type: 'object',
      description:
        'Configuration for the popular dependencies feature, which automatically includes frequently used files in the context.',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the popular dependencies feature. Defaults to true.',
        },
        threshold: {
          type: 'number',
          description:
            'The minimum number of times a file must be depended on to be considered popular. Defaults to 20.',
        },
      },
      additionalProperties: false,
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
              description: `Model to use when cheap flag is enabled for OpenAI compatible service.\\nExample: ['gpt-4o-mini']`,
            },
            default: {
              type: 'string',
              description: `Default model to use for OpenAI compatible service. Example: ['gpt-4o']`,
            },
            outputTokenLimit: {
              type: 'number',
              description: `Maximum number of tokens to generate in the output for OpenAI compatible service.\\nDefaults vary by service (e.g., 8192).`,
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
              description: `Maximum number of tokens to generate in the output for Anthropic service.\\nDefaults vary by service (e.g., 8192).`,
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
          description: `Maximum number of tokens to generate in the output for Vertex AI service.\\nDefaults vary by service (e.g., 8192).`,
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
              description: `Maximum number of tokens to generate in the output for AI Studio service.\\nDefaults vary by service (e.g., 8192).`,
            },
          },
        },
      },
    },
    plugins: {
      type: 'array',
      description:
        'Plugins to load. Each item can be a string path to a plugin module or an inline object. Inline plugin objects are supported only in JavaScript/TypeScript config files (genaicode.config.{js,ts,mjs,mts}). For .genaicoderc (JSON), use string paths.',
      items: {
        oneOf: [
          {
            type: 'string',
            description: 'A file path to a plugin module (e.g., "./plugins/my-plugin.js").',
          },
          {
            type: 'object',
            description: 'Inline plugin object (JS/TS config only). Resembles the Plugin type.',
            properties: {
              name: { type: 'string', description: 'Plugin name.' },
              aiServices: {
                type: 'object',
                description: 'Map of AI services exposed by the plugin.',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    generateContent: {
                      description:
                        'Function (JS/TS only): generateContent(prompt, config, options) => Promise<GenerateContentResult>',
                    },
                    serviceConfig: {
                      type: 'object',
                      description: 'Service configuration object.',
                      additionalProperties: true,
                    },
                  },
                  required: ['serviceConfig'],
                  additionalProperties: false,
                },
              },
              operations: {
                type: 'object',
                description: 'Map of operations contributed by the plugin.',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    executor: { description: 'Function (JS/TS only): executor(args, options) => Promise<void>' },
                    def: {
                      type: 'object',
                      description: 'Function definition describing the operation.',
                      properties: {
                        name: { type: 'string' },
                        description: { type: 'string' },
                        parameters: {
                          type: 'object',
                          description: 'JSON schema-like parameters definition.',
                          properties: {
                            type: { type: 'string', enum: ['object'] },
                            properties: { type: 'object', additionalProperties: true },
                            required: { type: 'array', items: { type: 'string' } },
                          },
                          required: ['type', 'properties', 'required'],
                          additionalProperties: false,
                        },
                      },
                      required: ['name', 'description', 'parameters'],
                      additionalProperties: false,
                    },
                  },
                  required: ['def'],
                  additionalProperties: false,
                },
              },
              actionHandlers: {
                type: 'object',
                description: 'Map of action handlers added by the plugin.',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    handler: { description: 'Function (JS/TS only): handler(...)' },
                    description: { type: 'string' },
                  },
                  required: ['description'],
                  additionalProperties: false,
                },
              },
              generateContentHook: {
                description: 'Function (JS/TS only): hook executed on each generateContent call.',
              },
              planningPreHook: {
                description: 'Function (JS/TS only): hook to modify the planning prompt before execution.',
              },
              planningPostHook: {
                description: 'Function (JS/TS only): hook to post-process the planning result.',
              },
              profiles: {
                type: 'array',
                description: 'Project profiles contributed by the plugin (optional).',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    extensions: { type: 'array', items: { type: 'string' } },
                    ignorePaths: { type: 'array', items: { type: 'string' } },
                    detectionWeight: { type: 'number' },
                    detect: { description: 'Function (JS/TS only): async detect(rootDir) => Promise<boolean>' },
                    initialize: { description: 'Function (JS/TS only): async initialize(rootDir) => Promise<void>' },
                  },
                  required: ['id', 'name', 'extensions', 'ignorePaths', 'detectionWeight'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
            required: ['name'],
          },
        ],
      },
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

export function validateRcConfig(rcConfig: RcConfig) {
  const validator = new Validator();
  const result = validator.validate(rcConfig, GENAICODERC_SCHEMA);
  if (!result.valid) {
    throw new Error(`Invalid .genaicoderc configuration: ${result.errors.map((e) => e.stack).join('\\n')}`);
  }
}
