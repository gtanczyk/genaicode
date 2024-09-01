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

// Helper function to validate if a file exists
export async function validateTaskFile(filePath: string): Promise<boolean> {
  try {
    const taskFile = await fileSelector({
      message: 'Confirm task file:',
      path: filePath,
    });
    return !!taskFile;
  } catch (error) {
    console.error('Error validating task file:', error);
    return false;
  }
}

// Helper function to get the file name from a path
export function getTaskFileName(filePath: string): string {
  return filePath.split('/').pop() || '';
}
