import sharp from 'sharp';
import fs from 'fs';

/**
 *
 * @param {Buffer} input
 * @param {{width: number, height: number}} size
 * @returns {Buffer}
 */
export async function resizeImageBuffer(input, size) {
  return await sharp(input).resize(size.width, size.height).toBuffer();
}

/**
 *
 * @param {string} filePath
 * @param {{width: number, height: number}} size
 * @returns {Buffer}
 */
export async function resizeImageFile(filePath, size) {
  const buffer = await resizeImageBuffer(filePath, size);
  fs.writeFileSync(filePath, buffer);
}
