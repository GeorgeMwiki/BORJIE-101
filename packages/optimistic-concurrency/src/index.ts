/**
 * `@borjie/optimistic-concurrency` — public surface.
 *
 * LITFIN-parity item 2. Two strategies for the same problem (multi-
 * user lost-update):
 *
 *   - HTTP layer: ETag + If-Match + 412 (`etag`, `requireIfMatch`,
 *     `withETagPrecondition`)
 *   - DB layer:   version-column + WHERE clause + retry
 *     (`withVersionColumn`)
 *
 * Live test will have multi-user lease editing — without these,
 * silent overwrites are guaranteed.
 */

export {
  StaleResourceError,
  VersionConflictExhaustedError,
} from "./errors.js";
export { etag, etagMatches, normaliseETag } from "./etag.js";
export {
  withETagPrecondition,
  withETagPreconditionOrThrow,
  type MutationResult,
  type MutationResultOk,
  type MutationResultStale,
  type WithETagPreconditionArgs,
} from "./etag-precondition.js";
export {
  requireIfMatch,
  type RequireIfMatchOptions,
} from "./require-if-match.js";
export {
  withVersionColumn,
  type VersionedRow,
  type WithVersionColumnArgs,
} from "./version-column.js";
