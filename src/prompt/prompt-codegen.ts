import assert from 'node:assert';
import { getSourceCode } from '../files/read-files.js';
import { CODEGEN_TRIGGER } from './prompt-consts.js';
import { getDependencyList } from '../files/find-files.js';
import { verifyCodegenPromptLimit } from './limits.js';
import { importantContext } from '../main/config.js';
import { CodegenOptions } from '../main/codegen-types.js';

interface SourceCodeEntry {
  content?: string;
}

export interface CodegenPrompt {
  prompt: string;
  options: CodegenOptions;
}

/** Get codegen prompt */
export function getCodeGenPrompt(options: CodegenOptions): CodegenPrompt {
  let { explicitPrompt } = options;
  const {
    taskFile,
    considerAllFiles,
    allowFileCreate,
    allowFileDelete,
    allowDirectoryCreate,
    allowFileMove,
    vision,
    imagen,
    dependencyTree,
    verbose,
    askQuestion,
    interactive,
    ui,
  } = options;

  assert(!explicitPrompt || !taskFile, 'Both taskFile and explicitPrompt are not allowed');

  if (taskFile) {
    explicitPrompt = `I want you to perform a coding task. The task is described in the ${taskFile} file. Use those instructions.`;
  }

  let codeGenFiles: string[] = [];
  if (!considerAllFiles) {
    codeGenFiles = Object.entries(
      getSourceCode({ taskFile, forceAll: true }, options) as Record<string, SourceCodeEntry>,
    )
      .filter(([, { content }]) => content?.match(new RegExp(`([^'^\`]+)${CODEGEN_TRIGGER}`)))
      .map(([path]) => path);
  }

  // Add logic to consider dependency tree
  if (dependencyTree) {
    assert(codeGenFiles.length > 0, `You must use ${CODEGEN_TRIGGER} together with --dependency-tree`);

    const dependencyTreeFiles = new Set<string>();
    codeGenFiles
      .map(getDependencyList)
      .flat()
      .forEach((key) => dependencyTreeFiles.add(key));
    codeGenFiles = Array.from(dependencyTreeFiles);
  }

  const importantTextPrompts = importantContext.textPrompts?.map((prompt) => prompt.content).join('\n\n') || '';
  const requestPermissionText = askQuestion && (interactive || ui) ? ' (request permission via `askQuestion`)' : '';

  const taskPrompt = explicitPrompt
    ? 'This is your task: ' + explicitPrompt + '\n\n'
    : codeGenFiles.length > 0
      ? `I have marked some files with the ${CODEGEN_TRIGGER} fragments:\n${codeGenFiles.join(
          '\n',
        )}\nYour task is to generate updates for those files according to the ${CODEGEN_TRIGGER} comments/context.`
      : `No files are marked with the ${CODEGEN_TRIGGER} fragment, so you can consider making changes in any file${
          askQuestion ? ', but you should consult me by asking a question first.' : ''
        }.`;

  const codeGenPrompt = `${taskPrompt}

Before proceeding with code generation, please:

1. **Analyze the task and requirements**.

2. **Use the \`askQuestion\` function** to seek clarification if needed, and eventually make a decision whether to start code generation, or to interrupt it.

3. **Summarize the plan of updates** by calling the \`codegenSummary\` function with the appropriate arguments.

   - Ensure that you include:
     - **\`explanation\`**: A brief description of the planned changes or reasoning for no changes.
     - **\`fileUpdates\`**: A list of proposed file updates, each with required properties:
       - **\`path\`**: Absolute file path to be updated.
       - **\`updateToolName\`**: The tool to be used for the update (e.g., \`createFile\`, \`updateFile\`).
       - **\`prompt\`**: A detailed prompt summarizing the planned changes for this file.
       - **Other Properties**: Include any other necessary properties as per the \`codegenSummary\` function definition.
     - **\`contextPaths\`**: A list of file paths that should be used as context for the code generation requests.

## My Requirements for Task Execution:

${importantTextPrompts ? `${importantTextPrompts}\n` : ''}
${
  considerAllFiles
    ? 'You are allowed to modify all files in the application regardless of whether they contain codegen fragments.'
    : 'Do not modify files which do not contain the fragments.'
}
${allowFileCreate ? 'You are allowed to create new files.' : 'Do not create new files. (request permission via `askQuestion`)'}
${
  allowFileDelete
    ? 'You are allowed to delete files; in such cases, add an empty string as content.'
    : 'Do not delete files. (request permission via `askQuestion`)'
}
${
  allowDirectoryCreate
    ? 'You are allowed to create new directories.'
    : `Do not create new directories.${requestPermissionText}`
}
${allowFileMove ? 'You are allowed to move files.' : 'Do not move files. (request permission via `askQuestion`)'}
${vision ? 'You are allowed to analyze image assets.' : 'Do not analyze image assets. (request permission via `askQuestion`)'}
${
  imagen
    ? 'You are allowed to generate images.'
    : 'You are not allowed to generate images. (request permission via `askQuestion`)'
}
`;

  if (verbose) {
    console.log('Code gen prompt:');
    console.log(codeGenPrompt);
  }

  verifyCodegenPromptLimit(codeGenPrompt);

  return { prompt: codeGenPrompt, options };
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

Please suggest changes to fix these lint errors.`;

  if (verbose) {
    console.log('Lint fix prompt:');
    console.log(lintFixPrompt);
  }

  verifyCodegenPromptLimit(lintFixPrompt);

  return lintFixPrompt;
}
