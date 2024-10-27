import { askUserForInput } from '../../../../main/common/user-actions.js';
import { putAssistantMessage, putSystemMessage } from '../../../../main/common/content-bus.js';
import { StepResult } from '../../steps-types.js';
import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { executeStepGenerateImage } from '../../step-generate-image.js';

export async function handleRequestAnswerWithImage({
  askQuestionCall,
  options,
  generateImageFn,
}: ActionHandlerProps): Promise<ActionResult> {
  if (!options.imagen) {
    putSystemMessage('Image generation is not enabled. Please enable it using --imagen parameter.');
    return {
      breakLoop: true,
      stepResult: StepResult.BREAK,
      items: [],
    };
  }

  // Get the image generation request from the args
  const imageGenerationRequest = askQuestionCall.args?.imageGenerationRequest;
  if (!imageGenerationRequest?.prompt) {
    putSystemMessage('Image generation request with prompt is required for requestAnswerWithImage action.');
    return {
      breakLoop: true,
      stepResult: StepResult.BREAK,
      items: [],
    };
  }

  // Create a temporary file path for the generated image
  const tempImagePath = `/tmp/question-image-${Date.now()}.png`;

  // Generate the image using generateImage function call
  const generateImageCall = {
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
      stepResult: StepResult.BREAK,
      items: [],
    };
  }

  const response = await fetch(downloadFileCall.args?.downloadUrl);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  putAssistantMessage(
    'Here is the image to support the question:',
    generateImageCall.args,
    [],
    [
      {
        base64url: buffer.toString('base64'),
        mediaType: 'image/png',
      },
    ],
  );

  // Get user's response with the image displayed
  const userText = await askUserForInput('Your answer', askQuestionCall.args?.content ?? '');

  // Return the conversation items with the generated image
  return {
    breakLoop: false,
    stepResult: StepResult.CONTINUE,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: askQuestionCall.args?.content ?? '',
          functionCalls: [askQuestionCall, generateImageCall, downloadFileCall],
        },
        user: {
          type: 'user',
          text: userText,
          functionResponses: [
            {
              name: 'askQuestion',
              call_id: askQuestionCall.id ?? '',
              content: undefined,
            },
          ],
        },
      },
    ],
  };
}
