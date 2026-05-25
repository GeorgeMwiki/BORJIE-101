/**
 * Concurrency errors.
 *
 * `StaleResourceError` is the single failure mode call-sites must
 * handle: someone else mutated the resource between read and write.
 * Distinguished from generic errors via `code = "STALE_RESOURCE"` so
 * Hono/Fastify error mappers can translate to HTTP 412.
 */

export class StaleResourceError extends Error {
  public readonly code = "STALE_RESOURCE" as const;
  public readonly expectedETag: string;
  public readonly actualETag: string;

  constructor(expectedETag: string, actualETag: string) {
    super(
      `Stale resource: expected ETag ${expectedETag} but got ${actualETag}`
    );
    this.name = "StaleResourceError";
    this.expectedETag = expectedETag;
    this.actualETag = actualETag;
  }
}

/**
 * Thrown when retry budget exhausted on a version-column update.
 * Indicates pathological contention — caller should back off and
 * re-fetch.
 */
export class VersionConflictExhaustedError extends Error {
  public readonly code = "VERSION_CONFLICT_EXHAUSTED" as const;
  public readonly attempts: number;

  constructor(attempts: number) {
    super(`Version-column update gave up after ${attempts} attempts`);
    this.name = "VersionConflictExhaustedError";
    this.attempts = attempts;
  }
}
