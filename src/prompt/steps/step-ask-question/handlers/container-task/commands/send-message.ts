import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putAssistantMessage, putUserMessage } from '../../../../../../main/common/content-bus.js';
import { askUserForInput } from '../../../../../../main/common/user-actions.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../types.js';

export const sendMessageDef: FunctionDef = {
  name: 'sendMessage',
  description: 'Send a message to the user. Should be used for non-interactive messages.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to send to the user.',
      },
      isQuestion: {
        type: 'boolean',
        description: 'Whether the message is a question, and user input is expected.',
      },
    },
    required: ['message', 'isQuestion'],
  },
};

type SendMessageArgs = { message: string; isQuestion: boolean };

export async function handleSendMessage(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt' | 'options'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, options } = props;
  const args = actionResult.args as SendMessageArgs;
  putAssistantMessage(args.message);

  taskExecutionPrompt.push({
    type: 'assistant',
    functionCalls: [actionResult],
  });

  if (args.isQuestion) {
    const response = await askUserForInput('Your answer', args.message, options);
    putUserMessage(response.answer);
    taskExecutionPrompt.push({
      type: 'user',
      text: response.answer,
      functionResponses: [
        {
          name: 'sendMessage',
          call_id: actionResult.id || undefined,
        },
      ],
    });
  } else {
    taskExecutionPrompt.push({
      type: 'user',
      functionResponses: [
        {
          name: 'sendMessage',
          call_id: actionResult.id || undefined,
        },
      ],
    });
  }
  return { shouldBreakOuter: false, commandsExecutedIncrement: 0 };
}
