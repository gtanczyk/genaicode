import { ActionHandlerProps, ActionResult, GenaicodeHelpArgs } from '../step-ask-question-types.js';
import { FunctionCall, PromptItem } from '../../../../ai-service/common.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { putAssistantMessage } from '../../../../main/common/content-bus.js';
import { askUserForInput } from '../../../../main/common/user-actions.js';
import { GENAICODE_HELP_DOCUMENT } from '../../../../help-docs/genaicode-help-document.js';

/**
 * Handler for the help action. This handler is responsible for:
 * 1. Reading the documentation file
 * 2. Finding relevant sections based on the query
 * 3. Returning formatted results to the user
 */
export async function handleGenaicodeHelp({
  generateContentFn,
  askQuestionCall,
  prompt,
  options,
}: ActionHandlerProps): Promise<ActionResult> {
  try {
    // Get help content
    const [genaicodeHelpCall] = await getGenaicodeHelpCall(generateContentFn, prompt);

    if (!genaicodeHelpCall?.args) {
      return {
        breakLoop: false,
        items: [
          {
            assistant: {
              type: 'assistant',
              text: askQuestionCall.args?.message || 'How can I help you?',
            },
            user: {
              type: 'user',
              text: 'Failed to get valid genaicodeHelp request',
            },
          },
        ],
      };
    }

    putAssistantMessage(genaicodeHelpCall.args?.message ?? '', genaicodeHelpCall.args);

    const response = await askUserForInput('Your answer', genaicodeHelpCall.args?.message ?? '');
    if (response.options?.aiService) {
      options.aiService = response.options.aiService;
    }

    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: genaicodeHelpCall.args?.message ?? '',
            functionCalls: [genaicodeHelpCall],
          },
          user: {
            type: 'user',
            text: response.answer,
            functionResponses: [{ name: 'genaicodeHelp', call_id: genaicodeHelpCall.id, content: '' }],
          },
        },
      ],
    };
  } catch (error) {
    console.error('Error in help handler:', error);
    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: askQuestionCall.args?.message || 'How can I help you?',
          },
          user: {
            type: 'user',
            text: 'Sorry, I encountered an error while retrieving the help documentation. Please try again or check if the documentation file exists.',
          },
        },
      ],
    };
  }
}

async function getGenaicodeHelpCall(generateContentFn: ActionHandlerProps['generateContentFn'], prompt: PromptItem[]) {
  const [genaicodeHelpCall] = (await generateContentFn(
    [
      {
        type: 'assistant',
        text: 'I can help you with questions about GenAIcode, but first I need access to genaicode documentation, could you please provide it?',
      },
      {
        type: 'user',
        text: `Of course, here is the documentation:

      \`\`\`
      ${GENAICODE_HELP_DOCUMENT}
      \`\`\`
`,
      },
      ...prompt,
    ],
    getFunctionDefs(),
    'genaicodeHelp',
    0.7,
    true,
  )) as [FunctionCall<GenaicodeHelpArgs> | undefined];

  return [genaicodeHelpCall];
}
