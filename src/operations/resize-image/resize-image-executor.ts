import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { ResizeImageArgs, resizeImageDef } from './resize-image-def.js';
import { resizeImageFile } from '../../images/resize-image.js';

async function executeResizeImage(args: ResizeImageArgs) {
  const { filePath, size } = args;

  assert(filePath, 'filePath must not be empty');
  assert(size && size.width && size.height, 'size with width and height must be provided');

  const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(rcConfig.rootDir, filePath);

  if (!isProjectPath(absoluteFilePath)) {
    console.log(`Skipping image resize: ${absoluteFilePath}`);
    throw new Error(`File ${absoluteFilePath} is not located inside project directory, something is wrong?`);
  }

  assert(fs.existsSync(absoluteFilePath), 'Input file does not exist');

  console.log(`Resizing image: ${absoluteFilePath}`, size);

  try {
    await resizeImageFile(absoluteFilePath, { width: size.width, height: size.height });
    console.log(`Image resized successfully`);
  } catch (error) {
    console.error('Failed to resize image', error);
    throw error;
  }
}

export const executor = executeResizeImage;
export const def = resizeImageDef;
