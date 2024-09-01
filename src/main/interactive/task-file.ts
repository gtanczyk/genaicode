import fileSelector from 'inquirer-file-selector';
import { rcConfig } from '../config.js';

export async function runTaskFile(): Promise<string> {
  try {
    const taskFile = await fileSelector({
      message: 'Select task file:',
      path: rcConfig.rootDir,
    });

    if (taskFile) {
      console.log(`Selected task file: ${taskFile}`);
      return taskFile;
    } else {
      throw new Error('No task file selected');
    }
  } catch (error) {
    console.error('Error selecting task file:', error);
    throw error;
  }
}
