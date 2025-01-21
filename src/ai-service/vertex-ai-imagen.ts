import fs from 'fs';
import mime from 'mime-types';
import { PredictionServiceClient, helpers, protos } from '@google-cloud/aiplatform';
import { setTempBuffer } from '../files/temp-buffer.js';
import { resizeImageBuffer } from '../images/resize-image.js';
import { abortController } from '../main/common/abort-controller.js';
import { ModelType } from './common-types.js';

interface ImageSize {
  width: number;
  height: number;
}

export async function generateImage(
  prompt: string,
  contextImagePath: string | undefined,
  size: ImageSize,
  modelType = ModelType.DEFAULT,
): Promise<string> {
  // Limitation in @google-cloud/aiplatform
  abortController?.signal.throwIfAborted();

  // Initialize the PredictionServiceClient
  const client = new PredictionServiceClient({
    apiEndpoint: `${process.env.GOOGLE_CLOUD_REGION}-aiplatform.googleapis.com`,
  });

  // Set the project and location
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_REGION;

  if (!projectId || !location) {
    throw new Error('GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_REGION environment variables must be set');
  }

  // Set the model name based on the cheap parameter
  const modelName = contextImagePath
    ? 'imagegeneration@002'
    : modelType === ModelType.CHEAP
      ? 'imagen-3.0-fast-generate-001'
      : 'imagen-3.0-generate-001';
  console.log(`Using Vertex AI Imagen model: ${modelName}`);

  try {
    // Prepare the request
    const instance = contextImagePath
      ? helpers.toValue({
          prompt,
          image: {
            bytesBase64Encoded: fs.readFileSync(contextImagePath, 'base64'),
            mediaType: mime.lookup(contextImagePath) ?? 'application/octet-stream',
          },
        })
      : helpers.toValue({ prompt });
    const request: protos.google.cloud.aiplatform.v1.IPredictRequest = {
      endpoint: `projects/${projectId}/locations/${location}/publishers/google/models/${modelName}`,
      instances: [instance!],
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
    const [response] = (await client.predict(request))!;

    if (response.predictions && response.predictions.length > 0 && response.predictions[0]) {
      const value = response.predictions[0] as protobuf.common.IValue;
      const prediction = helpers.fromValue(value) as { bytesBase64Encoded: string | undefined };
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
