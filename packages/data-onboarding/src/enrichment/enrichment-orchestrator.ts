/**
 * Stage 7 — Enrichment orchestrator.
 *
 * Coordinates the per-row dispatch across the configured adapters,
 * collects findings, computes overall quality, and seals an audit
 * hash for the enrichment result.
 *
 * Budget control: the orchestrator reads
 * `ctx.budget_usd_cents` and refuses to proceed when the projected
 * call count would exceed it. Per-adapter cost is estimated by the
 * static `ADAPTER_UNIT_COST_CENTS` map; production wiring overrides.
 */

import { hashChainEntry } from '@borjie/audit-hash-chain';
import type {
  EnrichedField,
  EnrichmentCtx,
  EnrichmentResult,
  EnrichmentQuality,
  PersistedRow,
  RowEnrichment,
  VerificationFinding,
} from '../types.js';
import { DataOnboardingError } from '../types.js';
import type { NidaVerifier } from './adapters/nida-verifier.js';
import type { NssfVerifier } from './adapters/nssf-verifier.js';
import type { LinkedinVerifier } from './adapters/linkedin-verifier.js';
import type { CertVerifier } from './adapters/cert-verifier.js';
import type { SalaryBenchmarker } from './adapters/salary-benchmark.js';

export interface RowInputForEnrichment {
  readonly row: PersistedRow;
  readonly nida?: string;
  readonly worker_name?: string;
  readonly cert_id?: string;
  readonly role?: string;
  readonly location?: string;
}

export interface EnrichmentAdapters {
  readonly nida?: NidaVerifier;
  readonly nssf?: NssfVerifier;
  readonly linkedin?: LinkedinVerifier;
  readonly cert?: CertVerifier;
  readonly salary?: SalaryBenchmarker;
}

const ADAPTER_UNIT_COST_CENTS: Readonly<Record<string, number>> = Object.freeze(
  {
    nida: 2,
    nssf: 2,
    linkedin: 5,
    cert_registry: 3,
    salary_benchmark: 4,
  },
);

function projectedCostCents(
  rows: ReadonlyArray<RowInputForEnrichment>,
  adapters: EnrichmentAdapters,
): number {
  let cost = 0;
  for (const _row of rows) {
    if (adapters.nida !== undefined) cost += ADAPTER_UNIT_COST_CENTS.nida ?? 0;
    if (adapters.nssf !== undefined) cost += ADAPTER_UNIT_COST_CENTS.nssf ?? 0;
    if (adapters.linkedin !== undefined)
      cost += ADAPTER_UNIT_COST_CENTS.linkedin ?? 0;
    if (adapters.cert !== undefined)
      cost += ADAPTER_UNIT_COST_CENTS.cert_registry ?? 0;
    if (adapters.salary !== undefined)
      cost += ADAPTER_UNIT_COST_CENTS.salary_benchmark ?? 0;
  }
  return cost;
}

function classifyOverallQuality(
  per_row: ReadonlyArray<RowEnrichment>,
): EnrichmentQuality {
  if (per_row.length === 0) return 'low';
  const confirmed = per_row.reduce(
    (acc, r) => acc + r.verifications.filter((v) => v.confirmed).length,
    0,
  );
  const total = per_row.reduce((acc, r) => acc + r.verifications.length, 0);
  if (total === 0) return 'low';
  const ratio = confirmed / total;
  if (ratio >= 0.8) return 'high';
  if (ratio >= 0.5) return 'medium';
  return 'low';
}

export async function enrichRows(
  rows: ReadonlyArray<RowInputForEnrichment>,
  adapters: EnrichmentAdapters,
  ctx: EnrichmentCtx,
): Promise<EnrichmentResult> {
  const projected = projectedCostCents(rows, adapters);
  if (projected > ctx.budget_usd_cents) {
    throw new DataOnboardingError(
      'enrichment_budget_exhausted',
      `enrichment cost ${projected} cents exceeds budget ${ctx.budget_usd_cents} cents`,
    );
  }

  const per_row: RowEnrichment[] = [];
  for (const input of rows) {
    const verifications: VerificationFinding[] = [];
    const enriched_fields: EnrichedField[] = [];
    const flagged: string[] = [];

    if (
      adapters.nida !== undefined &&
      input.nida !== undefined &&
      ctx.allowed_adapters.includes('nida')
    ) {
      const v = await adapters.nida.verify(input.nida);
      verifications.push(v);
      if (!v.confirmed) flagged.push('nida_verification_failed');
    }
    if (
      adapters.nssf !== undefined &&
      input.nida !== undefined &&
      ctx.allowed_adapters.includes('nssf')
    ) {
      const args: { nida: string; worker_name?: string } = { nida: input.nida };
      if (input.worker_name !== undefined) args.worker_name = input.worker_name;
      verifications.push(await adapters.nssf.verify(args));
    }
    if (
      adapters.linkedin !== undefined &&
      input.worker_name !== undefined &&
      ctx.allowed_adapters.includes('linkedin')
    ) {
      verifications.push(
        await adapters.linkedin.verify({ worker_name: input.worker_name }),
      );
    }
    if (
      adapters.cert !== undefined &&
      input.cert_id !== undefined &&
      ctx.allowed_adapters.includes('cert_registry')
    ) {
      verifications.push(await adapters.cert.verify({ cert_id: input.cert_id }));
    }
    if (
      adapters.salary !== undefined &&
      input.role !== undefined &&
      input.location !== undefined &&
      ctx.allowed_adapters.includes('salary_benchmark')
    ) {
      const fields = await adapters.salary.benchmark({
        role: input.role,
        location: input.location,
      });
      for (const f of fields) enriched_fields.push(f);
    }

    per_row.push(
      Object.freeze({
        row_id: input.row.target_row_id,
        verifications: Object.freeze(verifications),
        enriched_fields: Object.freeze(enriched_fields),
        flagged_issues: Object.freeze(flagged),
      }),
    );
  }

  const overall_quality = classifyOverallQuality(per_row);
  const audit_hash = hashChainEntry({
    payload: Object.freeze({
      tenant_id: ctx.tenant_id,
      rows_count: rows.length,
      overall_quality,
    }),
    secretId: 'data_onboarding_enrichment_v1',
  });

  return Object.freeze({
    per_row: Object.freeze(per_row),
    overall_quality,
    audit_hash,
  });
}

export const __TEST_ONLY = Object.freeze({
  ADAPTER_UNIT_COST_CENTS,
  classifyOverallQuality,
  projectedCostCents,
});
