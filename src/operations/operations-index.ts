import { CodegenOptions } from '../main/codegen-types';

import * as createDirectory from './create-directory/create-directory-executor';
import * as createFile from './create-file/create-file-executor';
import * as updateFile from './update-file/update-file-executor.js';
import * as patchFile from './patch-file/patch-file-executor.js';
import * as deleteFile from './delete-file/delete-file-executor.js';
import * as moveFile from './move-file/move-file-executor.js';
import * as downloadFile from './download-file/download-file-executor.js';
import * as splitImage from './split-image/split-image-executor.js';
import * as resizeImage from './resize-image/resize-image-executor.js';
import * as imglyRemoveBackground from './imgly-remove-background/imgly-remove-background-executor.js';

const INDEX = [
  createDirectory,
  createFile,
  updateFile,
  patchFile,
  deleteFile,
  moveFile,
  downloadFile,
  splitImage,
  resizeImage,
  imglyRemoveBackground,
] as const;

export function getOperationExecutor(name: string) {
  return INDEX.find((operation) => operation.def.name === name)?.executor as
    | ((args: Record<string, unknown>, options: CodegenOptions) => Promise<void>)
    | undefined;
}

export function getOperationDefs() {
  return INDEX.map((operation) => operation.def);
}
