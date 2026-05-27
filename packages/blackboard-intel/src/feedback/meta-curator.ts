/**
 * Meta-curator adapter — BLACKBOARD-INTEL.
 *
 * Pulls (post, quality-score-set) pairs out of the BLACKBOARD-CORE
 * port and the PostQualityScoresRepository, then projects them as
 * `BlackboardRawTrace` records that match the `RawTrace` contract of
 * `@borjie/meta-learning-conductor`. The conductor's curator then
 * shapes them into training `Example`s via its normal pipeline.
 *
 * Mapping:
 *
 *   prompt           = { postId, capabilityKind, parentThreadId, citationsCount }
 *   completion       = { content, citations }
 *   baseReward       = mean(groundedness, calibration, utility) - 0.5
 *                      (re-scaled to [-0.5, +0.5])
 *   coverageScore    = utility.score
 *   confidenceScore  = groundedness.score
 *   redactionPenalty = 0 (the BLACKBOARD-CORE post is already
 *                      tenant-scoped; PII redaction happens upstream)
 *
 * Pure function — no side effects. The caller routes the produced
 * traces into the conductor.
 *
 * @module @borjie/blackboard-intel/feedback/meta-curator
 */

import {
  BlackboardIntelError,
  type BlackboardCorePort,
  type BlackboardPostRef,
  type BlackboardRawTrace,
  type CapabilityRegistryPort,
  type PostQualityScore,
  type PostQualityScoresRepository,
  type QualityAxis,
} from '../types.js';
import { capabilityNameFor } from '../capability/register-blackboard-capabilities.js';

const CAPABILITY_VERSION = '1.0.0';

export interface MetaCuratorDeps {
  readonly blackboardCore: BlackboardCorePort;
  readonly scoresRepo: PostQualityScoresRepository;
  readonly registry: CapabilityRegistryPort;
}

export interface MetaCurator {
  /**
   * Build a `BlackboardRawTrace` for the given (tenant, post). Reads
   * the tip score per axis from the scores repo. Throws
   * `BlackboardIntelError('POST_NOT_FOUND')` when the post does not
   * exist OR when the score set is incomplete.
   */
  readonly buildTraceForPost: (
    tenantId: string,
    postId: string,
  ) => Promise<BlackboardRawTrace>;
}

export function createMetaCurator(deps: MetaCuratorDeps): MetaCurator {
  return {
    async buildTraceForPost(
      tenantId: string,
      postId: string,
    ): Promise<BlackboardRawTrace> {
      const post = await deps.blackboardCore.readPost(tenantId, postId);
      if (post === null) {
        throw new BlackboardIntelError(
          `post ${postId} not found for tenant ${tenantId}`,
          'POST_NOT_FOUND',
        );
      }
      if (post.tenantId !== tenantId) {
        throw new BlackboardIntelError(
          `cross-tenant trace pull rejected for ${postId}`,
          'CROSS_TENANT_REJECTED',
        );
      }
      const tip = await deps.scoresRepo.tipPerAxis(tenantId, postId);
      const ground = tip['groundedness'];
      const calib = tip['calibration'];
      const util = tip['utility'];
      if (
        ground === undefined ||
        calib === undefined ||
        util === undefined
      ) {
        throw new BlackboardIntelError(
          `incomplete score set for post ${postId}`,
          'POST_NOT_FOUND',
        );
      }
      const capabilityId =
        (await deps.registry.lookup(
          tenantId,
          capabilityNameFor(post.authorKind),
          CAPABILITY_VERSION,
        )) ?? `unregistered:${post.authorKind}`;

      const meanScore =
        (ground.score + calib.score + util.score) / 3;
      const baseReward = meanScore - 0.5;

      return Object.freeze({
        id: postId,
        tenantId,
        capabilityId,
        prompt: Object.freeze(buildPrompt(post)),
        completion: Object.freeze(buildCompletion(post)),
        baseReward,
        coverageScore: util.score,
        confidenceScore: ground.score,
        redactionPenalty: 0,
        occurredAt: post.postedAt,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrompt(
  post: BlackboardPostRef,
): Readonly<Record<string, unknown>> {
  return {
    postId: post.id,
    capabilityKind: post.authorKind,
    parentThreadId: post.parentThreadId,
    citationsCount: post.citations.length,
  };
}

function buildCompletion(
  post: BlackboardPostRef,
): Readonly<Record<string, unknown>> {
  return {
    content: post.content,
    citations: [...post.citations],
    hedgeMarkers: [...post.hedgeMarkers],
  };
}

/**
 * Convenience: project a single PostQualityScore array (e.g. the
 * return value of `PostMeasurer.measure`) into a per-axis tip map.
 * Useful for callers that want to build a trace inline without
 * round-tripping the repo.
 */
export function tipPerAxisFromRows(
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
