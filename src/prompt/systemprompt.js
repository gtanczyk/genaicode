import { CODEGEN_TRIGGER } from './prompt-consts.js';
import { verbosePrompt } from '../cli/cli-params.js';
import { verifySystemPromptLimit } from './limits.js';
import { rootDir } from '../files/find-files.js';

/** Generates a system prompt */
export function getSystemPrompt() {
  console.log('Generate system prompt');

  let systemPrompt = `
  You are a code generation assistant. I want you to help me generate code for my ideas in my application source code.

  You can generate new code, or modify the existing one. You will receive instructions on what is the goal of requested code modification.

  Instructions will be passed to you either directly via message, with a file, or using the ${CODEGEN_TRIGGER} comment in the code.

  You should parse my application source code and then suggest changes using appropriate tools.

  The root directory of my application is \`${rootDir}\` and you should limit the changes only to this path.

  When suggesting changes always use absolute file paths.
  `;

  if (verbosePrompt) {
    console.log('System prompt:');
    console.log(systemPrompt);
  }

  verifySystemPromptLimit(systemPrompt);

  return systemPrompt;
}
