import sharp from 'sharp';

/**
 * This function opens the input file, and splits its into parts, extracting parts of the input image, and saving to outputFilePaths
 *
 * @param {string} inputFilePath
 * @param {Array<{rect: {x: number, y: number, width: number, height: number}, outputFilePath: string}>} parts
 */
export async function splitImage(inputFilePath, parts) {
  try {
    // Process each part
    for (const part of parts) {
      const { rect, outputFilePath } = part;
      const { x, y, width, height } = rect;

      // Extract the specified rectangle from the input image
      console.log('Extracting', rect, outputFilePath);
      await sharp(inputFilePath).extract({ left: x, top: y, width, height }).toFile(outputFilePath);
    }

    console.log('Image splitting completed successfully.');
  } catch (error) {
    console.error('Error splitting image:', error);
    throw error;
  }
}