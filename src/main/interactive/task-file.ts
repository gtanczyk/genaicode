import fileSelector from 'inquirer-file-selector';
import { rcConfig } from '../config.js';
import { CodegenOptions } from '../codegen-types.js';
import { runCodegenWorker } from './codegen-worker.js';

export async function runTaskFile(options: CodegenOptions): Promise<void> {
  try {
    const taskFile = await fileSelector({
      message: 'Select task file:',
      path: rcConfig.rootDir,
      allowCancel: true,
    });

    if (taskFile === 'canceled') {
      console.log('Task file selection cancelled. Returning to main menu...');
      return;
    } else if (taskFile) {
      console.log(`Selected task file: ${taskFile}`);
      await runCodegenWorker({ ...options, taskFile, considerAllFiles: true });
    } else {
      return;
    }
  } catch (error) {
    console.error('Error selecting task file:', error);
    throw error;
  }
}
