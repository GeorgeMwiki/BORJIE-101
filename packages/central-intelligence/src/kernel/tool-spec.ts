/**
 * BrainToolSpec registry — the kernel-side deterministic tool layer.
 *
 * Mirrors LITFIN's `src/core/brain/tools.ts` (`BrainToolSpec` + register /
 * get / list / executeBrainTool), scoped to Borjie property
 * management. Closes Gap A from
 * `.planning/parity-litfin/09-tools-connectors-kg.md`:
 *
 *   > "Numeric/regulatory questions the kernel asks itself (e.g. arrears
 *   > coverage ratio, statutory notice period) are answered by the LLM's
 *   > intuition rather than a provable function."
 *
 * Each spec wraps a Zod-validated input + output executor with:
 *   - tier gating (`free` / `pro` / `enterprise` — distinct from the
 *     SaaS-billing tiers in @borjie/mcp-server; this is the
 *     INTERNAL-cost tier the brain reasons about)
 *   - `requiresApproval` for write-side / advisory tools (e.g. final
 *     statutory letter generation) — the kernel four-eye gate consults
 *     this before invoking
 *   - input + output validation: cross-tool contradictions caught here
 *     don't poison downstream reasoning
 *   - audit row persistence via an injectable `auditSink` so every
 *     deterministic call leaves a regulator-grade trail
 *
 * Seed catalog (5 property-management tools):
 *   1. lookupTenantArrears          read tenant.arrears_balance
 *   2. computeKraMri                Kenya Monthly Rental Income tax band
 *   3. checkComplianceCertificate   inspection-cert validity check
 *   4. getMarketRateBand            comparable-rent quartile lookup
 *   5. triageMaintenanceTicket      severity scoring + SLA window
 *
 * Composition root wires the executors to real domain services; tests
 * inject deterministic in-memory stubs.
 */

import { z } from 'zod';

// ---------- Public types ----------

export type BrainToolTier = 'free' | 'pro' | 'enterprise';

export interface BrainToolSpec<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schemaIn: z.ZodType<I>;
  readonly schemaOut: z.ZodType<O>;
  readonly tier: BrainToolTier;
  readonly requiresApproval: boolean;
  readonly executor: (input: I) => Promise<O>;
}

export interface BrainToolAuditRow {
  readonly name: string;
  readonly tier: BrainToolTier;
  readonly inputJson: string;
  readonly outputJson: string | null;
  readonly outcome: 'ok' | 'input-invalid' | 'output-invalid' | 'executor-failed';
  readonly durationMs: number;
  readonly errorMessage: string | null;
  readonly at: string;
}

export interface BrainToolAuditSink {
  record(row: BrainToolAuditRow): Promise<void>;
}

export type BrainToolOutcome<O> =
  | { readonly kind: 'ok'; readonly output: O; readonly durationMs: number }
  | { readonly kind: 'not-found'; readonly name: string }
  | { readonly kind: 'input-invalid'; readonly issue: string }
  | { readonly kind: 'output-invalid'; readonly issue: string }
  | { readonly kind: 'executor-failed'; readonly message: string };

export interface BrainToolRegistry {
  register<I, O>(spec: BrainToolSpec<I, O>): void;
  get(name: string): BrainToolSpec | null;
  list(): ReadonlyArray<BrainToolSpec>;
  runTool<O>(name: string, payload: unknown): Promise<BrainToolOutcome<O>>;
  clear(): void;
}

export interface BrainToolRegistryDeps {
  readonly auditSink?: BrainToolAuditSink;
  readonly clock?: () => number;
}

// ---------- Helpers ----------

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserialisable]"';
  }
}

// ---------- Factory ----------

export function createBrainToolRegistry(
  deps: BrainToolRegistryDeps = {},
): BrainToolRegistry {
  const auditSink = deps.auditSink;
  const clock = deps.clock ?? Date.now;
  const specs = new Map<string, BrainToolSpec>();

  function register<I, O>(spec: BrainToolSpec<I, O>): void {
    if (!spec.name || spec.name.trim().length === 0) {
      throw new Error('BrainToolRegistry.register: name is required');
    }
    if (specs.has(spec.name)) {
      throw new Error(
        `BrainToolRegistry.register: tool "${spec.name}" already registered`,
      );
    }
    // Cast through unknown so the heterogeneous registry can store
    // BrainToolSpec<unknown, unknown> without losing per-spec types
    // at the runTool boundary.
    specs.set(spec.name, spec as unknown as BrainToolSpec);
  }

  function get(name: string): BrainToolSpec | null {
    return specs.get(name) ?? null;
  }

  function list(): ReadonlyArray<BrainToolSpec> {
    return Object.freeze(Array.from(specs.values()));
  }

  async function runTool<O>(
    name: string,
    payload: unknown,
  ): Promise<BrainToolOutcome<O>> {
    const spec = specs.get(name);
    if (!spec) {
      return { kind: 'not-found', name };
    }
    const started = clock();

    const inputParse = spec.schemaIn.safeParse(payload);
    if (!inputParse.success) {
      const issue = inputParse.error.message;
      await safeAudit({
        name,
        tier: spec.tier,
        inputJson: safeStringify(payload),
        outputJson: null,
        outcome: 'input-invalid',
        durationMs: clock() - started,
        errorMessage: issue,
        at: new Date(started).toISOString(),
      });
      return { kind: 'input-invalid', issue };
    }

    let raw: unknown;
    try {
      raw = await spec.executor(inputParse.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await safeAudit({
        name,
        tier: spec.tier,
        inputJson: safeStringify(inputParse.data),
        outputJson: null,
        outcome: 'executor-failed',
        durationMs: clock() - started,
        errorMessage: message,
        at: new Date(started).toISOString(),
      });
      return { kind: 'executor-failed', message };
    }

    const outputParse = spec.schemaOut.safeParse(raw);
    if (!outputParse.success) {
      const issue = outputParse.error.message;
      await safeAudit({
        name,
        tier: spec.tier,
        inputJson: safeStringify(inputParse.data),
        outputJson: safeStringify(raw),
        outcome: 'output-invalid',
        durationMs: clock() - started,
        errorMessage: issue,
        at: new Date(started).toISOString(),
      });
      return { kind: 'output-invalid', issue };
    }

    const durationMs = clock() - started;
    await safeAudit({
      name,
      tier: spec.tier,
      inputJson: safeStringify(inputParse.data),
      outputJson: safeStringify(outputParse.data),
      outcome: 'ok',
      durationMs,
      errorMessage: null,
      at: new Date(started).toISOString(),
    });
    return { kind: 'ok', output: outputParse.data as O, durationMs };
  }

  async function safeAudit(row: BrainToolAuditRow): Promise<void> {
    if (!auditSink) return;
    try {
      await auditSink.record(row);
    } catch {
      // Audit must not break the call.
    }
  }

  function clear(): void {
    specs.clear();
  }

  return { register, get, list, runTool, clear };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory audit sink — useful for tests + local dev.
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryBrainToolAuditSink extends BrainToolAuditSink {
  rows(): ReadonlyArray<BrainToolAuditRow>;
  clear(): void;
}

export function createInMemoryBrainToolAuditSink(): InMemoryBrainToolAuditSink {
  const buffer: BrainToolAuditRow[] = [];
  return {
    async record(row: BrainToolAuditRow): Promise<void> {
      buffer.push(row);
    },
    rows(): ReadonlyArray<BrainToolAuditRow> {
      return Object.freeze(buffer.slice());
    },
    clear(): void {
      buffer.length = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Seed property-management tool specs.
//
// Each spec carries:
//   - schemaIn / schemaOut: deterministic input + output contract
//   - executor: the pure or duck-typed function the spec wraps
//   - tier + requiresApproval: kernel policy hooks
//
// The executor is INJECTED by the composition root (real Drizzle reads,
// real KRA tax-band table, real RERA registry lookup). Tests use the
// `createSeedDeps` helper at the bottom of this file.
// ─────────────────────────────────────────────────────────────────────

// 1. lookupTenantArrears

export const LookupTenantArrearsInputSchema = z.object({
  tenantProfileId: z.string().min(1),
  asOfDate: z.string().optional(),
});

export const LookupTenantArrearsOutputSchema = z.object({
  tenantProfileId: z.string(),
  arrearsAmount: z.number().nonnegative(),
  currency: z.string().min(3),
  monthsOverdue: z.number().int().nonnegative(),
  asOfDate: z.string(),
});

export type LookupTenantArrearsInput = z.infer<typeof LookupTenantArrearsInputSchema>;
export type LookupTenantArrearsOutput = z.infer<typeof LookupTenantArrearsOutputSchema>;

// 2. computeKraMri  (Kenya Monthly Rental Income tax)

export const ComputeKraMriInputSchema = z.object({
  monthlyRentKes: z.number().positive(),
  monthLabel: z.string().min(7).max(7), // YYYY-MM
});

export const ComputeKraMriOutputSchema = z.object({
  monthlyRentKes: z.number().positive(),
  monthLabel: z.string(),
  taxableBaseKes: z.number().nonnegative(),
  taxRateBps: z.number().int().nonnegative(),
  taxDueKes: z.number().nonnegative(),
  rule: z.string(),
});

export type ComputeKraMriInput = z.infer<typeof ComputeKraMriInputSchema>;
export type ComputeKraMriOutput = z.infer<typeof ComputeKraMriOutputSchema>;

/**
 * KRA MRI: 7.5% (750 bps) of gross monthly rent — final tax, no
 * deductions, applies when annualised rent is between KES 288 000 and
 * KES 15 000 000 (2024+ regime). Outside that band, MRI does not apply
 * and PAYE-style rental income rules take over.
 */
export function computeKraMri(input: ComputeKraMriInput): ComputeKraMriOutput {
  const annualised = input.monthlyRentKes * 12;
  const inBand = annualised >= 288_000 && annualised <= 15_000_000;
  if (!inBand) {
    return {
      monthlyRentKes: input.monthlyRentKes,
      monthLabel: input.monthLabel,
      taxableBaseKes: 0,
      taxRateBps: 0,
      taxDueKes: 0,
      rule: 'out-of-band:not-subject-to-mri',
    };
  }
  const rateBps = 750;
  const taxDueKes = Math.round((input.monthlyRentKes * rateBps) / 10_000 * 100) / 100;
  return {
    monthlyRentKes: input.monthlyRentKes,
    monthLabel: input.monthLabel,
    taxableBaseKes: input.monthlyRentKes,
    taxRateBps: rateBps,
    taxDueKes,
    rule: 'mri-7.5pct-of-gross',
  };
}

// 3. checkComplianceCertificate

export const CheckComplianceCertificateInputSchema = z.object({
  certificateId: z.string().min(1),
  jurisdiction: z.string().min(2),
});

export const CheckComplianceCertificateOutputSchema = z.object({
  certificateId: z.string(),
  jurisdiction: z.string(),
  status: z.enum(['valid', 'expired', 'revoked', 'not-found']),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  daysUntilExpiry: z.number().int().nullable(),
});

export type CheckComplianceCertificateInput = z.infer<
  typeof CheckComplianceCertificateInputSchema
>;
export type CheckComplianceCertificateOutput = z.infer<
  typeof CheckComplianceCertificateOutputSchema
>;

// 4. getMarketRateBand

export const GetMarketRateBandInputSchema = z.object({
  propertyId: z.string().min(1).optional(),
  geoFingerprint: z.string().min(2).optional(),
  bedrooms: z.number().int().nonnegative().max(20),
  unitType: z.enum(['studio', '1br', '2br', '3br', '4br+', 'townhouse', 'commercial']),
});

export const GetMarketRateBandOutputSchema = z.object({
  bedrooms: z.number().int().nonnegative(),
  unitType: z.string(),
  currency: z.string().min(3),
  p25: z.number().nonnegative(),
  median: z.number().nonnegative(),
  p75: z.number().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
});

export type GetMarketRateBandInput = z.infer<typeof GetMarketRateBandInputSchema>;
export type GetMarketRateBandOutput = z.infer<typeof GetMarketRateBandOutputSchema>;

// 5. triageMaintenanceTicket

export const TriageMaintenanceTicketInputSchema = z.object({
  ticketId: z.string().min(1),
  problemCode: z.string().min(1),
  description: z.string().min(1).max(2_000),
});

export const TriageMaintenanceTicketOutputSchema = z.object({
  ticketId: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  slaWindowHours: z.number().int().positive(),
  recommendedVendorPool: z.array(z.string()).max(20),
  rationale: z.string(),
});

export type TriageMaintenanceTicketInput = z.infer<
  typeof TriageMaintenanceTicketInputSchema
>;
export type TriageMaintenanceTicketOutput = z.infer<
  typeof TriageMaintenanceTicketOutputSchema
>;

/**
 * Severity heuristic — keyword scoring against the description plus
 * problem-code hints. Deterministic: same input → same output.
 */
export function triageMaintenanceTicket(
  input: TriageMaintenanceTicketInput,
): TriageMaintenanceTicketOutput {
  const desc = input.description.toLowerCase();
  const code = input.problemCode.toLowerCase();
  const critical = /\b(flood|fire|gas|leak.*ceiling|electric.*shock|sewage)\b/.test(desc) ||
    code.startsWith('safety.');
  const high = /\b(no water|no power|burst pipe|broken lock|hvac fail|elevator)\b/.test(desc);
  const low = /\b(paint|squeak|cosmetic|loose|hairline)\b/.test(desc);
  let severity: TriageMaintenanceTicketOutput['severity'] = 'medium';
  if (critical) severity = 'critical';
  else if (high) severity = 'high';
  else if (low) severity = 'low';
  const slaMap: Record<typeof severity, number> = {
    critical: 4,
    high: 24,
    medium: 72,
    low: 168,
  };
  const pool: ReadonlyArray<string> =
    severity === 'critical'
      ? ['emergency-roster']
      : severity === 'high'
        ? ['preferred-vendor', 'standby-roster']
        : ['preferred-vendor'];
  return {
    ticketId: input.ticketId,
    severity,
    slaWindowHours: slaMap[severity],
    recommendedVendorPool: [...pool],
    rationale: `keyword/regex-based severity: ${severity}; code=${code}`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Seed-spec factory — call once at composition time with concrete
// executor deps. The kernel sees a fully-populated registry afterwards.
// ─────────────────────────────────────────────────────────────────────

export interface SeedBrainToolDeps {
  readonly lookupTenantArrears: (input: LookupTenantArrearsInput) => Promise<LookupTenantArrearsOutput>;
  readonly checkComplianceCertificate: (
    input: CheckComplianceCertificateInput,
  ) => Promise<CheckComplianceCertificateOutput>;
  readonly getMarketRateBand: (input: GetMarketRateBandInput) => Promise<GetMarketRateBandOutput>;
}

export function registerSeedBrainTools(
  registry: BrainToolRegistry,
  deps: SeedBrainToolDeps,
): void {
  registry.register<LookupTenantArrearsInput, LookupTenantArrearsOutput>({
    name: 'lookupTenantArrears',
    description:
      'Return the arrears balance, currency, and months-overdue for a tenant profile as of an optional date. Read-only; never mutates.',
    schemaIn: LookupTenantArrearsInputSchema,
    schemaOut: LookupTenantArrearsOutputSchema,
    tier: 'free',
    requiresApproval: false,
    executor: deps.lookupTenantArrears,
  });

  registry.register<ComputeKraMriInput, ComputeKraMriOutput>({
    name: 'computeKraMri',
    description:
      'Compute the Kenyan Monthly Rental Income (MRI) tax due on a single month of gross rent. Pure function; applies the 7.5% rate within the KES 288k-15M annual band.',
    schemaIn: ComputeKraMriInputSchema,
    schemaOut: ComputeKraMriOutputSchema,
    tier: 'free',
    requiresApproval: false,
    executor: async (input: ComputeKraMriInput) => computeKraMri(input),
  });

  registry.register<CheckComplianceCertificateInput, CheckComplianceCertificateOutput>({
    name: 'checkComplianceCertificate',
    description:
      'Verify the validity of a property/unit compliance certificate (fire, structural, occupancy) against the local registry. Returns status + days-until-expiry.',
    schemaIn: CheckComplianceCertificateInputSchema,
    schemaOut: CheckComplianceCertificateOutputSchema,
    tier: 'pro',
    requiresApproval: false,
    executor: deps.checkComplianceCertificate,
  });

  registry.register<GetMarketRateBandInput, GetMarketRateBandOutput>({
    name: 'getMarketRateBand',
    description:
      'Return the 25/50/75th-percentile market rent band for a given bedroom count and unit type. Used by the rent-review and price-anchor flows.',
    schemaIn: GetMarketRateBandInputSchema,
    schemaOut: GetMarketRateBandOutputSchema,
    tier: 'pro',
    requiresApproval: false,
    executor: deps.getMarketRateBand,
  });

  registry.register<TriageMaintenanceTicketInput, TriageMaintenanceTicketOutput>({
    name: 'triageMaintenanceTicket',
    description:
      'Score a maintenance ticket on severity (low|medium|high|critical) and emit the recommended SLA window + vendor pool. Pure function over the description and problem code.',
    schemaIn: TriageMaintenanceTicketInputSchema,
    schemaOut: TriageMaintenanceTicketOutputSchema,
    tier: 'free',
    requiresApproval: false,
    executor: async (input: TriageMaintenanceTicketInput) => triageMaintenanceTicket(input),
  });
}

/** Exported seed-tool name list — useful for tests + observability. */
export const SEED_BRAIN_TOOL_NAMES: ReadonlyArray<string> = Object.freeze([
  'lookupTenantArrears',
  'computeKraMri',
  'checkComplianceCertificate',
  'getMarketRateBand',
  'triageMaintenanceTicket',
]);
