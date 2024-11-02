import fileSelector from 'inquirer-file-selector';
import { rcConfig } from '../config.js';
import { CodegenOptions } from '../codegen-types.js';
import { runCodegenWorker } from './codegen-worker.js';

export async function runTaskFile(options: CodegenOptions): Promise<void> {
  try {
    console.log('Entering task file selection. Press Ctrl+C to cancel.');

    const taskFile = await fileSelector({
      message: 'Select task file:',
      path: rcConfig.rootDir,
      allowCancel: true,
    });

    if (taskFile === 'canceled') {
      console.log('Task file selection cancelled.');
      return;
    } else if (taskFile) {
      console.log(`Selected task file: ${taskFile}`);
      await runCodegenWorker({ ...options, taskFile });
      console.log('Task file processing completed.');
    } else {
      console.log('No task file selected.');
      return;
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Canceled') {
      console.log('Task file selection cancelled.');
      return;
    }
    console.error('Error selecting or processing task file:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}
