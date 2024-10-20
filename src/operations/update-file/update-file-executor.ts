import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { UpdateFileArgs, updateFileDef } from './update-file-def.js';

async function executeUpdateFile(args: UpdateFileArgs) {
  const { filePath, newContent } = args;

  assert(filePath, 'filePath must not be empty');
  assert(newContent, 'newContent must not be empty');

  const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(rcConfig.rootDir, filePath);

  if (!isProjectPath(absoluteFilePath)) {
    console.log(`Skipping file: ${absoluteFilePath}`);
    throw new Error(`File ${absoluteFilePath} is not located inside project directory, something is wrong?`);
  }

  console.log(`Updating file: ${absoluteFilePath}`);
  assert(fs.existsSync(absoluteFilePath), 'File does not exist');

  fs.writeFileSync(absoluteFilePath, newContent, 'utf-8');
}

export const executor = executeUpdateFile;
export const def = updateFileDef;
