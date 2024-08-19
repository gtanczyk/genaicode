import fs from 'fs';
import { createRequire } from 'node:module';
import { removeBackground } from '@imgly/background-removal-node';

/** Converts white color to transparency on a image and saves to destination path */
export async function imglyRemoveBackground(inputFilePath: string, outputFilePath: string): Promise<string> {
  try {
    console.log(`Removing background for image: ${inputFilePath}`);

    const publicPath = 'file://' + createRequire(import.meta.url).resolve('@imgly/background-removal-node');
    const blob: Blob = await removeBackground(inputFilePath, {
      publicPath,
    });
    fs.writeFileSync(outputFilePath, Buffer.from(await blob.arrayBuffer()));

    console.log(`Background removed successfully. Saved to: ${outputFilePath}`);
    return outputFilePath;
  } catch (error) {
    console.error('Error removing background:', error);
    throw error;
  }
}
