/**
 * Estimates the token count of a given string.
 * Uses average token-to-word ratios for plain text and code.
 *
 * @param input - The string to estimate token count for
 * @returns The estimated token count
 */
export function estimateTokenCount(input: string): number {
  // Trim and check for empty input
  const trimmedInput = input.trim();
  if (!trimmedInput) return 0;

  // Determine if the input is code or plain text
  const isCode = containsCode(trimmedInput);

  // Split the input into words
  const words = trimmedInput.split(/\s+/);

  // Use average tokens per word based on content type
  const averageTokensPerWord = isCode ? 1.25 : 0.65;

  // Estimate token count
  const tokenCount = Math.ceil(words.length * averageTokensPerWord);

  return tokenCount;
}

/**
 * Heuristically determines if the text contains code.
 */
function containsCode(text: string): boolean {
  // Check for code indicators
  const codeIndicators = /[{}()[\];,.<>+\-*/%=&|^!~?:#@]|function|const|let|var|if|else|for|while|return|import|export/;
  return codeIndicators.test(text);
}
