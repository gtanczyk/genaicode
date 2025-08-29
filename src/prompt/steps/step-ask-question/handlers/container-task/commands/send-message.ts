import { FunctionDef } from '../../../../../../ai-service/common-types.js';
import { putAssistantMessage, putUserMessage } from '../../../../../../main/common/content-bus.js';
import { askUserForInput } from '../../../../../../main/common/user-actions.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from './complete-task.js';

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
      waitForUserResponse: {
        type: 'boolean',
        description: 'Whether the message is a question, and user input is expected.',
      },
    },
    required: ['message', 'waitForUserResponse'],
  },
};

type SendMessageArgs = { message: string; waitForUserResponse: boolean };

export async function handleSendMessage(
  props: Pick<CommandHandlerBaseProps, 'actionResult' | 'taskExecutionPrompt' | 'options'>,
): Promise<CommandHandlerResult> {
  const { actionResult, taskExecutionPrompt, options } = props;
  const args = actionResult.args as SendMessageArgs;

  taskExecutionPrompt.push({
    type: 'assistant',
    functionCalls: [actionResult],
  });

  if (args.waitForUserResponse) {
    const response = await askUserForInput('Your answer', args.message, options);
    putAssistantMessage(args.message);
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
    putAssistantMessage(args.message);
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
