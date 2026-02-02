import { GenerateContentArgs, GenerateContentFunction } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions, CodegenPlanningArgs } from '../../main/codegen-types.js';
import { getFunctionDefs } from '../function-calling.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { StepResult } from './steps-types.js';
import { executeStepEnsureContext } from './step-ensure-context.js';
import { getRegisteredPlanningPreHooks, getRegisteredPlanningPostHooks } from '../../main/plugin-loader.js';

export const PLANNING_PROMPT = `Please analyze the conversation so far and help plan the implementation:

1. Review the conversation history and requirements
2. Thoughtfully analyze the problem
3. Create a step-by-step implementation plan
4. List all files that will be affected during implementation

Remember to:
- Consider both direct and indirect dependencies
- Think about how changes in one file might affect others
- Include all necessary file paths
- Explain your reasoning for each step
- Consider edge cases and potential issues

Output the plan using \`codegenPlanning\` function provding all the required fields.`;

/**
 * Execute the codegen planning step
 * This step analyzes the conversation and produces a detailed implementation plan
 * before proceeding with actual code generation
 */
export async function executeStepCodegenPlanning(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<StepResult> {
  putSystemMessage('Starting codegen planning phase...');

  // Execute pre-hooks to potentially modify the planning prompt
  const modifiedPlanningPrompt = await executePlanningPreHooks(PLANNING_PROMPT, options);

  // Add the planning prompt to the conversation
  if (prompt.slice(-1)[0].type === 'user') {
    prompt.slice(-1)[0].text += '\n\n' + modifiedPlanningPrompt;
  } else {
    prompt.push({ type: 'user', text: modifiedPlanningPrompt });
  }

  const planningRequest: GenerateContentArgs = [
    prompt,
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'codegenPlanning',
      temperature: options.temperature ?? 0.7,
      modelType: options.cheap ? ModelType.CHEAP : ModelType.DEFAULT,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  ];

  try {
    const planningResult = (await generateContentFn(...planningRequest))
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);

    let codegenPlanningRequest = planningResult.find((call) => call.name === 'codegenPlanning');

    if (codegenPlanningRequest) {
      // Execute post-hooks to potentially modify the planning result
      codegenPlanningRequest = await executePlanningPostHooks(
        codegenPlanningRequest as FunctionCall<CodegenPlanningArgs>,
        modifiedPlanningPrompt,
        options,
      );

      putSystemMessage('Planning phase completed, ensuring context completeness...');

      // Ensure all necessary files are in context
      const contextResult = await executeStepEnsureContext(prompt, codegenPlanningRequest, options);
      if (contextResult === StepResult.BREAK) {
        putSystemMessage('Failed to ensure context completeness during planning phase');
        return StepResult.BREAK;
      }

      putSystemMessage('Planning phase completed successfully', codegenPlanningRequest);

      // Store the planning response in conversation history
      prompt.push({ type: 'assistant', functionCalls: planningResult });
      prompt.push({
        type: 'user',
        functionResponses: planningResult.map((call) => ({ name: call.name, call_id: call.id })),
        cache: true,
      });

      return StepResult.CONTINUE;
    } else {
      putSystemMessage('Did not receive codegen planning result');
      return StepResult.BREAK;
    }
  } catch (error) {
    putSystemMessage('Error during planning phase: ' + (error as Error).message);
    return StepResult.BREAK;
  }
}

/**
 * Execute registered planning pre-hooks
 * Returns modified prompt if any hook provides one, otherwise returns the original prompt
 */
async function executePlanningPreHooks(originalPrompt: string, options: CodegenOptions): Promise<string> {
  let modifiedPrompt = originalPrompt;
  const preHooks = getRegisteredPlanningPreHooks();

  if (preHooks.length > 0) {
    putSystemMessage(`Executing ${preHooks.length} planning pre-hooks...`);

    for (const hook of preHooks) {
      try {
        const result = await hook({
          prompt: modifiedPrompt,
          options,
        });
        if (result) {
          modifiedPrompt = result;
        }
      } catch (error) {
        putSystemMessage(`Error in planning pre-hook: ${(error as Error).message}`);
        console.error('Planning pre-hook error:', error);
      }
    }
  }

  return modifiedPrompt;
}

/**
 * Execute registered planning post-hooks
 * Returns modified result if any hook provides one, otherwise returns the original result
 */
async function executePlanningPostHooks(
  originalResult: FunctionCall<CodegenPlanningArgs>,
  originalPrompt: string,
  options: CodegenOptions,
): Promise<FunctionCall<CodegenPlanningArgs>> {
  let modifiedResult = originalResult;
  const postHooks = getRegisteredPlanningPostHooks();

  if (postHooks.length > 0) {
    putSystemMessage(`Executing ${postHooks.length} planning post-hooks...`);

    for (const hook of postHooks) {
      try {
        const result = await hook({
          prompt: originalPrompt,
          options,
          result: modifiedResult,
        });
        if (result) {
          modifiedResult = result;
        }
      } catch (error) {
        putSystemMessage(`Error in planning post-hook: ${(error as Error).message}`);
        console.error('Planning post-hook error:', error);
      }
    }
  }

  return modifiedResult;
}
