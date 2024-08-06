/** Temporary storage */
let tempId = 1;
const temp = {};

export function getTempBuffer(url) {
  return temp[url];
}

export function setTempBuffer(buffer) {
  const imageUrl = 'temp://' + tempId++;
  temp[imageUrl] = buffer;
  return imageUrl;
}
