/**
 * Pure helper: run a mutation iff the supplied ETag still matches.
 *
 * Used by service layers that do NOT speak HTTP directly. Hono / REST
 * call-sites should use `requireIfMatch` middleware instead.
 *
 * Returns a discriminated union — callers do not need to wrap in
 * try/catch unless they want the error form.
 */

import { etag } from "./etag.js";
import { StaleResourceError } from "./errors.js";

export interface MutationResultOk<T> {
  readonly status: "ok";
  readonly result: T;
  readonly newETag: string;
}

export interface MutationResultStale {
  readonly status: "stale";
  readonly expectedETag: string;
  readonly actualETag: string;
}

export type MutationResult<T> = MutationResultOk<T> | MutationResultStale;

export interface WithETagPreconditionArgs<TResource, TResult> {
  /** Caller-supplied current resource (or null if it's been deleted). */
  readonly getResource: () => Promise<TResource | null>;
  /** ETag the caller believed the resource had. */
  readonly currentETag: string;
  /** Mutation — fed the resource, returns the new resource + result. */
  readonly mutate: (
    resource: TResource
  ) => Promise<{ next: TResource; result: TResult }>;
}

export async function withETagPrecondition<TResource, TResult>(
  args: WithETagPreconditionArgs<TResource, TResult>
): Promise<MutationResult<TResult>> {
  const resource = await args.getResource();
  if (resource === null) {
    return {
      status: "stale",
      expectedETag: args.currentETag,
      actualETag: "",
    };
  }
  const serverETag = etag(resource);
  const matches =
    args.currentETag === "*" ||
    args.currentETag === serverETag ||
    args.currentETag === stripWeakPrefix(serverETag);
  if (!matches) {
    return {
      status: "stale",
      expectedETag: args.currentETag,
      actualETag: serverETag,
    };
  }
  const { next, result } = await args.mutate(resource);
  return {
    status: "ok",
    result,
    newETag: etag(next),
  };
}

/**
 * Convenience wrapper that throws `StaleResourceError` instead of
 * returning a stale variant. Useful in service code that wants
 * exceptional flow rather than branching.
 */
export async function withETagPreconditionOrThrow<TResource, TResult>(
  args: WithETagPreconditionArgs<TResource, TResult>
): Promise<{ result: TResult; newETag: string }> {
  const out = await withETagPrecondition(args);
  if (out.status === "stale") {
    throw new StaleResourceError(out.expectedETag, out.actualETag);
  }
  return { result: out.result, newETag: out.newETag };
}

function stripWeakPrefix(s: string): string {
  return s.startsWith("W/") ? s.slice(2) : s;
}
