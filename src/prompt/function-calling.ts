import { requireExplanations } from '../cli/cli-params.js';
import { FunctionDef } from '../ai-service/common.js';
import { getSourceCode } from './function-defs/get-source-code.js';
import { getImageAssets } from './function-defs/get-image-assets.js';
import { codegenSummary } from './function-defs/codegen-summary.js';
import { updateFile } from './function-defs/update-file.js';
import { patchFile } from './function-defs/patch-file.js';
import { createFile } from './function-defs/create-file.js';
import { deleteFile } from './function-defs/delete-file.js';
import { explanation } from './function-defs/explanation.js';
import { createDirectory } from './function-defs/create-directory.js';
import { moveFile } from './function-defs/move-file.js';
import { generateImage } from './function-defs/generate-image.js';
import { downloadFile } from './function-defs/download-file.js';
import { imglyRemoveBackground } from './function-defs/imgly-remove-background.js';
import { resizeImage } from './function-defs/resize-image.js';
import { splitImage } from './function-defs/split-image.js';
import { askQuestion } from './function-defs/ask-question.js';
import { optimizeContext } from './function-defs/optimize-context.js';

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
  optimizeContext,
  // @ts-expect-error (fix this once fun defs are converted to ts)
].map((fd: FunctionDef) => {
  if (requireExplanations && fd.parameters.properties.explanation && !fd.parameters.required.includes('explanation')) {
    fd.parameters.required.push('explanation');
  } else if (!requireExplanations) {
    delete fd.parameters.properties.explanation;
  }

  return fd;
});
