import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';

/**
 * Generate an image using Vertex AI's Imagen model and return the image URL
 * @param {string} prompt - The description of the image to generate
 * @param {string} size - The size of the image to generate ('256x256', '512x512', or '1024x1024')
 * @returns {Promise<string>} - The url of the generated image
 */
export async function generateImageWithImagen(prompt, size = '1024x1024') {
  // Initialize the PredictionServiceClient
  const client = new PredictionServiceClient({
    apiEndpoint: 'us-central1-aiplatform.googleapis.com',
  });

  // Set the project and location
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = 'us-central1';

  // Set the model name
  const modelName = 'imagegeneration@006';

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
      parameters: [
        {
          key: 'personGeneration',
          value: 'dont_allow',
        },
        {
          key: 'safetySetting',
          value: 'block_some',
        },
        {
          key: 'includeRaiReason',
          value: true,
        },
        {
          key: 'language',
          value: 'auto',
        },
        {
          key: 'aspectRatio',
          value: '1:1',
        },
        {
          key: 'addWatermark',
          value: true,
        },
      ],
    };

    // Make the prediction request
    const [response] = await client.predict(request);

    if (response.predictions && response.predictions.length > 0) {
      const prediction = helpers.fromValue(response.predictions[0]);
      if (prediction.bytesBase64Encoded) {
        console.log(`Image generated successfully`);
        return `data:image/png;base64,${prediction.bytesBase64Encoded}`;
      }
    }

    throw new Error('No image generated in the response');
  } catch (error) {
    console.error('Error generating image with Imagen:', error);
    throw error;
  }
}

// Example usage:
await generateImageWithImagen('cat image', '512x512');
