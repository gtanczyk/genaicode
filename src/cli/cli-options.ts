// CLI options and their descriptions
interface CliOption {
  name: string;
  description: string;
}

const cliOptions: CliOption[] = [
  {
    name: '--help',
    description: 'Display this help message.',
  },
  {
    name: '--dry-run',
    description: 'Run the codegen script without updating the source code.',
  },
  {
    name: '--disallow-file-create',
    description: 'Disallow the codegen script to create new files (file creation is allowed by default).',
  },
  {
    name: '--disallow-file-delete',
    description: 'Disallow the codegen script to delete files (file deletion is allowed by default).',
  },
  {
    name: '--disallow-directory-create',
    description: 'Disallow codegen script to create directories (directory creation is allowed by default).',
  },
  {
    name: '--disallow-file-move',
    description: 'Disallow the codegen script to move files (file moving is allowed by default).',
  },
  {
    name: '--ai-service=<service>',
    description:
      'Specify the AI service to use for code generation. Available options include vertex-ai, ai-studio, openai, anthropic, vertex-ai-claude, local-llm, and any additional services loaded from plugins.',
  },
  {
    name: '--explicit-prompt=<prompt>',
    description: 'An explicit prompt to use for code generation.',
  },
  {
    name: '--task-file=<file>',
    description: 'Specifies a file with a task description for code generation.',
  },
  {
    name: '--verbose-prompt',
    description: 'Print the prompt used for code generation.',
  },
  {
    name: '--disable-explanations',
    description: 'Disable requirement of explanations for all code generation operations.',
  },
  {
    name: '--disable-context-optimization',
    description: 'Disable the optimization that uses context paths for more efficient code generation.',
  },
  {
    name: '--gemini-block-none',
    description: 'Disable safety settings for Gemini Pro model (requires whitelisted Cloud project).',
  },
  {
    name: '--temperature=<value>',
    description: 'Set the temperature parameter for the AI model (default: 0.7).',
  },
  {
    name: '--vision',
    description:
      'Enable vision capabilities for processing image inputs. This option allows the tool to analyze and generate code based on image content when used with compatible AI models.',
  },
  {
    name: '--imagen=<service>',
    description:
      'Enable image generation functionality and specify the service to use (either "vertex-ai" or "dall-e").',
  },
  {
    name: '--cheap',
    description: 'Switch to cheaper models in AI services for content and image generation.',
  },
  {
    name: '--content-mask=<path>',
    description:
      'Apply a content mask to limit the initial source code files included in the request. The value should be a prefix of the path relative to rootDir.',
  },
  {
    name: '--ignore-pattern=<pattern>',
    description: 'Specify a pattern of files to ignore during the initial source code fetching.',
  },
  {
    name: '--disable-cache',
    description: 'Disable caching for the application.',
  },
  {
    name: '--disable-ask-question',
    description:
      'Disable the question-asking feature. By default, the assistant can ask questions for clarification during the code generation process.',
  },
  {
    name: '--disable-vertex-unescape',
    description: 'Disable the unescaping of special characters in Vertex AI responses.',
  },
  {
    name: '--disable-conversation-summary',
    description: 'Disable the summary generation feature of the AI model.',
  },
  {
    name: '--ui',
    description: 'Run the tool as a web server, and use it via browser.',
  },
  {
    name: '--ui-port=<port>',
    description: 'Specify the port for the web server when using --ui (default: 1337).',
  },
];

/**
 * Print the help message with all available CLI options
 */
export function printHelpMessage(): void {
  console.log('GenAIcode - AI-powered code generation tool');
  console.log('\nUsage: npx genaicode [options]');
  console.log('\nOptions:');

  cliOptions.forEach((option) => {
    console.log(`  ${option.name.padEnd(30)} ${option.description}`);
  });

  console.log('\nFor more information, please refer to the project home page: https://github.com/gtanczyk/genaicode/');
}

export { cliOptions };
