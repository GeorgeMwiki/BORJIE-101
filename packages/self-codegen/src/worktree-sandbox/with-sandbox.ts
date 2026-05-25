/**
 * `withSandbox` — convenience wrapper that guarantees `cleanup()` runs
 * regardless of whether the body throws.
 *
 * Use this in callers that want the "Python `with`" experience:
 *
 *   await withSandbox(request, async (sb) => {
 *     // ... cleanup is guaranteed
 *   });
 */

import { createSandbox, type CreateSandboxDeps } from './create-sandbox.js';
import { type Sandbox, type SandboxRequest } from './types.js';

export async function withSandbox<T>(
  request: SandboxRequest,
  body: (sb: Sandbox) => Promise<T>,
  deps?: CreateSandboxDeps,
): Promise<T> {
  const sandbox = await createSandbox(request, deps);
  let bodyError: unknown;
  let value: T | undefined;
  try {
    value = await body(sandbox);
  } catch (e) {
    bodyError = e;
  }
  // Cleanup is mandatory. We swallow cleanup errors when a body error is
  // already in flight (to preserve the original cause) but log them so they
  // still reach observability via the audit hook.
  try {
    await sandbox.cleanup();
  } catch (cleanupErr) {
    if (bodyError === undefined) {
      throw cleanupErr;
    }
    // Body already failed — surface the body error and tag cleanup error.
    (bodyError as Error & { cleanupError?: unknown }).cleanupError = cleanupErr;
  }
  if (bodyError !== undefined) throw bodyError;
  return value as T;
}
