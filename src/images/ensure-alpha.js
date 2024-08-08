import sharp from 'sharp';

export async function ensureAlpha(image) {
  return sharp(image).ensureAlpha().toBuffer();
}
