import fileSelector from 'inquirer-file-selector';
import { runCodegenIteration } from '../codegen.js';
import { rcConfig } from '../config.js';
import { CodegenOptions } from '../codegen-types.js';

export async function runTaskFile(options: CodegenOptions) {
  const taskFile = await fileSelector({
    message: 'Select task file:',
    path: rcConfig.rootDir,
  });
  if (taskFile) {
    console.log(`Selected task file: ${taskFile}`);
    await runCodegenIteration({ ...options, taskFile });
  } else {
    console.log('No task file selected.');
  }
}
