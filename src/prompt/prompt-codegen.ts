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
  } = options;

  assert(!explicitPrompt || !taskFile, 'Both taskFile and explicitPrompt are not allowed');

  if (taskFile) {
    explicitPrompt = `I want you to perform a coding task. The task is described in the ${taskFile} file. Use those instructions.`;
  }

  let codeGenFiles: string[];
  if (considerAllFiles) {
    codeGenFiles = Object.keys(getSourceCode({ taskFile, forceAll: true }, options));
  } else {
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
  const requestPermissionText = askQuestion && interactive ? ' (request permission via `askQuestion`)' : '';

  const codeGenPrompt =
    (explicitPrompt ? 'This is your task: ' + explicitPrompt + '\n\n' : '') +
    `${
      considerAllFiles
        ? codeGenFiles.length > 0
          ? `I have marked some files with the ${CODEGEN_TRIGGER} fragments:\n${codeGenFiles.join('\n')}`
          : `No files are marked with ${CODEGEN_TRIGGER} fragment, so you can consider doing changes in any file.`
        : codeGenFiles.length > 0
          ? `Generate updates only for the following files:\n${codeGenFiles.join('\n')}\n`
          : ''
    }
My additional requirements for task execution are:
${importantTextPrompts ? `${importantTextPrompts}\n` : ''}
${
  considerAllFiles
    ? 'You are allowed to modify all files in the application regardless if they contain codegen fragments or not.'
    : 'Do not modify files which do not contain the fragments.'
}
${allowFileCreate ? 'You are allowed to create new files.' : 'Do not create new files. (request permission via `askQuestion`)'}
${
  allowFileDelete
    ? 'You are allowed to delete files, in such case add empty string as content.'
    : 'Do not delete files. (request permission via `askQuestion`)'
}
${allowDirectoryCreate ? 'You are allowed to create new directories.' : `Do not create new directories.${requestPermissionText}`}
${allowFileMove ? 'You are allowed to move files.' : 'Do not move files. (request permission via `askQuestion`)'}
${vision ? 'You are allowed to analyze image assets.' : 'Do not analyze image assets. (request permission via `askQuestion`)'}
${imagen ? 'You are allowed to generate images.' : 'You are not allowed to generate images. (request permission via `askQuestion`)'}
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
