import { requireExplanations } from '../cli/cli-params.ts';
import { FunctionDef } from '../ai-service/common.ts';
import { getSourceCode } from './function-defs/get-source-code.ts';
import { getImageAssets } from './function-defs/get-image-assets.ts';
import { codegenSummary } from './function-defs/codegen-summary.ts';
import { updateFile } from './function-defs/update-file.ts';
import { patchFile } from './function-defs/patch-file.ts';
import { createFile } from './function-defs/create-file.ts';
import { deleteFile } from './function-defs/delete-file.ts';
import { explanation } from './function-defs/explanation.ts';
import { createDirectory } from './function-defs/create-directory.ts';
import { moveFile } from './function-defs/move-file.ts';
import { generateImage } from './function-defs/generate-image.ts';
import { downloadFile } from './function-defs/download-file.ts';
import { imglyRemoveBackground } from './function-defs/imgly-remove-background.ts';
import { resizeImage } from './function-defs/resize-image.ts';
import { splitImage } from './function-defs/split-image.ts';
import { askQuestion } from './function-defs/ask-question.ts';

/**
 * Function definitions for function calling feature
 */
export const functionDefs: FunctionDef[] = [
  getSourceCode,
  getImageAssets,
  codegenSummary,
  updateFile,
  patchFile,
  createFile,
  deleteFile,
  explanation,
  createDirectory,
  moveFile,
  generateImage,
  downloadFile,
  imglyRemoveBackground,
  resizeImage,
  splitImage,
  askQuestion,
  // @ts-expect-error (fix this once fun defs are converted to ts)
].map((fd: FunctionDef) => {
  if (requireExplanations && fd.parameters.properties.explanation && !fd.parameters.required.includes('explanation')) {
    fd.parameters.required.push('explanation');
  } else if (!requireExplanations) {
    delete fd.parameters.properties.explanation;
  }

  return fd;
});
