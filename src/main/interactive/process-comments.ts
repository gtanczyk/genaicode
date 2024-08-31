import fs from 'fs';
import { getSourceFiles } from '../../files/find-files.js';
import { CODEGEN_TRIGGER } from '../../prompt/prompt-consts.js';
import { runCodegenIteration } from '../codegen.js';
import { CodegenOptions } from '../codegen-types.js';

// Function to check for CODEGEN comments in source files
export const checkForCodegenComments = (): boolean => {
  const sourceFiles = getSourceFiles();
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes(CODEGEN_TRIGGER)) {
      return true;
    }
  }
  return false;
};

export async function runProcessComments(options: CodegenOptions) {
  const hasCodegenComments = checkForCodegenComments();
  if (!hasCodegenComments) {
    console.warn(`Warning: No ${CODEGEN_TRIGGER} comments found in the source code.`);
  }

  console.log(`Processing ${CODEGEN_TRIGGER} comments...`);
  await runCodegenIteration({ ...options, considerAllFiles: false });
}
