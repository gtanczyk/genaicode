import assert from 'node:assert';
import { GenerateImageFunction } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';

export async function executeStepGenerateImage(
  generateImageFn: GenerateImageFunction,
  generateImageCall: FunctionCall,
): Promise<
  FunctionCall<
    | {
        filePath: string;
        downloadUrl: string;
        explanation: string;
      }
    | {
        text: string;
        downloadUrl: undefined;
      }
  >
> {
  assert(!!generateImageFn, 'Image generation requested, but an image generation service was not provided');

  putSystemMessage('Processing image generation request:', generateImageCall.args);

  try {
    const {
      prompt: imagePrompt,
      filePath,
      contextImagePath,
      width,
      height,
      cheap,
    } = generateImageCall.args as {
      prompt: string;
      filePath: string;
      contextImagePath?: string;
      width: number;
      height: number;
      cheap: boolean;
    };
    const generatedImageUrl = await generateImageFn(
      imagePrompt,
      contextImagePath,
      { width, height },
      cheap === true ? ModelType.CHEAP : ModelType.DEFAULT,
    );

    // Add a downloadFile call to the result to ensure the generated image is tracked
    return {
      name: 'downloadFile',
      args: {
        filePath: filePath,
        downloadUrl: generatedImageUrl,
        explanation: `Downloading generated image`,
      },
    };
  } catch (error) {
    console.error('Error generating image:', error);
    // Add an explanation about the failed image generation
    return {
      name: 'explanation',
      args: {
        text: `Failed to generate image: ${(error as Error).message}`,
        downloadUrl: undefined,
      },
    };
  }
}
