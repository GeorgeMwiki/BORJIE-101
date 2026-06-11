/**
 * Control-plane client API.
 *
 * Talks to the admin-web BFF (`/api/platform/control-plane/*`) which proxies to
 * the api-gateway. The gateway is the source of truth + the enforcement layer
 * (SUPER_ADMIN / ADMIN, sovereign-flag rejection, locked-use-case drop, ensemble
 * cost projection, hash-chained audit). This module only shapes requests +
 * responses and never carries tenant business data — every payload here is
 * PLATFORM config metadata.
 *
 * Auth: same-origin fetch forwards the staff session cookie; mutating calls echo
 * the double-submit CSRF token via getCsrfHeaders(). Failures throw so the
 * react-query `error` channel surfaces a clean degraded state.
 */

import { z } from 'zod';
import { getCsrfHeaders } from '@/lib/csrf';

// ─── Shared envelope ─────────────────────────────────────────────────────────

interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message?: string; readonly code?: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success || body.data === undefined) {
    throw new Error(
      body?.error?.message ?? `request failed (${body?.error?.code ?? res.status})`,
    );
  }
  return body.data;
}

async function sendJson<T>(
  url: string,
  method: 'POST' | 'PUT',
  payload: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
    body: JSON.stringify(payload ?? {}),
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body?.success || body.data === undefined) {
    throw new Error(
      body?.error?.message ?? `request failed (${body?.error?.code ?? res.status})`,
    );
  }
  return body.data;
}

// ─── Combine strategies + scope ──────────────────────────────────────────────

export const COMBINE_STRATEGIES = [
  'first-wins',
  'majority-vote',
  'judge-synthesis',
  'debate',
] as const;
export type CombineStrategy = (typeof COMBINE_STRATEGIES)[number];

/** A control-plane scope: platform-global or a single tenant override key. */
export type Scope = 'global' | `tenant:${string}`;

export const scopeSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => s === 'global' || /^tenant:[A-Za-z0-9_-]{1,128}$/.test(s), {
    message: "Scope must be 'global' or 'tenant:<id>'.",
  });

// ─── POWERS ──────────────────────────────────────────────────────────────────

export interface TenantOverride {
  readonly tenantId: string;
  readonly value: boolean | null;
}

export interface PowerFlag {
  readonly flag: string;
  readonly globalValue: boolean | null;
  readonly tenantOverrides: ReadonlyArray<TenantOverride>;
  readonly sovereign: boolean;
  readonly readError?: boolean;
}

interface PowersResponse {
  readonly powers: ReadonlyArray<PowerFlag>;
}

export async function fetchPowers(
  flags: ReadonlyArray<string>,
): Promise<ReadonlyArray<PowerFlag>> {
  const query = flags.length > 0 ? `?flags=${encodeURIComponent(flags.join(','))}` : '';
  const data = await getJson<PowersResponse>(
    `/api/platform/control-plane/powers${query}`,
  );
  return data.powers ?? [];
}

export const setPowerFlagSchema = z.object({
  flag: z
    .string()
    .min(2)
    .max(120)
    .regex(/^[a-z][a-z0-9_]*$/, 'Flag must be snake_case.'),
  enabled: z.boolean(),
  scope: scopeSchema.default('global'),
  reason: z.string().min(8, 'Reason must be at least 8 characters.').max(2000),
});
export type SetPowerFlagInput = z.infer<typeof setPowerFlagSchema>;

export interface SetPowerFlagResult {
  readonly flag: string;
  readonly scope: string;
  readonly enabled: boolean;
  readonly previousValue: boolean | null;
  readonly journalId: string | null;
}

export async function setPowerFlag(
  input: SetPowerFlagInput,
): Promise<SetPowerFlagResult> {
  const parsed = setPowerFlagSchema.parse(input);
  return sendJson<SetPowerFlagResult>(
    '/api/platform/control-plane/powers',
    'PUT',
    parsed,
  );
}

// ─── LLM ROUTING ─────────────────────────────────────────────────────────────

export interface EnsembleConfig {
  readonly enabled: boolean;
  readonly members: ReadonlyArray<string>;
  readonly combineStrategy: CombineStrategy;
  readonly judgeModel?: string;
}

export interface RoutingConfig {
  readonly coreModel?: string;
  readonly orderedFallbacks?: ReadonlyArray<string>;
  readonly ensemble?: EnsembleConfig;
  readonly perUseCase?: Readonly<Record<string, string>>;
}

export interface RoutingResponse {
  readonly scope: string;
  readonly config: RoutingConfig | null;
  readonly lastSetAt: string | null;
  readonly combineStrategies: ReadonlyArray<CombineStrategy>;
}

export async function fetchRouting(scope: Scope): Promise<RoutingResponse> {
  return getJson<RoutingResponse>(
    `/api/platform/control-plane/llm-routing?scope=${encodeURIComponent(scope)}`,
  );
}

export const ensembleSchema = z.object({
  enabled: z.boolean(),
  members: z.array(z.string().min(1).max(200)).min(1).max(8),
  combineStrategy: z.enum(COMBINE_STRATEGIES),
  judgeModel: z.string().min(1).max(200).optional(),
});

export const setRoutingSchema = z.object({
  scope: scopeSchema.default('global'),
  reason: z.string().min(8, 'Reason must be at least 8 characters.').max(2000),
  coreModel: z.string().min(1, 'Pick a core model.').max(200),
  orderedFallbacks: z.array(z.string().min(1).max(200)).max(8).default([]),
  ensemble: ensembleSchema.optional(),
  perUseCase: z.record(z.string().min(1).max(120), z.string().min(1).max(200)).optional(),
});
export type SetRoutingInput = z.infer<typeof setRoutingSchema>;

export interface EnsembleCostPerMember {
  readonly model: string;
  readonly costPerMillionUsd: number;
  readonly inCatalog: boolean;
}

export interface EnsembleCost {
  readonly memberCount: number;
  readonly costMultiplier: number;
  readonly blendedCostPerMillionUsd: number;
  readonly perMember: ReadonlyArray<EnsembleCostPerMember>;
  readonly note: string;
}

export interface SetRoutingResult {
  readonly scope: string;
  readonly config: RoutingConfig;
  readonly updatedAt: string | null;
  readonly journalId: string | null;
  readonly droppedLockedUseCases?: ReadonlyArray<string>;
  readonly ensembleCost?: EnsembleCost | null;
}

export async function setRouting(input: SetRoutingInput): Promise<SetRoutingResult> {
  const parsed = setRoutingSchema.parse(input);
  return sendJson<SetRoutingResult>(
    '/api/platform/control-plane/llm-routing',
    'PUT',
    parsed,
  );
}

// ─── MODEL CATALOG ───────────────────────────────────────────────────────────

export interface CatalogModel {
  readonly model: string;
  readonly family: string;
  readonly label: string;
  readonly provider: string;
  readonly capabilityRank: number;
  readonly costPerMillionUsd: number;
  readonly p50LatencyMs: number;
}

export interface ModelCatalog {
  readonly models: ReadonlyArray<CatalogModel>;
  readonly combineStrategies: ReadonlyArray<CombineStrategy>;
  readonly assignableUseCases: ReadonlyArray<string>;
  readonly lockedUseCases: ReadonlyArray<string>;
  readonly pricingModels: ReadonlyArray<string>;
}

export async function fetchModelCatalog(): Promise<ModelCatalog> {
  return getJson<ModelCatalog>('/api/platform/control-plane/model-catalog');
}

// ─── AI-SUGGEST (HITL) ───────────────────────────────────────────────────────

export const aiSuggestSchema = z.object({
  useCases: z.array(z.string().min(1).max(120)).min(1).max(50).optional(),
  weights: z
    .object({
      cost: z.number().min(0).max(1).optional(),
      capability: z.number().min(0).max(1).optional(),
      latency: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
export type AiSuggestInput = z.infer<typeof aiSuggestSchema>;

export interface SuggestionCandidate {
  readonly model: string;
  readonly score: number;
  readonly costPerMillionUsd?: number;
  readonly p50LatencyMs?: number;
}

export interface UseCaseSuggestion {
  readonly useCase: string;
  readonly recommended: string;
  readonly rationale?: string;
  readonly locked?: boolean;
  readonly candidates?: ReadonlyArray<SuggestionCandidate>;
  readonly estimatedCostPerMillionUsd?: number;
  readonly estimatedLatencyMs?: number;
}

export interface AiSuggestResult {
  readonly applied: boolean;
  readonly perUseCase: ReadonlyArray<UseCaseSuggestion>;
}

export async function runAiSuggest(input: AiSuggestInput): Promise<AiSuggestResult> {
  const parsed = aiSuggestSchema.parse(input);
  return sendJson<AiSuggestResult>(
    '/api/platform/control-plane/ai-suggest',
    'POST',
    parsed,
  );
}
