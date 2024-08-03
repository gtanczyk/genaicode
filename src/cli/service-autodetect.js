/** Detects if one of ai services is configured */
export function serviceAutoDetect() {
  if (process.env.ANTHROPIC_API_KEY) {
    return 'anthropic';
  } else if (process.env.OPENAI_API_KEY) {
    return 'chat-gpt';
  } else if (process.env.GOOGLE_CLOUD_PROJECT) {
    return 'vertex-ai';
  }
  return null;
}