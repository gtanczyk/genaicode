import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import * as diff from 'diff';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { PatchFileArgs, patchFileDef } from './patch-file-def.js';

async function executePatchFile(args: PatchFileArgs) {
  const { filePath, patch } = args;

  assert(filePath, 'filePath must not be empty');
  assert(patch, 'patch must not be empty');

  const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(rcConfig.rootDir, filePath);

  if (!isProjectPath(absoluteFilePath)) {
    console.log(`Skipping file: ${absoluteFilePath}`);
    throw new Error(`File ${absoluteFilePath} is not located inside project directory, something is wrong?`);
  }

  console.log(`Applying a patch: ${absoluteFilePath} content`);
  assert(fs.existsSync(absoluteFilePath), 'File does not exist');

  const originalContent = fs.readFileSync(absoluteFilePath, 'utf-8');
  const newContent = diff.applyPatch(originalContent, patch);

  assert(newContent !== false, 'Patch was not successful');

  fs.writeFileSync(absoluteFilePath, newContent, 'utf-8');
}

export const executor = executePatchFile;
export const def = patchFileDef;
