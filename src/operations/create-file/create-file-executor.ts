import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { CreateFileArgs, createFileDef } from './create-file-def.js';
import { CodegenOptions } from '../../main/codegen-types.js';

async function executeCreateFile(args: CreateFileArgs, options: CodegenOptions) {
  const { filePath, newContent } = args;
  const { allowFileCreate, allowDirectoryCreate } = options;

  assert(filePath, 'filePath must not be empty');
  assert(newContent, 'newContent must not be empty');

  const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(rcConfig.rootDir, filePath);

  if (!isProjectPath(absoluteFilePath)) {
    console.log(`Skipping file: ${absoluteFilePath}`);
    throw new Error(`File ${absoluteFilePath} is not located inside project directory, something is wrong?`);
  }

  assert(allowFileCreate, 'File create option was not enabled');
  assert(!fs.existsSync(absoluteFilePath), 'File already exists');

  console.log(`Creating file: ${absoluteFilePath}`);

  if (allowDirectoryCreate) {
    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
  }

  fs.writeFileSync(absoluteFilePath, newContent, 'utf-8');
}

export const executor = executeCreateFile;
export const def = createFileDef;
