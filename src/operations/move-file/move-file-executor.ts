import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { MoveFileArgs, moveFileDef } from './move-file-def.js';
import { CodegenOptions } from '../../main/codegen-types.js';

async function executeMoveFile(args: MoveFileArgs, options: CodegenOptions) {
  const { source, destination } = args;
  const { allowFileMove, allowDirectoryCreate } = options;

  assert(source, 'source must not be empty');
  assert(destination, 'destination must not be empty');

  const absoluteSource = path.isAbsolute(source) ? source : path.join(rcConfig.rootDir, source);
  const absoluteDestination = path.isAbsolute(destination) ? destination : path.join(rcConfig.rootDir, destination);

  if (!isProjectPath(absoluteSource) || !isProjectPath(absoluteDestination)) {
    console.log(`Skipping file move: ${absoluteSource} to ${absoluteDestination}`);
    throw new Error(`File move operation is not within the project directory, something is wrong?`);
  }

  assert(allowFileMove, 'File move option was not enabled');
  assert(fs.existsSync(absoluteSource), 'Source file does not exist');
  assert(!fs.existsSync(absoluteDestination), 'Destination file already exists');

  console.log(`Moving file from ${absoluteSource} to ${absoluteDestination}`);

  if (allowDirectoryCreate) {
    fs.mkdirSync(path.dirname(absoluteDestination), { recursive: true });
  }

  fs.renameSync(absoluteSource, absoluteDestination);
}

export const executor = executeMoveFile;
export const def = moveFileDef;
