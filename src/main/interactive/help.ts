import { printHelpMessage } from '../../cli/cli-options.js';

export function displayHelp() {
  console.log('Genaicode Interactive Mode Help');
  console.log('===============================');
  console.log('This interactive mode allows you to use Genaicode with various options.');
  console.log('Here are the available actions:');
  console.log('');
  console.log('1. Enter a text prompt: Provide a custom prompt for code generation.');
  console.log('2. Select a task file: Choose a file containing a task description.');
  console.log('3. Process @CODEGEN comments: Analyze and process @CODEGEN comments in your codebase.');
  console.log('4. Select AI service: Choose the AI model for code generation.');
  console.log('5. Configuration: Modify various options for code generation.');
  console.log('6. Print help: Display this help message.');
  console.log('7. Exit: Quit the interactive mode.');
  console.log('');
  console.log('For more detailed information about CLI options, see below:');
  console.log('');

  // Print the CLI help message
  printHelpMessage();
}
