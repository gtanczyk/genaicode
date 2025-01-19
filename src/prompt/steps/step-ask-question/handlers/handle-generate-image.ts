import { askUserForInput } from '../../../../main/common/user-actions.js';
import { putAssistantMessage, putSystemMessage } from '../../../../main/common/content-bus.js';
import { ActionHandlerProps, ActionResult, GenerateImageArgs } from '../step-ask-question-types.js';
import { executeStepGenerateImage } from '../../step-generate-image.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { FunctionCall } from '../../../../ai-service/common.js';
import { getTempBuffer } from '../../../../files/temp-buffer.js';

export async function handleGenerateImage({
  askQuestionCall,
  options,
  generateContentFn,
  prompt,
  generateImageFn,
}: ActionHandlerProps): Promise<ActionResult> {
  if (!options.imagen) {
    putSystemMessage('Image generation is not enabled. Please enable it using --imagen parameter.');
    return {
      breakLoop: true,
      items: [],
    };
  }

  const [generateImageCall] = (await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Yes, you can generate an image.',
      },
    ],
    getFunctionDefs(),
    'generateImage',
    0.7,
    true,
    options,
  )) as [FunctionCall<GenerateImageArgs> | undefined];

  if (!generateImageCall?.args) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  // Get the image generation request from the args
  if (!generateImageCall.args.prompt) {
    putSystemMessage('Image generation request with prompt is required for sendMessageWithImage action.');
    return {
      breakLoop: true,
      items: [],
    };
  }

  // Create a temporary file path for the generated image
  generateImageCall.args.filePath = `/tmp/question-image-${Date.now()}.png`;

  // Execute image generation
  const downloadFileCall = await executeStepGenerateImage(generateImageFn, generateImageCall);

  // If image generation failed, the downloadFileCall will be an explanation
  if (!downloadFileCall.args?.downloadUrl) {
    putSystemMessage('Failed to generate image for the question.');
    return {
      breakLoop: true,
      items: [],
    };
  }

  let buffer: Buffer | undefined;
  const downloadUrl = downloadFileCall.args.downloadUrl;

  if (downloadUrl.startsWith('temp://')) {
    buffer = getTempBuffer(downloadUrl);
  } else {
    const response = await fetch(downloadFileCall.args?.downloadUrl);
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  }

  if (!buffer) {
    putSystemMessage('Failed to generate image for the question.');
    return {
      breakLoop: true,
      items: [],
    };
  }

  const imageData = {
    base64url: buffer.toString('base64'),
    mediaType: 'image/png',
  } as const;

  putAssistantMessage('', generateImageCall.args, [], [imageData]);

  // Get user's response with the image displayed
  const inputResponse = await askUserForInput('Your answer', askQuestionCall.args?.message ?? '');
  if (inputResponse.options?.aiService) {
    options.aiService = inputResponse.options.aiService;
  }

  // Return the conversation items with the generated image included in the context
  return {
    breakLoop: false,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: askQuestionCall.args?.message ?? '',
          functionCalls: [generateImageCall],
        },
        user: {
          type: 'user',
          text: inputResponse.answer,
          images: [imageData],
          functionResponses: [{ name: generateImageCall.name, call_id: generateImageCall.id, content: undefined }],
        },
      },
    ],
  };
}