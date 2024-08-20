import assert from 'node:assert';
import { getSourceCode } from '../files/read-files.js';
import { CODEGEN_TRIGGER } from './prompt-consts.js';
import {
  considerAllFiles,
  allowFileCreate,
  allowFileDelete,
  allowDirectoryCreate,
  allowFileMove,
  explicitPrompt,
  dependencyTree,
  verbosePrompt,
  vision,
  imagen,
} from '../cli/cli-params.js';
import { getDependencyList } from '../files/find-files.js';
import { verifyCodegenPromptLimit } from './limits.js';

interface SourceCodeEntry {
  content?: string;
}

/** Get codegen prompt */
export function getCodeGenPrompt(): string {
  let codeGenFiles: string[];
  if (considerAllFiles) {
    codeGenFiles = Object.keys(getSourceCode());
  } else {
    codeGenFiles = Object.entries(getSourceCode() as Record<string, SourceCodeEntry>)
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

  const codeGenPrompt =
    (explicitPrompt ? explicitPrompt + '\n\n' : '') +
    `${
      considerAllFiles
        ? codeGenFiles.length > 0
          ? `I have marked some files with the ${CODEGEN_TRIGGER} fragments:\n${codeGenFiles.join('\n')}`
          : `No files are marked with ${CODEGEN_TRIGGER} fragment, so you can consider doing changes in any file.`
        : `Generate updates only for the following files:\n${codeGenFiles.join('\n')}`
    }

${
  considerAllFiles
    ? 'You are allowed to modify all files in the application regardless if they contain codegen fragments or not.'
    : 'Do not modify files which do not contain the fragments.'
}
${allowFileCreate ? 'You are allowed to create new files.' : 'Do not create new files.'}
${
  allowFileDelete
    ? 'You are allowed to delete files, in such case add empty string as content.'
    : 'Do not delete files.'
}
${allowDirectoryCreate ? 'You are allowed to create new directories.' : 'Do not create new directories.'}
${allowFileMove ? 'You are allowed to move files.' : 'Do not move files.'}
${vision ? 'You are allowed to analyze image assets.' : 'Do not analyze image assets.'}
${imagen ? 'You are allowed to generate images.' : 'You are not allowed to generate images.'}
`;

  if (verbosePrompt) {
    console.log('Code gen prompt:');
    console.log(codeGenPrompt);
  }

  verifyCodegenPromptLimit(codeGenPrompt);

  return codeGenPrompt;
}

/** Get lint fix prompt */
export function getLintFixPrompt(command: string, stdout: string, stderr: string): string {
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

  if (verbosePrompt) {
    console.log('Lint fix prompt:');
    console.log(lintFixPrompt);
  }

  verifyCodegenPromptLimit(lintFixPrompt);

  return lintFixPrompt;
}
