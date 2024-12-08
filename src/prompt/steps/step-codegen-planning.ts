import { FunctionDef, GenerateContentFunction, PromptItem } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { getFunctionDefs } from '../function-calling.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { StepResult } from './steps-types.js';
import { executeStepEnsureContext } from './step-ensure-context.js';

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

  // Add the planning prompt to the conversation
  if (prompt.slice(-1)[0].type === 'user') {
    prompt.slice(-1)[0].text += '\n\\n' + PLANNING_PROMPT;
  } else {
    prompt.push({ type: 'user', text: PLANNING_PROMPT });
  }

  const planningRequest: [PromptItem[], FunctionDef[], string, number, boolean, CodegenOptions] = [
    prompt,
    getFunctionDefs(),
    'codegenPlanning',
    options.temperature ?? 0.7,
    options.cheap ?? true,
    options,
  ];

  try {
    let planningResult = await generateContentFn(...planningRequest);
    planningResult = await validateAndRecoverSingleResult(planningRequest, planningResult, generateContentFn);

    const codegenPlanningRequest = planningResult.find((call) => call.name === 'codegenPlanning');

    if (codegenPlanningRequest) {
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
