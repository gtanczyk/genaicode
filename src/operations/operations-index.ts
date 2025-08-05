import { getRegisteredOperations } from '../main/plugin-loader.js';
import { OperationExecutor } from '../main/codegen-types.js';

import * as createDirectory from './create-directory/create-directory-executor.js';
import * as createFile from './create-file/create-file-executor.js';
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

function getOperations() {
  return [...getRegisteredOperations(), ...INDEX];
}

export function getOperationExecutor(name: string): OperationExecutor | undefined {
  return getOperations().find((operation) => operation.def.name === name)?.executor as OperationExecutor | undefined;
}

export function getOperationDefs() {
  return getOperations().map((operation) => operation.def);
}
