import assert from 'node:assert';
import { verifyCodegenPromptLimit } from './limits.js';
import { CodegenOptions } from '../main/codegen-types.js';

export interface CodegenPrompt {
  prompt: string;
  options: CodegenOptions;
}

/** Get codegen prompt */
export function getCodeGenPrompt(options: CodegenOptions): CodegenPrompt {
  let { explicitPrompt } = options;
  const { taskFile, verbose } = options;

  assert(!explicitPrompt || !taskFile, 'Both taskFile and explicitPrompt are not allowed');

  if (taskFile) {
    explicitPrompt = `I want you to perform a coding task. The task is described in the ${taskFile} file. Use those instructions.`;
  }

  assert(explicitPrompt, 'No taskFile or explicitPrompt provided');

  const taskPrompt = explicitPrompt;

  if (verbose) {
    console.log('Code gen prompt:');
    console.log(taskPrompt);
  }

  verifyCodegenPromptLimit(taskPrompt);

  return { prompt: taskPrompt, options };
}

/** Get lint fix prompt */
export function getLintFixPrompt(command: string, { verbose }: CodegenOptions, stdout: string, stderr: string): string {
  const lintFixPrompt = `The following lint errors were encountered after the initial code generation:

Lint command: ${command}
Lint command stdout:

\`\`\`
${stdout}
\`\`\`

Lint command stderr:

\`\`\`
${stderr}
\`\`\`

Please suggest changes to fix these lint errors. Use the 'sendMessage' actionType if you need any clarifications before proposing fixes.`;

  if (verbose) {
    console.log('Lint fix prompt:');
    console.log(lintFixPrompt);
  }

  verifyCodegenPromptLimit(lintFixPrompt);

  return lintFixPrompt;
}
