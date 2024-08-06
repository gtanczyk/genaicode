/** Detects if Vertex AI service is configured */
export function serviceAutoDetect() {
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return 'vertex-ai';
  }
  return null;
}
