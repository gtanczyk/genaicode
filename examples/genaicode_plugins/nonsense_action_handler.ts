import { Plugin, ActionHandlerProps, ActionResult } from '../../src/index.js';

const nonsenseActionHandler: Plugin = {
  name: 'nonsense-action-handler',
  actionHandlers: {
    'nonsense-action': {
      description:
        'A demonstration action handler that echoes back the received content. Use this action when you want to test the plugin system or demonstrate its capabilities.',
      handler: async (props: ActionHandlerProps): Promise<ActionResult> => {
        const { putSystemMessage, askUserForInput } = await import('../../src/index.js');

        putSystemMessage('Custom action handler executed', props.iterateCall.args);

        // Example implementation that echoes the content back
        const assistantItem = {
          type: 'assistant' as const,
          text: `Custom action handler received: ${props.iterateCall.args?.message}`,
        };

        const userItem = {
          type: 'user' as const,
          text: (await askUserForInput('Your answer', props.iterateCall.args?.message ?? '', props.options)).answer,
        };

        return {
          breakLoop: false,
          items: [{ assistant: assistantItem, user: userItem }],
        };
      },
    },
  },
};

export default nonsenseActionHandler;
