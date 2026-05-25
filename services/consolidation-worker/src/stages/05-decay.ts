/**
 * Stage 05 — Decay.
 *
 * Applies multiplicative confidence decay to the semantic-memory
 * facts across every tenant in the batch. Re-uses the existing
 * `semantic.decay(tenantId, decayPerDay)` port (migration 0121) — we
 * just invoke it once per tenant whose traces participated in this
 * window.
 *
 * The decay factor is chosen at the composition root; the default
 * 0.995 = ~0.5% daily decay (LITFIN-equivalent).
 */

import type { SemanticDecayPort, StageLogger } from './types.js';

export const DEFAULT_DECAY_PER_DAY = 0.995;

export interface DecayArgs {
  readonly tenantIds: ReadonlyArray<string | null>;
  readonly semantic?: SemanticDecayPort;
  readonly decayPerDay?: number;
  readonly logger: StageLogger;
}

export interface DecayReport {
  readonly factsDecayed: number;
  readonly perTenant: Record<string, number>;
}

export async function runDecayStage(args: DecayArgs): Promise<DecayReport> {
  const perTenant: Record<string, number> = {};
  let total = 0;
  if (!args.semantic) {
    args.logger.info(
      { stage: '05-decay' },
      'decay stage skipped (no semantic port wired)',
    );
    return { factsDecayed: 0, perTenant };
  }
  const factor = args.decayPerDay ?? DEFAULT_DECAY_PER_DAY;
  const unique = uniqueTenants(args.tenantIds);
  for (const tenantId of unique) {
    try {
      const n = await args.semantic.decay({
        tenantId,
        decayPerDay: factor,
      });
      const safeKey = tenantId ?? '__global__';
      perTenant[safeKey] = Number(n ?? 0);
      total += Number(n ?? 0);
    } catch (error) {
      args.logger.warn(
        {
          stage: '05-decay',
          tenantId,
          err: asMessage(error),
        },
        'decay failed for tenant',
      );
    }
  }
  args.logger.info(
    { stage: '05-decay', factsDecayed: total, tenants: unique.length },
    'decay stage complete',
  );
  return { factsDecayed: total, perTenant };
}

function uniqueTenants(
  ids: ReadonlyArray<string | null>,
): ReadonlyArray<string | null> {
  const seen = new Set<string>();
  const out: Array<string | null> = [];
  for (const id of ids) {
    const k = id ?? '__null__';
    if (!seen.has(k)) {
      seen.add(k);
      out.push(id);
    }
  }
  return out;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
