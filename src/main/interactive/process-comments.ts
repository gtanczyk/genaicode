import fs from 'fs';
import { getSourceFiles } from '../../files/find-files.js';
import { CODEGEN_TRIGGER } from '../../prompt/prompt-consts.js';
import { CodegenOptions } from '../codegen-types.js';
import { runCodegenWorker } from './codegen-worker.js';

// Function to check for CODEGEN comments in source files
const checkForCodegenComments = (): boolean => {
  try {
    const sourceFiles = getSourceFiles();
    return sourceFiles.some((file) => {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        return content.includes(CODEGEN_TRIGGER);
      } catch (error) {
        console.error(`Error reading file ${file}:`, error);
        return false;
      }
    });
  } catch (error) {
    console.error('Error getting source files:', error);
    return false;
  }
};

export async function runProcessComments(options: CodegenOptions): Promise<void> {
  try {
    const hasCodegenComments = checkForCodegenComments();
    if (!hasCodegenComments) {
      console.warn(`Warning: No ${CODEGEN_TRIGGER} comments found in the source code.`);
    }

    console.log(`Processing ${CODEGEN_TRIGGER} comments...`);

    await runCodegenWorker(options);
  } catch (error) {
    console.error('Error in runProcessComments:', error);
    return Promise.reject(error);
  }
}
