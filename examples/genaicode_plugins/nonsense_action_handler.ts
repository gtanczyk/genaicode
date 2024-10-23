import { Plugin, ActionHandlerProps, ActionResult } from '../../src/index.js';

const nonsenseActionHandler: Plugin = {
  name: 'nonsense-action-handler',
  actionHandlers: {
    'nonsense-action': {
      description:
        'A demonstration action handler that echoes back the received content. Use this action when you want to test the plugin system or demonstrate its capabilities.',
      handler: async (props: ActionHandlerProps): Promise<ActionResult> => {
        const { StepResult, putSystemMessage, askUserForInput } = await import('../../src/index.js');

        putSystemMessage('Custom action handler executed', props.askQuestionCall.args);

        // Example implementation that echoes the content back
        const assistantItem = {
          type: 'assistant' as const,
          text: `Custom action handler received: ${props.askQuestionCall.args?.content}`,
          functionCalls: [props.askQuestionCall],
        };

        const userItem = {
          type: 'user' as const,
          text: await askUserForInput('Your answer', props.askQuestionCall.args?.content ?? ''),
          functionResponses: [{ name: 'askQuestion', call_id: props.askQuestionCall.id ?? '', content: undefined }],
        };

        return {
          breakLoop: false,
          stepResult: StepResult.CONTINUE,
          items: [{ assistant: assistantItem, user: userItem }],
        };
      },
    },
  },
};

export default nonsenseActionHandler;
