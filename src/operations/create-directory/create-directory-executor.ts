import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { CreateDirectoryArgs, createDirectoryDef } from './create-directory-def.js';

async function executeCreateDirectory(args: CreateDirectoryArgs, options: CodegenOptions) {
  const { filePath } = args;
  const { allowDirectoryCreate } = options;

  assert(filePath, 'filePath must not be empty');

  const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(rcConfig.rootDir, filePath);

  if (!isProjectPath(absoluteFilePath)) {
    console.log(`Skipping directory: ${absoluteFilePath}`);
    throw new Error(`Directory ${absoluteFilePath} is not located inside project directory, something is wrong?`);
  }

  assert(allowDirectoryCreate, 'Directory create option was not enabled');

  console.log(`Creating directory: ${absoluteFilePath}`);
  fs.mkdirSync(absoluteFilePath, { recursive: true });
}

export const executor = executeCreateDirectory;
export const def = createDirectoryDef;
