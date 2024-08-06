import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import { setTempBuffer } from '../files/temp-buffer.js';

/**
 * Generate an image using Vertex AI's Imagen model and return the image URL
 * @param {string} prompt - The description of the image to generate
 * @param {string} size - The size of the image to generate ('256x256', '512x512', or '1024x1024')
 * @returns {Promise<string>} - The url of the generated image
 */
export async function generateImage(prompt) {
  // Initialize the PredictionServiceClient
  const client = new PredictionServiceClient({
    apiEndpoint: `${process.env.GOOGLE_CLOUD_REGION}-aiplatform.googleapis.com`,
  });

  // Set the project and location
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_REGION;

  // Set the model name
  const modelName = 'imagen-3.0-generate-001';

  try {
    // Prepare the request
    const request = {
      // Format: projects/{project}/locations/{location}/publishers/google/models/{model}
      endpoint: `projects/${projectId}/locations/${location}/publishers/google/models/${modelName}`,
      instances: [
        helpers.toValue({
          prompt: prompt,
        }),
      ],
      parameters: helpers.toValue({
        personGeneration: 'dont_allow',
        safetySetting: 'block_some',
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
        console.log(`Image generated successfully`);
        return setTempBuffer(Buffer.from(prediction.bytesBase64Encoded, 'base64'));
      }
    }

    throw new Error('No image generated in the response');
  } catch (error) {
    console.error('Error generating image:', error);
    throw error;
  }
}
