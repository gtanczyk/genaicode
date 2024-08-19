import sharp from 'sharp';
import fs from 'fs';

interface ImageSize {
  width: number;
  height: number;
}

/**
 * Resize an image buffer to the desired size
 * @param {Buffer} input - The input image buffer
 * @param {ImageSize} size - The desired size of the image
 * @returns {Promise<Buffer>} - The resized image buffer
 */
export async function resizeImageBuffer(input: Buffer, size: ImageSize): Promise<Buffer> {
  return await sharp(input).resize(size.width, size.height).toBuffer();
}

/**
 * Resize an image file to the desired size and save it back to the same file
 * @param {string} filePath - The path of the image file to resize
 * @param {ImageSize} size - The desired size of the image
 * @returns {Promise<void>}
 */
export async function resizeImageFile(filePath: string, size: ImageSize): Promise<void> {
  const buffer = await resizeImageBuffer(await fs.promises.readFile(filePath), size);
  await fs.promises.writeFile(filePath, buffer);
}
