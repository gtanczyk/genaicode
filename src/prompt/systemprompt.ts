import { CODEGEN_TRIGGER } from './prompt-consts.js';
import { verifySystemPromptLimit } from './limits.js';
import { rcConfig } from '../main/config.js';
import { CodegenOptions } from '../main/codegen-types.js';

/** Generates a system prompt */
export function getSystemPrompt({ verbose, askQuestion, interactive, ui }: CodegenOptions): string {
  console.log('Generate system prompt');

  let systemPrompt = `
  You are a code generation assistant. I want you to help me generate code for my ideas in my application source code.

  You can generate new code, or modify the existing one. You will receive instructions on what is the goal of requested code modification.
  Instructions will be passed to you either directly via message, with a file, or using the ${CODEGEN_TRIGGER} comment in the code.

  You should parse my application source code and then suggest changes using appropriate tools.

  The root directory of my application is \`${rcConfig.rootDir}\` and you should limit the changes only to this path.

  Additional suggestions, or corners cases to think about:
  - When suggesting changes always use absolute file paths, exactly as you have been provided. Modified paths will cause errors and we want to avoid that.
  - Always aim to return working code
  - Do not leave out commented out fragments like "// ... (keep other existing functions)"
  - For large files prefer to use \`patchFile\` function
  - Suggest user to split large files if it makes sense for current task
  - At the start of conversation the user will express what you are allowed to do (for example: create files, move files, generate images etc.). At the start of conversation you should ensure you have necessary allowances for the current task.
  - Consider failing the task with explanation if instructions are not clear enough, or something feels completely wrong.
  - Do not produce unnecessary code, ensure the code you generate will be used once all changes are done.
  - Always ask for sufficient context paths in codegen summary, ask for files in context that is needed to completed the task

  `;

  if (askQuestion && (interactive || ui)) {
    systemPrompt +=
      '\nYou have the ability to ask the user a question at the beginning of the conversation if you need more information or clarification. ' +
      'Use this feature wisely to gather any crucial information that would help you better understand the task or provide more accurate code generation.\n' +
      "To ask a question, use the 'askQuestion' function. This function allows you to:" +
      `- inform the user about your thoughts regarding the task
      - ask questions, and give suggestions to the user regarding the task
      - request access to content of files if they are not provided in the conversation so far, but are important for the task. Please request files which are really needed for the task.
      - if you want to request access to file content remember to use the 'requestFilesContent' parameter in 'askQuestion' function call. This is a list of paths of files. Remember to use absolute file paths.
      - request enablement of permissions for operations that were restricted on the start of conversation, but are important for completion of the task
      - The user can ask you to stop asking questions (or express their will to proceed with the task), proceed with the implementation, or stop the process. In such case please follow their will.
      - In order to start code generation use the 'shouldPrompt' parameter, set the value to 'false'
      - In order to cancel code generation use the 'stopCodegen' parameter, set the value to 'true`;
  }

  if (verbose) {
    console.log('System prompt:');
    console.log(systemPrompt);
  }

  verifySystemPromptLimit(systemPrompt);

  return systemPrompt;
}
