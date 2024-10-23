import { Plugin } from '../../src/main/codegen-types.js';
import { ActionHandlerProps, ActionResult } from '../../src/prompt/steps/step-ask-question/step-ask-question-types.js';
import { putSystemMessage } from '../../src/main/common/content-bus.js';
import { StepResult } from '../../src/prompt/steps/steps-types.js';
import { askUserForInput } from '../../src/main/common/user-actions.js';

const nonsenseActionHandler: Plugin = {
  name: 'nonsense-action-handler',
  actionHandlers: {
    'nonsense-action': {
      description:
        'A demonstration action handler that echoes back the received content. Use this action when you want to test the plugin system or demonstrate its capabilities.',
      handler: async (props: ActionHandlerProps): Promise<ActionResult> => {
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
