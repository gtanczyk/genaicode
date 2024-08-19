/** Temporary storage */
let tempId = 1;
const temp: { [key: string]: Buffer } = {};

export function getTempBuffer(url: string): Buffer | undefined {
  return temp[url];
}

export function setTempBuffer(buffer: Buffer): string {
  const imageUrl = 'temp://' + tempId++;
  temp[imageUrl] = buffer;
  return imageUrl;
}
