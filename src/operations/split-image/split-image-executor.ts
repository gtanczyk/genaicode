import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { SplitImageArgs, splitImageDef } from './split-image-def.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { splitImage } from '../../images/split-image.js';

async function executeSplitImage(args: SplitImageArgs, options: CodegenOptions) {
  const { inputFilePath, parts } = args;
  const { allowFileCreate, allowDirectoryCreate } = options;

  assert(inputFilePath, 'inputFilePath must not be empty');
  assert(Array.isArray(parts) && parts.length > 0, 'Parts array must not be empty');

  const absoluteInputFilePath = path.isAbsolute(inputFilePath)
    ? inputFilePath
    : path.join(rcConfig.rootDir, inputFilePath);

  if (!isProjectPath(absoluteInputFilePath)) {
    console.log(`Skipping image split: ${absoluteInputFilePath}`);
    throw new Error(`File ${absoluteInputFilePath} is not located inside project directory, something is wrong?`);
  }

  assert(fs.existsSync(absoluteInputFilePath), 'Input file does not exist');

  for (const part of parts) {
    const absoluteOutputFilePath = path.isAbsolute(part.outputFilePath)
      ? part.outputFilePath
      : path.join(rcConfig.rootDir, part.outputFilePath);

    if (!isProjectPath(absoluteOutputFilePath)) {
      console.log(`Skipping output file: ${absoluteOutputFilePath}`);
      throw new Error(
        `Output file ${absoluteOutputFilePath} is not located inside project directory, something is wrong?`,
      );
    }

    assert(
      allowFileCreate || fs.existsSync(absoluteOutputFilePath),
      'File create option was not enabled and output file does not exist',
    );

    if (allowDirectoryCreate) {
      fs.mkdirSync(path.dirname(absoluteOutputFilePath), { recursive: true });
    }
  }

  console.log(`Splitting image: ${absoluteInputFilePath}`);

  try {
    await splitImage(
      absoluteInputFilePath,
      parts.map((part) => ({
        outputFilePath: path.isAbsolute(part.outputFilePath)
          ? part.outputFilePath
          : path.join(rcConfig.rootDir, part.outputFilePath),
        rect: part.rect,
      })),
    );
    console.log(`Image split successfully`);
  } catch (error) {
    console.error('Failed to split image', error);
    throw error;
  }
}

export const executor = executeSplitImage;
export const def = splitImageDef;
