/**
 * Stage 04 — Promote.
 *
 * Reads the reflections from stage 03 and decides what to do per
 * cluster:
 *
 *   - SUCCESS clusters that recur ≥ MIN_OCCURRENCES within the window
 *     with a stable I/O signature → upsert a `skill_registry` row.
 *   - FAILURE clusters → emit a `prompt-patch` proposal (for now, just
 *     a no-op record; the weekly DSPy compile pass picks them up).
 *   - MIXED clusters → no-op.
 *
 * Promotion criteria (per `2025-progressive-intelligence.md` §4):
 *   - cluster.traces.length >= 3                  (sticky pattern)
 *   - cluster.score >= 0.5                        (~80% positive)
 *   - the tool-call signature must be stable      (every trace in the
 *                                                  cluster carries the
 *                                                  same template hash)
 *
 * The `code_hash` of a candidate skill is sha256(intentLabel + canonical
 * tool-call template); the registry's UNIQUE INDEX on
 * (tenant_id, code_hash) lets re-runs of the same skill cluster bump
 * the existing row idempotently.
 */

import { createHash } from 'crypto';
import type {
  ConsolidationEmbedder,
  Mem0DecisionOutcome,
  Mem0DecisionPort,
  PromotionDecision,
  ReflectionResult,
  SkillRegistryPort,
  StageLogger,
  TraceCluster,
} from './types.js';

export const MIN_OCCURRENCES = 3;
export const MIN_SUCCESS_SCORE = 0.5;

/**
 * Environment toggle for the Mem0 ADD/UPDATE/DELETE/NOOP semantics
 * (Park et al. 2024, arXiv 2404.13501). When set to `'true'` AND a
 * `mem0` port is supplied, candidate skills are routed through the
 * Mem0 decision module before `upsertSkill`. Defaults OFF so the
 * legacy promote-on-threshold behaviour is preserved.
 */
export const MEM0_SEMANTICS_ENV_FLAG = 'MEM0_SEMANTICS_ENABLED';

function mem0SemanticsEnabled(): boolean {
  // Defensive: env may be undefined in non-Node contexts; trim and
  // case-fold so 'True' / ' true ' both work.
  const raw = (
    typeof process !== 'undefined' && process.env
      ? process.env[MEM0_SEMANTICS_ENV_FLAG]
      : undefined
  ) as string | undefined;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

export interface PromoteArgs {
  readonly clusters: ReadonlyArray<TraceCluster>;
  readonly reflections: ReadonlyArray<ReflectionResult>;
  readonly skillRegistry?: SkillRegistryPort;
  readonly embedder?: ConsolidationEmbedder;
  readonly logger: StageLogger;
  /**
   * Optional Mem0 decision port. When wired AND the
   * `MEM0_SEMANTICS_ENABLED` env flag is `'true'`, the stage routes
   * each promote-skill candidate through this port and short-circuits
   * on NOOP / DELETE. UPDATE flows through to `upsertSkill` (the
   * registry's UNIQUE INDEX on (tenant_id, code_hash) already
   * handles the supersession idempotently). When unset, the legacy
   * threshold-only promote flow runs unchanged.
   */
  readonly mem0?: Mem0DecisionPort;
}

export interface PromoteReport {
  readonly decisions: ReadonlyArray<PromotionDecision>;
  readonly skillsPromoted: number;
  readonly promptPatches: number;
}

export async function runPromoteStage(
  args: PromoteArgs,
): Promise<PromoteReport> {
  const decisions: PromotionDecision[] = [];
  let skillsPromoted = 0;
  let promptPatches = 0;

  const reflectionsById = new Map<string, ReflectionResult>(
    args.reflections.map((r) => [r.clusterId, r]),
  );

  for (const cluster of args.clusters) {
    const reflection = reflectionsById.get(cluster.clusterId);
    if (!reflection) {
      decisions.push({
        clusterId: cluster.clusterId,
        tenantId: cluster.tenantId,
        action: 'no-op',
        reason: 'no reflection produced for this cluster',
      });
      continue;
    }

    if (cluster.outcome === 'failure') {
      decisions.push({
        clusterId: cluster.clusterId,
        tenantId: cluster.tenantId,
        action: 'prompt-patch',
        reason: `failure cluster (${cluster.intentLabel}, score=${cluster.score.toFixed(2)})`,
      });
      promptPatches += 1;
      continue;
    }

    if (cluster.outcome === 'success') {
      if (cluster.traces.length < MIN_OCCURRENCES) {
        decisions.push({
          clusterId: cluster.clusterId,
          tenantId: cluster.tenantId,
          action: 'no-op',
          reason: `success cluster too small (${cluster.traces.length} < ${MIN_OCCURRENCES})`,
        });
        continue;
      }
      if (cluster.score < MIN_SUCCESS_SCORE) {
        decisions.push({
          clusterId: cluster.clusterId,
          tenantId: cluster.tenantId,
          action: 'no-op',
          reason: `success cluster score too low (${cluster.score.toFixed(2)} < ${MIN_SUCCESS_SCORE})`,
        });
        continue;
      }
      // Build the skill candidate. Tool-call template is intentionally
      // minimal — the consolidation worker's real adapter would inspect
      // the dominant tool-call shape across the cluster's traces.
      const template = { intent: cluster.intentLabel };
      const codeHash = sha256(`${cluster.intentLabel}::${stableJson(template)}`);
      const skillName = cluster.intentLabel;
      const nlDescription = reflection.text;

      // Mem0 ADD/UPDATE/DELETE/NOOP gate — only fires when both the
      // port is wired AND the env flag is on. Keeps the legacy
      // promote-on-threshold behaviour intact for the default rollout.
      let mem0Decision: Mem0DecisionOutcome | null = null;
      if (args.mem0 && mem0SemanticsEnabled()) {
        try {
          mem0Decision = await args.mem0.decide(
            {
              factText: nlDescription,
              intentLabel: cluster.intentLabel,
            },
            { tenantId: cluster.tenantId },
          );
        } catch (error) {
          args.logger.warn(
            {
              stage: '04-promote',
              clusterId: cluster.clusterId,
              err: asMessage(error),
            },
            'mem0 decision port failed — falling back to legacy promote',
          );
          mem0Decision = null;
        }
      }
      if (mem0Decision && mem0Decision.kind === 'noop') {
        decisions.push({
          clusterId: cluster.clusterId,
          tenantId: cluster.tenantId,
          action: 'no-op',
          reason: `mem0 NOOP: ${mem0Decision.reason}`,
        });
        continue;
      }
      if (mem0Decision && mem0Decision.kind === 'delete') {
        // DELETE in Mem0 terms = candidate revokes a prior skill.
        // The skill_registry doesn't expose a delete path from this
        // stage (decay/retire is stage 05's job); we still skip the
        // upsert and emit a no-op so the auditor can spot the
        // revocation signal.
        decisions.push({
          clusterId: cluster.clusterId,
          tenantId: cluster.tenantId,
          action: 'no-op',
          reason: `mem0 DELETE (revocation): ${mem0Decision.reason}`,
        });
        continue;
      }

      if (args.skillRegistry) {
        let embedding: ReadonlyArray<number> | undefined;
        if (args.embedder) {
          try {
            embedding = await args.embedder.embed(nlDescription);
          } catch (error) {
            args.logger.warn(
              {
                stage: '04-promote',
                clusterId: cluster.clusterId,
                err: asMessage(error),
              },
              'embedder failed — promoting without an embedding',
            );
          }
        }
        try {
          const upsertArgs: {
            tenantId: string | null;
            name: string;
            nlDescription: string;
            toolCallTemplate: unknown;
            codeHash: string;
            embedding?: ReadonlyArray<number>;
          } = {
            tenantId: cluster.tenantId,
            name: skillName,
            nlDescription,
            toolCallTemplate: template,
            codeHash,
          };
          if (embedding) upsertArgs.embedding = embedding;
          await args.skillRegistry.upsertSkill(upsertArgs);
          skillsPromoted += 1;
        } catch (error) {
          args.logger.warn(
            {
              stage: '04-promote',
              clusterId: cluster.clusterId,
              err: asMessage(error),
            },
            'skill upsert failed',
          );
        }
      }
      decisions.push({
        clusterId: cluster.clusterId,
        tenantId: cluster.tenantId,
        action: 'promote-skill',
        reason: `success cluster (${cluster.traces.length} traces, score=${cluster.score.toFixed(2)})`,
        skillCandidate: {
          name: skillName,
          nlDescription,
          toolCallTemplate: template,
          codeHash,
        },
      });
      continue;
    }

    decisions.push({
      clusterId: cluster.clusterId,
      tenantId: cluster.tenantId,
      action: 'no-op',
      reason: 'mixed outcome — no action',
    });
  }

  args.logger.info(
    {
      stage: '04-promote',
      clusters: args.clusters.length,
      skillsPromoted,
      promptPatches,
    },
    'promote stage complete',
  );

  return { decisions, skillsPromoted, promptPatches };
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return `[${v.map(stableJson).join(',')}]`;
  }
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
