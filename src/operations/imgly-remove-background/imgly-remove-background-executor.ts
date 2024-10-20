import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { ImglyRemoveBackgroundArgs, imglyRemoveBackgroundDef } from './imgly-remove-background-def.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { imglyRemoveBackground } from '../../images/imgly-remove-background.js';

async function executeImglyRemoveBackground(args: ImglyRemoveBackgroundArgs, options: CodegenOptions) {
  const { inputFilePath, outputFilePath } = args;
  const { allowFileCreate, allowDirectoryCreate } = options;

  assert(inputFilePath, 'inputFilePath must not be empty');
  assert(outputFilePath, 'outputFilePath must not be empty');

  const absoluteInputFilePath = path.isAbsolute(inputFilePath)
    ? inputFilePath
    : path.join(rcConfig.rootDir, inputFilePath);
  const absoluteOutputFilePath = path.isAbsolute(outputFilePath)
    ? outputFilePath
    : path.join(rcConfig.rootDir, outputFilePath);

  if (!isProjectPath(absoluteInputFilePath) || !isProjectPath(absoluteOutputFilePath)) {
    console.log(`Skipping background removal: ${absoluteInputFilePath} to ${absoluteOutputFilePath}`);
    throw new Error(`File paths are not located inside project directory, something is wrong?`);
  }

  assert(fs.existsSync(absoluteInputFilePath), 'Input file does not exist');
  assert(
    allowFileCreate || fs.existsSync(absoluteOutputFilePath),
    'File create option was not enabled and output file does not exist',
  );

  if (allowDirectoryCreate) {
    fs.mkdirSync(path.dirname(absoluteOutputFilePath), { recursive: true });
  }

  console.log(`Removing background from image: ${absoluteInputFilePath}`);

  try {
    await imglyRemoveBackground(absoluteInputFilePath, absoluteOutputFilePath);
    console.log(`Background removed and image saved to: ${absoluteOutputFilePath}`);
  } catch (error) {
    console.error('Failed to remove background', error);
    throw error;
  }
}

export const executor = executeImglyRemoveBackground;
export const def = imglyRemoveBackgroundDef;
