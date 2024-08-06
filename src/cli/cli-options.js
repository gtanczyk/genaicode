// CLI options and their descriptions
const cliOptions = [
  {
    name: '--help',
    description: 'Display this help message.',
  },
  {
    name: '--dry-run',
    description: 'Run the codegen script without updating the source code.',
  },
  {
    name: '--consider-all-files',
    description: "Consider all files for code generation, even if they don't contain the @" + 'CODEGEN comments.',
  },
  {
    name: '--allow-file-create',
    description: 'Allow the codegen script to create new files.',
  },
  {
    name: '--allow-file-delete',
    description: 'Allow the codegen script to delete files.',
  },
  {
    name: '--allow-directory-create',
    description: 'Allow codegen script to create directories.',
  },
  {
    name: '--allow-file-move',
    description: 'Allow the codegen script to move files.',
  },
  {
    name: '--chat-gpt',
    description: "Use the OpenAI model for code generation instead of Vertex AI with Google's Gemini Pro model.",
  },
  {
    name: '--anthropic',
    description: "Use Anthropic's Claude model for code generation.",
  },
  {
    name: '--vertex-ai',
    description:
      "Use Vertex AI with Google's Gemini Pro model for code generation (default if no AI model is specified).",
  },
  {
    name: '--vertex-ai-claude',
    description: 'Use Claude via Vertex AI for code generation.',
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
    name: '--dependency-tree',
    description: 'Limit the scope of codegen only to files marked with @' + 'CODEGEN and their dependencies.',
  },
  {
    name: '--verbose-prompt',
    description: 'Print the prompt used for code generation.',
  },
  {
    name: '--require-explanations',
    description: 'Require explanations for all code generation operations.',
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
    name: '--disable-initial-lint',
    description: 'Skip the initial lint check before running the code generation process.',
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
];

/**
 * Print the help message with all available CLI options
 */
export function printHelpMessage() {
  console.log('GenAIcode - AI-powered code generation tool');
  console.log('\nUsage: npx genaicode [options]');
  console.log('\nOptions:');

  cliOptions.forEach((option) => {
    console.log(`  ${option.name.padEnd(30)} ${option.description}`);
  });

  console.log('\nFor more information, please refer to the project home page: https://github.com/gtanczyk/genaicode/');
}

export { cliOptions };
