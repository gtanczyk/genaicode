import fs from 'fs';
import * as diff from 'diff';
import { PromptItem, FunctionDef, FunctionCall, GenerateContentFunction } from '../../ai-service/common.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { PromptMessages } from '../prompt-service.js';

export async function executeStepVerifyPatch(
  { filePath, patch }: { filePath: string; patch: string },
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  functionDefs: FunctionDef[],
  temperature: number,
  cheap: boolean,
  messages: PromptMessages,
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
    const partialRequest: [PromptItem[], FunctionDef[], string, number, boolean] = [
      prompt,
      functionDefs,
      'updateFile',
      temperature,
      cheap,
    ];
    let partialResult = await generateContentFn(...partialRequest);

    partialResult = await validateAndRecoverSingleResult(partialRequest, partialResult, messages, generateContentFn);

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
    return [{ name: 'patchFile', args: { filePath, patch } }];
  }
}
