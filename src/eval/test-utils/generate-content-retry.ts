import { GenerateContentFunction } from '../../ai-service/common.js';

/**
 * Configuration options for retry mechanism
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Jitter factor for randomization (0-1, default: 0.1) */
  jitterFactor?: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  jitterFactor: 0.1,
};

/**
 * Check if an error is retryable based on its message or type
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('internal error') ||
      errorMessage.includes('internal server error') ||
      errorMessage.includes('service unavailable') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests')
    );
  }
  return false;
}

/**
 * Calculate backoff delay with jitter
 */
function calculateBackoff(attempt: number, options: Required<RetryOptions>): number {
  const exponentialDelay = Math.min(options.maxDelayMs, options.initialDelayMs * Math.pow(2, attempt));

  const jitter = exponentialDelay * options.jitterFactor * Math.random();
  return exponentialDelay + jitter;
}

/**
 * Wrapper for generateContent with retry mechanism
 */
export function retryGenerateContent(
  generateContent: GenerateContentFunction,
  retryOptions: RetryOptions = {},
): GenerateContentFunction {
  const options: Required<RetryOptions> = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };

  return async function wrappedGenerateContent(...args) {
    let lastError: unknown;

    for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          const delay = calculateBackoff(attempt - 1, options);
          console.log(`Retry attempt ${attempt + 1}/${options.maxAttempts} after ${delay}ms delay...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        return await generateContent(...args);
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error)) {
          console.log('Non-retryable error encountered:', error);
          throw error;
        }

        console.log(`Attempt ${attempt + 1}/${options.maxAttempts} failed:`, error);

        if (attempt === options.maxAttempts - 1) {
          console.log('All retry attempts failed');
          throw error;
        }
      }
    }

    // This should never happen due to the throw in the loop
    throw lastError;
  };
}
