import { FunctionDef, ModelType, PromptItem } from '../../../../../../ai-service/common-types.js';
import { CommandHandlerResult, CommandHandlerBaseProps } from '../container-commands-registry.js';
import {
  appendKnowledge,
  getKnowledgeBase,
  knowledgeContextDef,
} from '../../../../../../main/knowledge/knowledge-store.js';
import { GainKnowledgeArgs } from '../../../../../../main/knowledge/types.js';
import { putContainerLog } from '../../../../../../main/common/content-bus.js';

export const gainKnowledgeDef: FunctionDef = {
  name: 'gainKnowledge',
  description: `Persist a new knowledge entry capturing a prompt, its answer/insight, and optional tags/metadata. Use this to record successful operations, solutions to problems, or any other valuable information that could help in future tasks. Avoid storing secrets.
Before calling this function make sure to check if the information you want to store not exists already in the knowledge base using queryKnowledge tool.`,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The problem, question, or description of the situation.',
      },
      answer: {
        type: 'string',
        description: 'The validated solution, insight, or outcome.',
      },
      metadata: {
        type: 'object',
        description: 'Optional structured data, e.g., { "exitCode": 0, "relevantFile": "package.json" }.',
      },
      explanation: {
        type: 'string',
        description: 'A brief explanation of why this knowledge is valuable to store.',
      },
    },
    required: ['prompt', 'answer', 'explanation'],
  },
};

export async function handleGainKnowledge(props: CommandHandlerBaseProps): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt } = props;
  const args = actionResult.args as GainKnowledgeArgs;

  taskExecutionPrompt.push({
    type: 'assistant',
    functionCalls: [actionResult],
  });

  try {
    const newEntry = await appendKnowledge(args);
    const message = `Successfully added knowledge entry ${newEntry.id}.`;
    putContainerLog('info', message, newEntry);
    taskExecutionPrompt.push({
      type: 'user',
      functionResponses: [
        {
          name: 'gainKnowledge',
          call_id: actionResult.id,
          content: JSON.stringify({ id: newEntry.id, success: true }),
        },
      ],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putContainerLog('error', `Failed to add knowledge entry: ${errorMessage}`, {
      error,
    });
    taskExecutionPrompt.push({
      type: 'user',
      functionResponses: [
        {
          name: 'gainKnowledge',
          call_id: actionResult.id,
          content: `Failed to add knowledge entry: ${errorMessage}`,
        },
      ],
    });
  }
}

export async function maybeGainKnowledge(
  props: CommandHandlerBaseProps & {
    taskDescription: string;
    summary: string;
    systemPrompt: PromptItem;
    taskPrompt: PromptItem;
  },
): Promise<void> {
  const { generateContentFn, taskExecutionPrompt } = props;
  try {
    const knowledgeBase = await getKnowledgeBase();
    const corpus = knowledgeBase.map(({ id, prompt, answer }) => ({ id, prompt, answer }));

    const response = await generateContentFn(
      [
        props.systemPrompt,
        props.taskPrompt,
        ...taskExecutionPrompt,
        {
          type: 'assistant',
          functionCalls: [
            {
              name: knowledgeContextDef.name,
              args: {},
            },
          ],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: knowledgeContextDef.name,
              content: JSON.stringify({ corpus }),
            },
          ],
        },
      ],
      {
        modelType: ModelType.DEFAULT,
        temperature: 0.2,
        functionDefs: [knowledgeContextDef, gainKnowledgeDef],
        requiredFunctionName: gainKnowledgeDef.name,
        expectedResponseType: {
          text: false,
          functionCall: true,
        },
      },
      { disableCache: true },
    );

    const gainKnowledgeCall = response.find((part) => part.type === 'functionCall')?.functionCall;

    if (gainKnowledgeCall?.name !== 'gainKnowledge') {
      putContainerLog('info', 'No knowledge gain needed based on current context.');
      return;
    }
    // Intentionally not awaiting this
    handleGainKnowledge({ ...props, actionResult: gainKnowledgeCall });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putContainerLog('error', 'Error during maybeGainKnowledge execution', { error: errorMessage });
  }
}
