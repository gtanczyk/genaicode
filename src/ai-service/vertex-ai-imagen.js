import fs from 'fs';
import mime from 'mime-types';
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import { setTempBuffer } from '../files/temp-buffer.js';
import { resizeImageBuffer } from '../images/resize-image.js';

/**
 * Generate an image using Vertex AI's Imagen model and return the image URL
 * @param {string} prompt - The description of the image to generate
 * @param {string|undefined} contextImagePath - The image to be used as a context
 * @param {{width: number, height: number}} size - The size of the image to generate
 * @param {boolean} cheap - Whether to use a cheaper model
 * @returns {Promise<string>} - The url of the generated image
 */
export async function generateImage(prompt, contextImagePath, size, cheap = false) {
  // Initialize the PredictionServiceClient
  const client = new PredictionServiceClient({
    apiEndpoint: `${process.env.GOOGLE_CLOUD_REGION}-aiplatform.googleapis.com`,
  });

  // Set the project and location
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_REGION;

  // Set the model name based on the cheap parameter
  const modelName = contextImagePath
    ? 'imagegeneration@002'
    : cheap
      ? 'imagen-3.0-fast-generate-001'
      : 'imagen-3.0-generate-001';
  console.log(`Using Vertex AI Imagen model: ${modelName}`);

  try {
    // Prepare the request
    const request = {
      endpoint: `projects/${projectId}/locations/${location}/publishers/google/models/${modelName}`,
      instances: [
        helpers.toValue({
          prompt: prompt,
          ...(contextImagePath
            ? {
                image: {
                  bytesBase64Encoded: fs.readFileSync(contextImagePath, 'base64'),
                  mediaType: mime.lookup(contextImagePath),
                },
              }
            : {}),
        }),
      ],
      parameters: helpers.toValue({
        sampleCount: 1,
        safetySetting: 'block_most',
        personGeneration: 'allow_adult',
        includeRaiReason: true,
        language: 'auto',
        aspectRatio: '1:1',
        addWatermark: false,
      }),
    };

    // Make the prediction request
    const [response] = await client.predict(request);

    if (response.predictions && response.predictions.length > 0) {
      const prediction = helpers.fromValue(response.predictions[0]);
      if (prediction.bytesBase64Encoded) {
        console.log(`Image generated successfully, resizing to desired dimension`, size);
        const buffer = Buffer.from(prediction.bytesBase64Encoded, 'base64');
        return setTempBuffer(await resizeImageBuffer(buffer, size));
      }
    }

    throw new Error('No image generated in the response');
  } catch (error) {
    console.error('Error generating image:', error);
    throw error;
  }
}
