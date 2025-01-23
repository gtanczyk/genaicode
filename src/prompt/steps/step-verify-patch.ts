import fs from 'fs';
import * as diff from 'diff';
import { GenerateContentFunction } from '../../ai-service/common-types.js';
import { GenerateContentArgs } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { FunctionDef } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { CodegenOptions } from '../../main/codegen-types.js';

export async function executeStepVerifyPatch(
  { filePath, patch, explanation }: { filePath: string; patch: string; explanation: string },
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  cheap: boolean,
  options: CodegenOptions,
): Promise<FunctionCall[]> {
  console.log('Verification of patch for file:', filePath);

  let updatedContent: string | boolean = false;
  const currentContent = fs.readFileSync(filePath, 'utf-8');

  try {
    updatedContent = diff.applyPatch(currentContent, patch);
  } catch (e) {
    console.log('Error when applying patch', e);
  }

  if (!updatedContent) {
    console.log(`Patch could not be applied for ${filePath}. Retrying without patchFile function.`);

    // Rerun content generation without patchFile function
    const partialRequest: GenerateContentArgs = [
      prompt,
      functionDefs,
      'updateFile',
      temperature,
      cheap ? ModelType.CHEAP : ModelType.DEFAULT,
      options,
    ];
    let partialResult = await generateContentFn(...partialRequest);

    partialResult = await validateAndRecoverSingleResult(partialRequest, partialResult, generateContentFn);

    const getSourceCodeCall = partialResult.find((call) => call.name === 'getSourceCode');
    if (getSourceCodeCall) {
      throw new Error('Unexpected getSourceCode: ' + JSON.stringify(getSourceCodeCall));
    }
    if (partialResult.find((call) => call.name === 'patchFile')) {
      throw new Error('Unexpected patchFile in retry response');
    }

    return partialResult;
  } else {
    console.log('Patch verified successfully');
    return [
      {
        name: 'patchFile',
        args: { filePath, patch, explanation, oldContent: currentContent, newContent: updatedContent },
      },
    ];
  }
}
