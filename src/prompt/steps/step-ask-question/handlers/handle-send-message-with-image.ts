import { askUserForInput } from '../../../../main/common/user-actions.js';
import { putAssistantMessage, putSystemMessage } from '../../../../main/common/content-bus.js';
import { ActionHandlerProps, ActionResult, SendMessageWithImageArgs } from '../step-ask-question-types.js';
import { executeStepGenerateImage } from '../../step-generate-image.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { FunctionCall } from '../../../../ai-service/common.js';

export async function handleSendMessageWithImage({
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

  const [sendMessageWithImageCall] = (await generateContentFn(
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
    'sendMessageWithImage',
    0.7,
    true,
    options,
  )) as [FunctionCall<SendMessageWithImageArgs> | undefined];

  if (!sendMessageWithImageCall) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  // Get the image generation request from the args
  const imageGenerationRequest = sendMessageWithImageCall.args;
  if (!imageGenerationRequest?.prompt) {
    putSystemMessage('Image generation request with prompt is required for sendMessageWithImage action.');
    return {
      breakLoop: true,
      items: [],
    };
  }

  // Create a temporary file path for the generated image
  const tempImagePath = `/tmp/question-image-${Date.now()}.png`;

  // Generate the image using generateImage function call
  const generateImageCall = {
    id: 'generate_image_' + sendMessageWithImageCall.id,
    name: 'generateImage',
    args: {
      prompt: imageGenerationRequest.prompt,
      filePath: tempImagePath,
      width: 1024,
      height: 1024,
      explanation: 'Generating image to support the question',
      ...(imageGenerationRequest.contextImage && { contextImagePath: imageGenerationRequest.contextImage }),
    },
  };

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

  const response = await fetch(downloadFileCall.args?.downloadUrl);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const imageData = {
    base64url: buffer.toString('base64'),
    mediaType: 'image/png',
  } as const;

  putAssistantMessage('Here is the image to support the question:', generateImageCall.args, [], [imageData]);

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
