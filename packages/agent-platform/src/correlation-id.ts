/**
 * Correlation ID propagation.
 *
 * Every request flowing through the agent platform gets a correlation ID.
 * It appears in response headers, webhook envelopes, event bus emissions,
 * and MCP cost entries for end-to-end traceability.
 */

export interface HeadersLike {
  readonly [name: string]: string | undefined;
}

export function getCorrelationId(headers: HeadersLike): string {
  return (
    headers['x-request-id'] ??
    headers['X-Request-Id'] ??
    headers['x-correlation-id'] ??
    headers['X-Correlation-Id'] ??
    crypto.randomUUID()
  );
}

export function correlationHeaders(
  correlationId: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    'X-Request-Id': correlationId,
    'X-Correlation-Id': correlationId,
  });
}

/**
 * Build a set of headers that forward the correlation ID to the next hop.
 */
export function forwardHeaders(
  correlationId: string,
  extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return Object.freeze({
    ...correlationHeaders(correlationId),
    ...extra,
  });
}
