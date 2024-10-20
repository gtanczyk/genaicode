import OpenAI, { toFile } from 'openai';
import assert from 'node:assert';

import { setTempBuffer } from '../files/temp-buffer.js';
import { resizeImageBuffer } from '../images/resize-image.js';
import { ensureAlpha } from '../images/ensure-alpha.js';
import { abortController } from '../main/interactive/codegen-worker.js';

interface ImageSize {
  width: number;
  height: number;
}

/**
 * Generate an image using OpenAI's DALL-E model and save it to a file
 * @param {string} prompt - The description of the image to generate
 * @param {string|undefined} contextImagePath - The image to be used as a context
 * @param {ImageSize} size - The size of the image to generate
 * @param {boolean} cheap - Whether to use a cheaper model
 * @returns {Promise<string>} - The url of the image
 */
export async function generateImage(
  prompt: string,
  contextImagePath: string | undefined,
  size: ImageSize,
  cheap = false,
): Promise<string> {
  const openai = new OpenAI();

  try {
    const model = contextImagePath ? 'dall-e-2' : cheap ? 'dall-e-2' : 'dall-e-3';
    console.log(`Using DALL-E model: ${model}`);
    assert(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY environment variable is not set');

    const options: OpenAI.Images.ImageGenerateParams = {
      model: model,
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'url',
    };

    const response = contextImagePath
      ? await openai.images.edit(
          {
            ...options,
            image: await toFile(await ensureAlpha(contextImagePath)),
          } as OpenAI.Images.ImageEditParams,
          { signal: abortController?.signal },
        )
      : await openai.images.generate(options, { signal: abortController?.signal });

    let imageUrl = response.data[0].url!;

    if (size.width !== 1024 || size.height !== 1024) {
      console.log('Resizing image to desired size', size);
      const imageResponse = await fetch(imageUrl);
      const arrayBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      imageUrl = setTempBuffer(await resizeImageBuffer(buffer, size));
    }

    console.log(`Image generated, url: ${imageUrl}`);
    return imageUrl;
  } catch (error) {
    console.error('Error generating image:', error);
    throw error;
  }
}
