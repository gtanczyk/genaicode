import { ModelType, PromptItem, GenerateContentFunction } from './common-types.js';

/**
 * Summarizes a raw text output using a Lite LLM.
 * @param generateContent The `generateContent` function from the active AI service.
 * @param rawOutput The raw text to summarize.
 * @returns A promise that resolves to the summarized text.
 */
export async function liteLLMSummarizer(generateContent: GenerateContentFunction, rawOutput: string): Promise<string> {
  if (!rawOutput.trim()) {
    return 'No output was produced.';
  }

  const prompt: PromptItem[] = [
    {
      type: 'user',
      text: `Summarize concisely, noting errors, failures, and important results (~200 tokens):\n\n${rawOutput}`,
    },
  ];

  const result = await generateContent(
    prompt,
    {
      modelType: ModelType.LITE,
      expectedResponseType: {
        text: true,
        functionCall: false,
        media: false,
      },
      temperature: 0.2, // Low temperature for factual summarization
    },
    {
      disableCache: true, // Summaries of command output should not be cached
      askQuestion: false,
    },
  );

  const textPart = result.find((part) => part.type === 'text');
  if (textPart?.text) {
    return textPart.text;
  }

  console.warn('Lite LLM summarizer did not return a text part. Result:', JSON.stringify(result, null, 2));
  return 'Could not generate a summary from the output.';
}
