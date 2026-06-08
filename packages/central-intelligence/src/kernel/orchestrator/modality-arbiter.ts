/**
 * Modality arbiter (COG-07 / AUT-14, the Wave-B keystone).
 *
 * On each consequential brain turn the arbiter post-classifies the LLM
 * router's already-emitted `Decision` into exactly ONE of seven CLOSED
 * output modalities — chat | tab | document | media | action | skill |
 * workflow(+loop) — then routes. This is the single 7-way head that
 * captured skills (B) and discovered workflows (D) finally land on.
 *
 * Three-tier cascade (2026 SOTA "rule → semantic → LLM" routing):
 *   - Tier 0 (sub-ms, no I/O): rule short-circuit. A `tool_call` with no
 *     learned skill/flow → `action`; a pure text answer → `chat`. The
 *     majority of turns stop here and NEVER touch an embedder or LLM.
 *   - Tier 1 (single pgvector query): embed the intent once, cosine-match
 *     against skill / flow / recipe descriptors. Top match ≥ τ wins.
 *   - Tier 2 (single cheap LLM call): only when 0 < topScore < τ — a
 *     budget-bounded label call returns one of the seven labels.
 *
 * Closed-set discipline: the arbiter NEVER invents a modality. An
 * unrecognised classifier output FAILS CLOSED to `chat` (zero side
 * effects) and records a telemetry reason — mirroring the existing
 * fail-closed default in `tool-dispatcher.ts`.
 *
 * Autonomy / rails (the AUT-14 half): the chosen modality is only
 * PROPOSED. Whether it auto-executes vs gates is decided by the injected,
 * rail-composed `autonomyDecider` port. The verdict is ADDITIVE and may
 * only ESCALATE — a rail-GATED modality stays gated; the arbiter may turn
 * a rail-ALLOWED modality INTO a gate, never the reverse. Money / licence
 * / deletion stay dual-control HITL forever; the arbiter has NO path to
 * relax that. Any modality that GROWS capability routes its persistence
 * through the body-change syscall (`bodyChangePort`) — the meta-rail.
 *
 * @module kernel/orchestrator/modality-arbiter
 */

import type { Decision } from './decision.js';
import {
  type Modality,
  type ModalityArbiter,
  type ModalityArbiterDeps,
  type ModalityArbiterInput,
  type ModalityVerdict,
  type AutonomyDeciderInput,
  type AutonomyDeciderOutput,
  type ConsequenceTier,
  type Reversibility,
  type RetrievedSkill,
  type RetrievedFlow,
  type ModalityDescriptor,
  isModality,
  MODALITIES,
} from './modality-arbiter-types.js';

/** The SOTA hybrid confidence threshold below which Tier-2 LLM tie-breaks. */
export const DEFAULT_MODALITY_TAU = 0.85;

/** Default nearest-neighbour fan-out. */
export const DEFAULT_MODALITY_TOP_K = 5;

/** The always-safe, zero-side-effect fail-closed verdict. */
function chatVerdict(
  reason: string,
  tier: ModalityVerdict['tier'] = 'tier0',
): ModalityVerdict {
  return { modality: 'chat', score: 0, tier, reason };
}

/**
 * Static reversibility / consequence per modality (spec §1 table). The
 * autonomy decider receives these so a cheap reversible draft can run free
 * while an irreversible high-consequence act gates even at high confidence.
 */
function staticConsequence(modality: Modality): {
  readonly reversibility: Reversibility;
  readonly consequenceTier: ConsequenceTier;
} {
  switch (modality) {
    case 'chat':
      return { reversibility: 'reversible', consequenceTier: 'trivial' };
    case 'tab':
    case 'document':
    case 'media':
      // Drafts are staged (draft tab / WORM-sealed artifact / C2PA draft).
      return { reversibility: 'staged', consequenceTier: 'low' };
    case 'skill':
    case 'workflow':
    case 'action':
      // Inherit the underlying tool tiers — conservatively `moderate` here;
      // money/licence/deletion steps are escalated to `severe` by the rail.
      return { reversibility: 'staged', consequenceTier: 'moderate' };
    default:
      return { reversibility: 'staged', consequenceTier: 'moderate' };
  }
}

/** Cosine similarity in [0,1] for already-NORMALISED vectors falls back to
 * a full dot/‖a‖‖b‖ computation otherwise. Pure. */
function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  // Clamp into [0,1] — negative cosines are "no match" for routing.
  if (!Number.isFinite(sim)) return 0;
  return sim < 0 ? 0 : sim > 1 ? 1 : sim;
}

/** Best recipe descriptor (tab/doc/media) by cosine against the intent. */
function bestRecipe(
  intentVec: ReadonlyArray<number>,
  descriptors: ReadonlyArray<ModalityDescriptor>,
): { descriptor: ModalityDescriptor; score: number } | null {
  let best: { descriptor: ModalityDescriptor; score: number } | null = null;
  for (const d of descriptors) {
    const score = cosineSimilarity(intentVec, d.embedding);
    if (!best || score > best.score) best = { descriptor: d, score };
  }
  return best;
}

/**
 * Build a modality arbiter. All external concerns are injected ports; the
 * arbiter never reaches a package directly. An absent optional port simply
 * removes that modality from contention (e.g. no `skillRetriever` ⇒ skills
 * are never selected) — degrading TOWARD `chat`/`action`, the safe set.
 */
export function createModalityArbiter(
  deps: ModalityArbiterDeps,
): ModalityArbiter {
  const tau = deps.tau ?? DEFAULT_MODALITY_TAU;
  const topK = deps.topK ?? DEFAULT_MODALITY_TOP_K;

  // ── Tier 0 — rule short-circuit. No I/O. ───────────────────────────
  // Returns a verdict when the rule layer is confident; `null` means
  // "ask the semantic tier".
  function tier0(decision: Decision): ModalityVerdict | null {
    // A pure text answer with no tool intent is a `chat`.
    if (decision.kind === 'respond_to_owner' || decision.kind === 'final') {
      return chatVerdict('tier0: pure text answer → chat');
    }
    // schedule_wake / monitor are control-plane, not output modalities —
    // leave them as today (the main-loop dispatches them unchanged). We
    // signal "no lift" by mapping to `action` so the lift is a no-op.
    if (decision.kind === 'schedule_wake' || decision.kind === 'monitor') {
      return {
        modality: 'action',
        score: 0,
        tier: 'tier0',
        reason: `tier0: ${decision.kind} is control-plane → action (no lift)`,
      };
    }
    // spawn_sub_md is already a higher-order execution — keep as `action`.
    if (decision.kind === 'spawn_sub_md') {
      return {
        modality: 'action',
        score: 0,
        tier: 'tier0',
        reason: 'tier0: spawn_sub_md → action (no lift)',
      };
    }
    // `tool_call` falls through to Tier 1: a learned skill / flow may cover
    // it better than a raw tool. If nothing matches, Tier 1 returns `action`.
    return null;
  }

  // ── Tier 1 — embedding nearest-neighbour. Single embed + retrievals. ─
  async function tier1(
    input: ModalityArbiterInput,
  ): Promise<{ verdict: ModalityVerdict | null; topScore: number }> {
    const intentVec = await deps.embedder.embed(input.intentText);
    if (intentVec.length === 0) {
      // Embedder unavailable / null embedder — degrade to action for a
      // tool_call (cannot semantically route without a vector).
      return {
        verdict: {
          modality: 'action',
          score: 0,
          tier: 'tier1',
          reason: 'tier1: empty intent embedding → action',
        },
        topScore: 0,
      };
    }

    const [skills, flows] = await Promise.all([
      deps.skillRetriever
        ? deps.skillRetriever.retrieve({ intentEmbedding: intentVec, topK })
        : Promise.resolve<ReadonlyArray<RetrievedSkill>>([]),
      deps.flowRetriever
        ? deps.flowRetriever.retrieve({ intentEmbedding: intentVec, topK })
        : Promise.resolve<ReadonlyArray<RetrievedFlow>>([]),
    ]);

    // Only `active && human_reviewed` skills are SELECTABLE (spec §4).
    const bestSkill = skills
      .filter((s) => s.status === 'active' && s.humanReviewed)
      .reduce<RetrievedSkill | null>(
        (acc, s) => (!acc || s.score > acc.score ? s : acc),
        null,
      );
    const bestFlow = flows.reduce<RetrievedFlow | null>(
      (acc, f) => (!acc || f.score > acc.score ? f : acc),
      null,
    );
    const recipe = deps.recipeDescriptors
      ? bestRecipe(intentVec, deps.recipeDescriptors)
      : null;

    const candidates: Array<{ score: number; verdict: ModalityVerdict }> = [];
    if (bestSkill) {
      candidates.push({
        score: bestSkill.score,
        verdict: {
          modality: 'skill',
          skillId: bestSkill.skillId,
          score: bestSkill.score,
          tier: 'tier1',
          reason: `tier1: learned skill ${bestSkill.skillId} matched (cos=${bestSkill.score.toFixed(3)})`,
        },
      });
    }
    if (bestFlow) {
      candidates.push({
        score: bestFlow.score,
        verdict: {
          modality: 'workflow',
          flowId: bestFlow.flowId,
          ...(bestFlow.loopKind ? { loopKind: bestFlow.loopKind } : {}),
          score: bestFlow.score,
          tier: 'tier1',
          reason: `tier1: workflow ${bestFlow.flowId}${bestFlow.loopKind ? ` (loop=${bestFlow.loopKind})` : ''} matched (cos=${bestFlow.score.toFixed(3)})`,
        },
      });
    }
    if (recipe) {
      candidates.push({
        score: recipe.score,
        verdict: {
          modality: recipe.descriptor.modality,
          recipeId: recipe.descriptor.recipeId,
          score: recipe.score,
          tier: 'tier1',
          reason: `tier1: ${recipe.descriptor.modality} recipe ${recipe.descriptor.recipeId} matched (cos=${recipe.score.toFixed(3)})`,
        },
      });
    }

    const top = candidates.reduce<{ score: number; verdict: ModalityVerdict } | null>(
      (acc, c) => (!acc || c.score > acc.score ? c : acc),
      null,
    );
    const topScore = top?.score ?? 0;

    if (top && topScore >= tau) {
      return { verdict: top.verdict, topScore };
    }
    // No confident semantic match. If the router already emitted a
    // tool_call, the safe default is `action`; otherwise Tier 2 / chat.
    return { verdict: null, topScore };
  }

  // ── Tier 2 — single cheap LLM tie-break. Budget-bounded (one call). ──
  async function tier2(
    input: ModalityArbiterInput,
  ): Promise<ModalityVerdict> {
    if (!deps.llmTieBreak) {
      // No tie-break port → fall closed. A tool_call stays `action`.
      if (input.decision.kind === 'tool_call') {
        return {
          modality: 'action',
          score: 0,
          tier: 'tier2',
          reason: 'tier2: no tie-break port; tool_call → action',
        };
      }
      return chatVerdict('tier2: no tie-break port → chat', 'tier2');
    }
    const out = await deps.llmTieBreak.classify({
      intentText: input.intentText,
      candidates: MODALITIES,
      ...(input.languageDirective
        ? { languageDirective: input.languageDirective }
        : {}),
    });
    if (!isModality(out.modality)) {
      // Closed-set discipline: an unknown label FAILS CLOSED to chat.
      deps.logger?.warn('modality-arbiter: unknown LLM label, fail-closed', {
        label: String(out.modality),
      });
      return chatVerdict(
        'fail-closed: unknown classifier label → chat',
        'fail-closed',
      );
    }
    return {
      modality: out.modality,
      score: 0,
      tier: 'tier2',
      reason: out.reason || `tier2: LLM tie-break → ${out.modality}`,
    };
  }

  // ── Autonomy composition + meta-rail. ──────────────────────────────
  async function applyAutonomyAndMetaRail(
    input: ModalityArbiterInput,
    verdict: ModalityVerdict,
  ): Promise<ModalityVerdict> {
    // chat is pure text — no autonomy, no rail.
    if (verdict.modality === 'chat') return verdict;

    let out: ModalityVerdict = verdict;

    // Meta-rail — any modality that GROWS capability must route its
    // persistence through the body-change syscall. We never write the row;
    // we ask the executor to authorize the intent. If it refuses, we fall
    // closed to chat (capability growth denied) rather than proceeding.
    const growsCapability =
      (verdict.modality === 'skill' || verdict.modality === 'workflow' || verdict.modality === 'tab');
    if (growsCapability && deps.bodyChangePort) {
      const kind =
        verdict.modality === 'skill'
          ? ('register_skill' as const)
          : verdict.modality === 'tab'
            ? ('spawn_tab' as const)
            : ('register_workflow' as const);
      const subjectId =
        verdict.skillId ?? verdict.flowId ?? verdict.recipeId ?? verdict.modality;
      const authz = await deps.bodyChangePort.authorizeBodyChange({
        kind,
        tenantId: input.tenantId,
        subjectId,
        reason: verdict.reason,
      });
      if (!authz.authorized) {
        deps.logger?.warn('modality-arbiter: body-change denied, fail-closed', {
          modality: verdict.modality,
          subjectId,
          reason: authz.reason,
        });
        return chatVerdict(
          `fail-closed: body-change denied (${authz.reason}) → chat`,
          'fail-closed',
        );
      }
      out = { ...out, bodyChangeAuthorized: true };
    }

    // Rail-composed autonomy verdict — ADDITIVE, escalate-only.
    if (deps.autonomyDecider) {
      const statics = staticConsequence(verdict.modality);
      // Resolve the per-flow mandate ceiling (workflow id, or a synthetic
      // per-tenant default for ad-hoc modalities).
      let mandate: AutonomyDeciderInput['mandate'] = 'consultant';
      let consequenceTier = statics.consequenceTier;
      if (deps.flowPosturePort) {
        const flowId = verdict.flowId ?? `__adhoc__:${verdict.modality}`;
        const posture = await deps.flowPosturePort.posture({
          tenantId: input.tenantId,
          flowId,
        });
        mandate = posture.mandate;
        if (posture.riskCeiling) consequenceTier = posture.riskCeiling;
      }
      const autonomy: AutonomyDeciderOutput = await deps.autonomyDecider({
        calibratedConfidence: input.calibratedConfidence,
        consequenceTier,
        reversibility: statics.reversibility,
        mandate,
        ...(input.situationFlags ? { situationFlags: input.situationFlags } : {}),
        ...(input.railGated ? { railGated: true } : {}),
      });
      out = { ...out, autonomy };
    }
    return out;
  }

  return {
    async classify(input: ModalityArbiterInput): Promise<ModalityVerdict> {
      try {
        // Tier 0 — rule short-circuit (no embedder call on this path).
        const t0 = tier0(input.decision);
        if (t0) return applyAutonomyAndMetaRail(input, t0);

        // Tier 1 — semantic nearest-neighbour.
        const { verdict: t1, topScore } = await tier1(input);
        if (t1) return applyAutonomyAndMetaRail(input, t1);

        // Between 0 and τ → Tier 2 LLM tie-break. At exactly 0 with a
        // tool_call we still tie-break (the router wanted to act); a 0 score
        // text turn falls to chat.
        if (topScore <= 0 && input.decision.kind !== 'tool_call') {
          return applyAutonomyAndMetaRail(input, chatVerdict('tier1: no match → chat', 'tier1'));
        }
        const t2 = await tier2(input);
        return applyAutonomyAndMetaRail(input, t2);
      } catch (err) {
        // Any failure FAILS CLOSED to chat (the always-safe modality) —
        // a classifier error never crashes the turn nor escalates autonomy.
        deps.logger?.warn('modality-arbiter: classify threw, fail-closed', {
          reason: err instanceof Error ? err.message : 'arbiter error',
        });
        return chatVerdict('fail-closed: classify error → chat', 'fail-closed');
      }
    },
  };
}

/**
 * Lift a router-emitted `Decision` into the modality the arbiter chose.
 *
 * Only `skill` and the higher-order modalities (`tab`/`document`/`media`/
 * `workflow`) lift; `chat` and `action` are no-ops (the existing
 * `respond_to_owner` / `tool_call` / `spawn_sub_md` paths run unchanged —
 * the default fast path with zero added latency). The lifted Decision
 * still flows through the SAME permission-mode + 9-hook + risk-tier gates;
 * no rail is bypassed.
 *
 * Pure.
 */
export function liftToModalityDecision(
  decision: Decision,
  verdict: ModalityVerdict,
): Decision {
  switch (verdict.modality) {
    case 'chat':
    case 'action':
      // No lift — keep the router's existing Decision.
      return decision;
    case 'skill':
      if (!verdict.skillId) return decision;
      return {
        kind: 'run_skill',
        skillId: verdict.skillId,
        // Carry the original tool_call input as the skill params when present
        // so a learned skill that re-plays a parameterised tool sequence has
        // the same arguments the router intended.
        params:
          decision.kind === 'tool_call'
            ? decision.call.input
            : {},
      };
    case 'tab':
    case 'document':
    case 'media':
    case 'workflow':
      return {
        kind: 'run_modality',
        modality:
          verdict.modality === 'workflow' && verdict.loopKind
            ? 'loop'
            : verdict.modality,
        payload: {
          ...(verdict.flowId ? { flowId: verdict.flowId } : {}),
          ...(verdict.recipeId ? { recipeId: verdict.recipeId } : {}),
          ...(verdict.loopKind ? { loopKind: verdict.loopKind } : {}),
          ...(verdict.skillId ? { skillId: verdict.skillId } : {}),
          source: decision.kind,
        },
      };
    default:
      return decision;
  }
}
