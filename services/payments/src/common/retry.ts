/**
 * Retry logic for transient payment provider failures
 */
export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

const DEFAULT_RETRYABLE = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  '503',
  '502',
  '504',
];

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    retryableErrors = DEFAULT_RETRYABLE,
  } = options;

  let lastError: Error | undefined;
  let delay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const message = lastError.message.toLowerCase();
      const code = (lastError as Error & { code?: string }).code?.toUpperCase() ?? '';

      const isRetryable = retryableErrors.some(
        (e) => message.includes(e.toLowerCase()) || code.includes(e)
      );

      if (!isRetryable || attempt === maxAttempts) {
        throw lastError;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= backoffMultiplier;
    }
  }

  throw lastError;
}
