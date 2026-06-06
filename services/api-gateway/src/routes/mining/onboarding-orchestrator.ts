/**
 * Onboarding-wizard ORCHESTRATOR (FLOW-2).
 *
 * The stepped owner onboarding flow:
 *   kyb -> licences -> sites -> drill_holes -> cockpit_seed -> complete
 *
 * Backs POST /api/v1/mining/onboarding/start | advance | complete in
 * onboarding.hono.ts (consumed by apps/owner-web/src/lib/queries/onboarding.ts).
 *
 * Durable state lives in `mining_onboarding_runs` (migration 0286): one row per
 * run with the current step + an append-only `steps` jsonb of each advanced
 * step's payload (incl. uploaded file refs) so a reload resumes where the owner
 * left off and a file-bearing step's payload is PERSISTED (not discarded).
 *
 * HONESTY (CLAUDE.md): the owner-web wizard currently sends only file REFERENCES
 * (`{ name }`) for the licences / sites / drill_holes steps — the raw bytes are
 * NOT uploaded through this path. So `advance` persists those refs verbatim and
 * flags `bytesPersisted:false` per file: the bytes-and-OCR → real-rows path is
 * the SEPARATE /onboarding/ingest + /onboarding/commit capability (the recipe
 * pipeline), which needs a `sample` or `ocr_extraction_id`. We never fabricate
 * inserts the wizard did not actually supply.
 *
 * Money path: NONE — onboarding never moves money.
 *
 * RLS: callers pass the request's RLS-pinned Drizzle client; every statement
 * also binds `tenant_id` explicitly (belt-and-braces on top of FORCE RLS).
 */

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { miningOnboardingRuns } from '@borjie/database';

// ---------------------------------------------------------------------------
// Step ladder
// ---------------------------------------------------------------------------

export const ONBOARDING_STEP_ORDER = [
  'kyb',
  'licences',
  'sites',
  'drill_holes',
  'cockpit_seed',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEP_ORDER)[number];

/** The step that follows `step`, or 'complete' after the last one. */
export function nextStep(step: OnboardingStep): OnboardingStep | 'complete' {
  const idx = ONBOARDING_STEP_ORDER.indexOf(step);
  if (idx < 0 || idx === ONBOARDING_STEP_ORDER.length - 1) return 'complete';
  return ONBOARDING_STEP_ORDER[idx + 1]!;
}

// ---------------------------------------------------------------------------
// Per-step payload schemas (zod — validate before persisting)
// ---------------------------------------------------------------------------

const directorSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  nidaId: z.string().trim().min(1).max(64),
  role: z.string().trim().min(1).max(64).optional(),
});

const kybPayloadSchema = z.object({
  companyName: z.string().trim().min(1).max(256),
  registrationNo: z.string().trim().min(1).max(128),
  tin: z.string().trim().min(1).max(64),
  registeredAddress: z.string().trim().min(1).max(512),
  directors: z.array(directorSchema).min(1).max(50),
});

/** A file reference the wizard uploaded a handle for (name only today). */
const fileRefSchema = z.object({
  name: z.string().trim().min(1).max(512),
  /** Optional pre-uploaded document/extraction handles (future-proof). */
  documentId: z.string().trim().min(1).max(64).optional(),
  ocrExtractionId: z.string().trim().min(1).max(64).optional(),
});

const licencesPayloadSchema = z.object({
  licences: z.array(fileRefSchema).min(1).max(100),
});

const sitesPayloadSchema = z.object({
  sites: z.array(fileRefSchema).min(1).max(100),
});

const drillHolesPayloadSchema = z.object({
  rows: z.array(fileRefSchema).min(1).max(500),
});

const cockpitSeedPayloadSchema = z.object({
  headline: z.string().trim().max(280).optional().default(''),
});

const STEP_SCHEMAS: Readonly<Record<OnboardingStep, z.ZodTypeAny>> = {
  kyb: kybPayloadSchema,
  licences: licencesPayloadSchema,
  sites: sitesPayloadSchema,
  drill_holes: drillHolesPayloadSchema,
  cockpit_seed: cockpitSeedPayloadSchema,
};

/**
 * Validate a step payload against its schema. Returns the parsed payload or
 * throws a `ZodError` (the route converts that to a 400).
 */
export function validateStepPayload(step: OnboardingStep, payload: unknown): unknown {
  const schema = STEP_SCHEMAS[step];
  return schema.parse(payload ?? {});
}

/**
 * Count the file references in a file-bearing step's payload — used to report
 * honestly how many refs were persisted (and that their bytes were not, since
 * the wizard does not upload bytes on this path).
 */
export function fileRefCount(step: OnboardingStep, payload: unknown): number {
  if (step === 'licences') {
    return (payload as { licences?: unknown[] }).licences?.length ?? 0;
  }
  if (step === 'sites') {
    return (payload as { sites?: unknown[] }).sites?.length ?? 0;
  }
  if (step === 'drill_holes') {
    return (payload as { rows?: unknown[] }).rows?.length ?? 0;
  }
  return 0;
}

export function isFileBearingStep(step: OnboardingStep): boolean {
  return step === 'licences' || step === 'sites' || step === 'drill_holes';
}

// ---------------------------------------------------------------------------
// Drizzle client shape — minimal surface the orchestrator needs.
// ---------------------------------------------------------------------------

export interface OnboardingDb {
  insert: (table: typeof miningOnboardingRuns) => {
    values: (v: Record<string, unknown>) => {
      returning: () => Promise<ReadonlyArray<Record<string, unknown>>>;
    };
  };
  select: (cols: Record<string, unknown>) => {
    from: (table: typeof miningOnboardingRuns) => {
      where: (clause: unknown) => {
        limit: (n: number) => Promise<ReadonlyArray<Record<string, unknown>>>;
      };
    };
  };
  update: (table: typeof miningOnboardingRuns) => {
    set: (v: Record<string, unknown>) => {
      where: (clause: unknown) => Promise<unknown>;
    };
  };
}

export interface OnboardingRunState {
  readonly sessionId: string;
  readonly currentStep: OnboardingStep | 'complete';
  readonly status: 'in_progress' | 'complete' | 'abandoned';
  readonly steps: Record<string, unknown>;
}

function rowToState(row: Record<string, unknown>): OnboardingRunState {
  return {
    sessionId: String(row.id),
    currentStep: String(row.currentStep ?? row.current_step) as
      | OnboardingStep
      | 'complete',
    status: String(row.status) as OnboardingRunState['status'],
    steps: (row.steps ?? {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Create a fresh onboarding run (status=in_progress, current_step=kyb). */
export async function startRun(
  db: OnboardingDb,
  tenantId: string,
  userId: string,
): Promise<OnboardingRunState> {
  const [row] = await db
    .insert(miningOnboardingRuns)
    .values({
      tenantId,
      createdByUserId: userId,
      currentStep: 'kyb',
      status: 'in_progress',
      steps: {},
      cockpitSeed: {},
    })
    .returning();
  if (!row) {
    throw new Error('onboarding: failed to create run');
  }
  return rowToState(row);
}

/** Load a run by id, tenant-scoped. Returns null when not found. */
export async function loadRun(
  db: OnboardingDb,
  tenantId: string,
  sessionId: string,
): Promise<OnboardingRunState | null> {
  const rows = await db
    .select({
      id: miningOnboardingRuns.id,
      currentStep: miningOnboardingRuns.currentStep,
      status: miningOnboardingRuns.status,
      steps: miningOnboardingRuns.steps,
    })
    .from(miningOnboardingRuns)
    .where(
      and(
        eq(miningOnboardingRuns.tenantId, tenantId),
        eq(miningOnboardingRuns.id, sessionId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? rowToState(row) : null;
}

export interface AdvanceResult extends OnboardingRunState {
  readonly persistedStep: OnboardingStep;
  readonly fileRefsPersisted: number;
  /** False when the step carried file refs whose BYTES were not ingested. */
  readonly bytesPersisted: boolean;
}

/**
 * Persist a step's validated payload into the run's `steps` jsonb and advance
 * `current_step` to the next one. Idempotent on re-advancing the same step
 * (overwrites that step's recorded payload). Returns the new run state.
 */
export async function advanceRun(args: {
  readonly db: OnboardingDb;
  readonly tenantId: string;
  readonly run: OnboardingRunState;
  readonly step: OnboardingStep;
  readonly payload: unknown;
}): Promise<AdvanceResult> {
  const { db, tenantId, run, step, payload } = args;

  const mergedSteps: Record<string, unknown> = {
    ...run.steps,
    [step]: {
      payload,
      recordedAt: new Date().toISOString(),
    },
  };

  const advancedStep = nextStep(step);
  await db
    .update(miningOnboardingRuns)
    .set({
      steps: mergedSteps,
      currentStep: advancedStep,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(miningOnboardingRuns.tenantId, tenantId),
        eq(miningOnboardingRuns.id, run.sessionId),
      ),
    );

  const refs = fileRefCount(step, payload);
  return {
    sessionId: run.sessionId,
    currentStep: advancedStep,
    status: run.status,
    steps: mergedSteps,
    persistedStep: step,
    fileRefsPersisted: refs,
    // The wizard uploads only file NAMES on this path; bytes are not ingested
    // here. A file-bearing step therefore reports bytesPersisted:false so the
    // caller can flag it honestly. Non-file steps report true (nothing to byte).
    bytesPersisted: !isFileBearingStep(step),
  };
}

export interface CompleteResult extends OnboardingRunState {
  readonly cockpitSeed: Record<string, unknown>;
}

/**
 * Finalise the run: stamp status=complete + current_step=complete and record
 * the cockpit seed (the headline from the cockpit_seed step + a seed marker).
 * Idempotent: completing an already-complete run returns its state.
 */
export async function completeRun(args: {
  readonly db: OnboardingDb;
  readonly tenantId: string;
  readonly run: OnboardingRunState;
}): Promise<CompleteResult> {
  const { db, tenantId, run } = args;

  const seedStep = run.steps['cockpit_seed'] as
    | { payload?: { headline?: string } }
    | undefined;
  const headline = seedStep?.payload?.headline ?? '';
  const cockpitSeed: Record<string, unknown> = {
    seededAt: new Date().toISOString(),
    headline,
    kybCaptured: Boolean(run.steps['kyb']),
    licencesRefs: fileRefCount(
      'licences',
      (run.steps['licences'] as { payload?: unknown })?.payload,
    ),
    sitesRefs: fileRefCount(
      'sites',
      (run.steps['sites'] as { payload?: unknown })?.payload,
    ),
    drillRefs: fileRefCount(
      'drill_holes',
      (run.steps['drill_holes'] as { payload?: unknown })?.payload,
    ),
  };

  await db
    .update(miningOnboardingRuns)
    .set({
      status: 'complete',
      currentStep: 'complete',
      cockpitSeed,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(miningOnboardingRuns.tenantId, tenantId),
        eq(miningOnboardingRuns.id, run.sessionId),
      ),
    );

  return {
    sessionId: run.sessionId,
    currentStep: 'complete',
    status: 'complete',
    steps: run.steps,
    cockpitSeed,
  };
}
