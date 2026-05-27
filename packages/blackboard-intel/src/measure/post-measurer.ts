/**
 * Post measurer — orchestrates the three quality axes per
 * blackboard post.
 *
 * Wave BLACKBOARD-INTEL. Given a post and the BLACKBOARD-CORE port,
 * we:
 *
 *   1. Resolve the post's citations through BlackboardCorePort.
 *   2. Compute groundedness, calibration, utility — three pure scorers.
 *   3. Emit three PostQualityScore rows, each audit-chained against
 *      the prior score in the tenant's chain.
 *
 * Side effects: persistence happens via the injected
 * PostQualityScoresRepository. The measurer returns the rows it
 * wrote so callers can route them downstream (e.g. into the
 * meta-curator).
 *
 * @module @borjie/blackboard-intel/measure/post-measurer
 */

import {
  BlackboardIntelError,
  type AuditChainPort,
  type BlackboardCorePort,
  type ClockPort,
  type Logger,
  type PostQualityScore,
  type PostQualityScoresRepository,
  type QualityAxis,
  type UuidPort,
} from '../types.js';
import { measureGroundedness } from './groundedness-scorer.js';
import { measureCalibration } from './calibration-scorer.js';
import { measureUtility } from './utility-scorer.js';

export interface PostMeasurerDeps {
  readonly blackboardCore: BlackboardCorePort;
  readonly repo: PostQualityScoresRepository;
  readonly auditChain: AuditChainPort;
  readonly clock: ClockPort;
  readonly uuid: UuidPort;
  readonly logger?: Logger;
}

export interface PostMeasurer {
  /**
   * Measure all three axes for the given post. Returns the rows
   * persisted. The order in the returned array is always
   * `[groundedness, calibration, utility]`.
   *
   * Throws `BlackboardIntelError('CROSS_TENANT_REJECTED')` if the
   * post's tenant_id does not match the request tenant.
   */
  readonly measure: (
    tenantId: string,
    postId: string,
  ) => Promise<ReadonlyArray<PostQualityScore>>;
}

export function createPostMeasurer(deps: PostMeasurerDeps): PostMeasurer {
  return {
    async measure(
      tenantId: string,
      postId: string,
    ): Promise<ReadonlyArray<PostQualityScore>> {
      const post = await deps.blackboardCore.readPost(tenantId, postId);
      if (post === null) {
        throw new BlackboardIntelError(
          `post ${postId} not found for tenant ${tenantId}`,
          'POST_NOT_FOUND',
        );
      }
      if (post.tenantId !== tenantId) {
        throw new BlackboardIntelError(
          `cross-tenant post access rejected for ${postId}`,
          'CROSS_TENANT_REJECTED',
        );
      }

      // ─── Resolve citations ─────────────────────────────────────────
      const resolvedIds =
        post.citations.length > 0
          ? await deps.blackboardCore.resolveCitations(
              tenantId,
              post.citations,
            )
          : ([] as ReadonlyArray<string>);

      // ─── Read the thread + cross-refs (used by calibration + utility)
      const crossRefs = await deps.blackboardCore.listCrossRefsTo(
        tenantId,
        postId,
      );
      const threadId = post.parentThreadId ?? postId;
      const threadPosts = await deps.blackboardCore.listThread(
        tenantId,
        threadId,
      );

      // ─── Score all three axes ──────────────────────────────────────
      const groundedness = measureGroundedness({
        post,
        resolvedCitationIds: resolvedIds,
      });
      const calibration = measureCalibration({
        post,
        followUps: crossRefs,
      });
      const utility = measureUtility({
        post,
        crossRefs,
        threadPosts,
      });

      // ─── Persist each axis with a chained audit hash ───────────────
      // We chain against the tip score in the tenant's chain at the
      // moment we read it: each row depends on the prior one.
      const prevTip = (await deps.repo.tipPerAxis(tenantId, postId)) as Readonly<
        Partial<Record<QualityAxis, PostQualityScore>>
      >;

      const rows: PostQualityScore[] = [];
      const startedAt = deps.clock.nowIso();

      const order: ReadonlyArray<readonly [QualityAxis, number]> = [
        ['groundedness', groundedness.score],
        ['calibration', calibration.score],
        ['utility', utility.score],
      ];

      let prevHashCarry: string =
        prevTip['utility']?.auditHash ??
        prevTip['calibration']?.auditHash ??
        prevTip['groundedness']?.auditHash ??
        '';

      for (const [axis, score] of order) {
        const id = deps.uuid.next();
        const payload: Readonly<Record<string, unknown>> = Object.freeze({
          id,
          tenantId,
          postId,
          axis,
          score,
          scoredAt: startedAt,
          prevHash: prevHashCarry,
        });
        const auditHash = deps.auditChain.hash(prevHashCarry, payload);
        const row: PostQualityScore = Object.freeze({
          id,
          tenantId,
          postId,
          axis,
          score,
          scoredAt: startedAt,
          prevHash: prevHashCarry,
          auditHash,
        });
        await deps.repo.insert(row);
        rows.push(row);
        prevHashCarry = auditHash;
      }

      deps.logger?.debug?.('post measured', {
        tenantId,
        postId,
        groundedness: groundedness.score,
        calibration: calibration.score,
        utility: utility.score,
      });

      return Object.freeze([...rows]);
    },
  };
}

/**
 * Wrap any underlying KS-invocation function so each call is followed
 * by an automatic post-measurement. Mirrors the structure of
 * `@borjie/intel-self-improve#wrapAsMeasured` but for blackboard
 * posts.
 *
 * The `fn` is expected to return an object containing `{ postId,
 * tenantId }`; after the call, the wrapper invokes
 * `postMeasurer.measure(tenantId, postId)` as fire-and-forget.
 */
export function wrapKsInvocationAsMeasured<TInput>(
  fn: (
    input: TInput,
  ) => Promise<Readonly<{ postId: string; tenantId: string }>>,
  postMeasurer: PostMeasurer,
  logger?: Logger,
): (input: TInput) => Promise<Readonly<{ postId: string; tenantId: string }>> {
  return async function measured(
    input: TInput,
  ): Promise<Readonly<{ postId: string; tenantId: string }>> {
    const result = await fn(input);
    try {
      await postMeasurer.measure(result.tenantId, result.postId);
    } catch (err) {
      // Best-effort — measurement failures must not propagate.
      const message = err instanceof Error ? err.message : String(err);
      logger?.warn?.('post measurement failed', {
        postId: result.postId,
        tenantId: result.tenantId,
        message,
      });
    }
    return result;
  };
}

/**
 * Default ordering of axes — exported for tests and downstream
 * consumers.
 */
export const AXIS_ORDER: ReadonlyArray<QualityAxis> = Object.freeze([
  'groundedness',
  'calibration',
  'utility',
]);

/**
 * Stub used by the post-measurer to satisfy the
 * post-quality-scores tip-per-axis fast path when an in-memory
 * adapter does not implement it natively. Pure function over an
 * array of rows.
 */
export function tipPerAxisOver(
  rows: ReadonlyArray<PostQualityScore>,
): Readonly<Partial<Record<QualityAxis, PostQualityScore>>> {
  const out: Partial<Record<QualityAxis, PostQualityScore>> = {};
  for (const r of rows) {
    const existing = out[r.axis];
    if (
      existing === undefined ||
      Date.parse(r.scoredAt) > Date.parse(existing.scoredAt)
    ) {
      out[r.axis] = r;
    }
  }
  return Object.freeze(out);
}
