import sharp from 'sharp';

export async function ensureAlpha(image: string | Buffer): Promise<Buffer> {
  return sharp(image).ensureAlpha().toBuffer();
}
