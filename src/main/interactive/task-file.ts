import fileSelector from 'inquirer-file-selector';
import { rcConfig } from '../config.js';

export async function runTaskFile(): Promise<string | null> {
  try {
    const taskFile = await fileSelector({
      message: 'Select task file:',
      path: rcConfig.rootDir,
      allowCancel: true,
    });

    if (taskFile === 'canceled') {
      console.log('Task file selection cancelled. Returning to main menu...');
      return null;
    } else if (taskFile) {
      console.log(`Selected task file: ${taskFile}`);
      return taskFile;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error selecting task file:', error);
    throw error;
  }
}
