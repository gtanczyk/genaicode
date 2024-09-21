/**
 * Estimates the token count of a given string.
 * Assumes roughly one token per word for plain text and adjusts upward for code or complex language.
 *
 * @param input - The string to estimate token count for
 * @returns The estimated token count
 */
export function estimateTokenCount(input: string): number {
  // Split the input into words
  const words = input.split(/\s+/);

  // Initialize the token count
  let tokenCount = 0;

  for (const word of words) {
    // Count each word as at least one token
    tokenCount++;

    // Adjust for code-like or complex words
    if (isCodeLike(word)) {
      tokenCount += estimateCodeTokens(word);
    } else if (isComplexWord(word)) {
      tokenCount++;
    }
  }

  return tokenCount;
}

/**
 * Checks if a word is likely to be part of code.
 */
function isCodeLike(word: string): boolean {
  // Check for common code indicators
  return (
    /[{}()[\]<>.,;:=+\-*/%]/.test(word) ||
    /^(function|const|let|var|if|else|for|while|return|import|export)$/.test(word)
  );
}

/**
 * Estimates additional tokens for code-like words.
 */
function estimateCodeTokens(word: string): number {
  let additionalTokens = 0;

  // Count special characters as separate tokens
  additionalTokens += (word.match(/[{}()[\]<>.,;:=+\-*/%]/g) || []).length;

  // Count camelCase or snake_case as multiple tokens
  if (/[A-Z]/.test(word) || word.includes('_')) {
    additionalTokens += word.split(/(?=[A-Z])|_/).length - 1;
  }

  return additionalTokens;
}

/**
 * Checks if a word is complex (longer than average).
 */
function isComplexWord(word: string): boolean {
  return word.length > 8;
}
