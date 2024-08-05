import OpenAI from 'openai';

/**
 * Generate an image using OpenAI's DALL-E model and save it to a file
 * @param {string} prompt - The description of the image to generate
 * @param {string} size - The size of the image to generate ('256x256', '512x512', or '1024x1024')
 * @returns {Promise<string>} - The url of the image
 */
export async function generateImage(prompt, size = '1024x1024') {
  const openai = new OpenAI();

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: size,
      response_format: 'url',
    });

    const imageUrl = response.data[0].url;

    console.log(`Image generated, url: ${imageUrl}`);
    return imageUrl;
  } catch (error) {
    console.error('Error generating image:', error);
    throw error;
  }
}
