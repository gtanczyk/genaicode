import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { rcConfig } from '../../main/config.js';
import { isProjectPath } from '../../files/path-utils.js';
import { DownloadFileArgs, downloadFileDef } from './download-file-def.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { getTempBuffer } from '../../files/temp-buffer.js';

async function executeDownloadFile(args: DownloadFileArgs, options: CodegenOptions) {
  const { filePath, downloadUrl } = args;
  const { allowFileCreate, allowDirectoryCreate } = options;

  assert(filePath, 'filePath must not be empty');
  assert(downloadUrl, 'downloadUrl must not be empty');

  const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.join(rcConfig.rootDir, filePath);

  if (!isProjectPath(absoluteFilePath)) {
    console.log(`Skipping file download: ${absoluteFilePath}`);
    throw new Error(`File ${absoluteFilePath} is not located inside project directory, something is wrong?`);
  }

  assert(
    fs.existsSync(absoluteFilePath) || allowFileCreate,
    'File create option was not enabled and file does not exist',
  );

  if (allowDirectoryCreate) {
    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
  }

  console.log(`Downloading file: ${absoluteFilePath}`);

  try {
    if (downloadUrl.startsWith('temp://')) {
      const tempBuffer = getTempBuffer(downloadUrl);
      assert(tempBuffer, 'Temp buffer not present but expected');
      fs.writeFileSync(absoluteFilePath, tempBuffer);
    } else {
      const response = await fetch(downloadUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(absoluteFilePath, buffer);
    }
    console.log(`File downloaded and saved to: ${absoluteFilePath}`);
  } catch (error) {
    console.error('Failed to download file:', error);
    throw error;
  }
}

export const executor = executeDownloadFile;
export const def = downloadFileDef;
