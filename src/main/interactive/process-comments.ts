import fs from 'fs';
import { getSourceFiles } from '../../files/find-files.js';
import { CODEGEN_TRIGGER } from '../../prompt/prompt-consts.js';

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

const logCodegenCommentsWarning = (): void => {
  console.warn(`Warning: No ${CODEGEN_TRIGGER} comments found in the source code.`);
};

const logProcessingStart = (): void => {
  console.log(`Processing ${CODEGEN_TRIGGER} comments...`);
};

export async function runProcessComments(): Promise<void> {
  try {
    const hasCodegenComments = checkForCodegenComments();

    if (!hasCodegenComments) {
      logCodegenCommentsWarning();
    }

    logProcessingStart();

    // Here, you would typically call the function to process the comments
    // For example: await processCodegenComments();

    // Since the actual processing is handled elsewhere, we'll just resolve the promise
    return Promise.resolve();
  } catch (error) {
    console.error('Error in runProcessComments:', error);
    return Promise.reject(error);
  }
}
