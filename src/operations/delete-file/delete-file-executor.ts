import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { DeleteFileArgs, deleteFileDef } from './delete-file-def.js';
import { CodegenOptions } from '../../main/codegen-types.js';

async function executeDeleteFile(args: DeleteFileArgs, options: CodegenOptions) {
  const { filePath } = args;
  const { allowFileDelete } = options;

  assert(filePath, 'filePath must not be empty');

  const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(rcConfig.rootDir, filePath);

  if (!isProjectPath(absoluteFilePath)) {
    console.log(`Skipping file: ${absoluteFilePath}`);
    throw new Error(`File ${absoluteFilePath} is not located inside project directory, something is wrong?`);
  }

  assert(allowFileDelete, 'File delete option was not enabled');
  assert(fs.existsSync(absoluteFilePath), 'File does not exist');

  console.log(`Removing file: ${absoluteFilePath}`);
  fs.unlinkSync(absoluteFilePath);
}

export const executor = executeDeleteFile;
export const def = deleteFileDef;
