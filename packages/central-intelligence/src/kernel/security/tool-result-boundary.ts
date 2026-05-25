/**
 * Tool-result boundary tagging — EP-3 red-team CRITICAL #2.
 *
 * Tool results are UNTRUSTED data, not instructions. When the kernel
 * splices tool output into the LLM context (system / user / tool zone),
 * an attacker who controls the tool's data source (e.g. a poisoned MCP
 * endpoint, a malicious row in a database the tool reads, a third-party
 * webhook payload) can embed instructions inside the result and have
 * them executed by the LLM.
 *
 * Defence-in-depth: wrap every tool result in a nonce-bracketed sentinel
 * pair that:
 *
 *   1. Marks the bytes as DATA — the kernel's system prompt already
 *      instructs the model to treat anything inside the bracket as
 *      untrusted JSON, never as commands.
 *   2. Uses a per-session nonce so an attacker who controls the data
 *      source cannot forge the close-tag (without knowing the nonce).
 *   3. Always JSON-stringifies the result so embedded newlines / quotes
 *      / control chars are escaped and cannot break the bracket.
 *
 * The nonce is supplied by the caller (typically derived from the
 * session via `buildPromptBoundaries(sessionId).toolResultStart`) so
 * the boundary aligns with the prompt-shield's wider sentinel scheme.
 * Pure function — no side effects, no hidden state.
 */

export interface WrapToolResultArgs {
  /** Arbitrary structured payload returned by a tool executor. */
  readonly result: unknown;
  /**
   * Per-session unpredictable nonce. The caller MUST source this from
   * a cryptographic RNG (e.g. crypto.randomBytes(16).toString('hex')).
   * The same nonce should be used for every tool-result wrap in a
   * single LLM context window so the kernel's system prompt can
   * declare the bracket scheme once.
   */
  readonly nonce: string;
}

/**
 * Wrap a tool result with a nonce-bracketed sentinel pair.
 *
 * Example output (nonce = "abc123"):
 *   [TOOL_DATA_NOT_INSTRUCTIONS_abc123]
 *   {"rentDue":"2026-06-01","amount":450000}
 *   [END_TOOL_DATA_abc123]
 *
 * The function never throws — non-serialisable values (functions,
 * BigInt, circular refs) are replaced with a redaction marker so the
 * envelope is always emittable.
 */
export function wrapToolResult(result: unknown, nonce: string): string;
export function wrapToolResult(args: WrapToolResultArgs): string;
export function wrapToolResult(
  resultOrArgs: unknown,
  nonceArg?: string,
): string {
  const result =
    nonceArg === undefined
      ? (resultOrArgs as WrapToolResultArgs).result
      : resultOrArgs;
  const nonce =
    nonceArg === undefined
      ? (resultOrArgs as WrapToolResultArgs).nonce
      : nonceArg;

  if (typeof nonce !== 'string' || nonce.length === 0) {
    throw new Error(
      'wrapToolResult: nonce is required and must be a non-empty string',
    );
  }

  const open = `[TOOL_DATA_NOT_INSTRUCTIONS_${nonce}]`;
  const close = `[END_TOOL_DATA_${nonce}]`;
  const body = safeStringify(result);
  // The body cannot contain the close tag because nonce is
  // unguessable per-session AND we JSON-stringify (which would escape
  // any literal `[END_TOOL_DATA_<nonce>]` an attacker pasted into a
  // string field — square brackets pass through JSON unchanged, but
  // see `containsBoundaryMarker` below for an explicit re-check).
  return `${open}\n${body}\n${close}`;
}

/**
 * Defensive check — returns true if the rendered tool result body
 * contains either sentinel for the given nonce. Used by the kernel
 * to log a security event when a tool returned data that looked like
 * it was trying to forge the close tag (must not happen if the nonce
 * has enough entropy, but cheap to verify).
 */
export function containsBoundaryMarker(text: string, nonce: string): boolean {
  if (typeof text !== 'string' || typeof nonce !== 'string') return false;
  return (
    text.includes(`[TOOL_DATA_NOT_INSTRUCTIONS_${nonce}]`) ||
    text.includes(`[END_TOOL_DATA_${nonce}]`)
  );
}

/**
 * Stringify with a deterministic fallback so the wrapper never throws
 * on circular refs or non-JSON values. Keeps the boundary contract
 * (always emittable) intact.
 */
function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  try {
    return JSON.stringify(value, replaceUnsafe);
  } catch {
    // JSON.stringify can throw on circular refs even with a replacer.
    return JSON.stringify({ __wrap_error: 'unstringifiable' });
  }
}

function replaceUnsafe(_key: string, value: unknown): unknown {
  if (typeof value === 'function') return '[redacted-function]';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return '[redacted-symbol]';
  if (value === undefined) return null;
  return value;
}
