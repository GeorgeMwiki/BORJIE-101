'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiResult } from '@/lib/api-client';

/**
 * react-query bindings for the admin-web `/dashboard` surface.
 *
 * The dashboard aggregates several existing endpoints into a single
 * screen — there is no unified BFF on the gateway, so each panel
 * fetches its own slot:
 *
 *   - `/tenants` (mining/internal)            tenants overview
 *   - `/api/v1/pilot/errors`                  pilot-error stream
 *   - `/killswitch` (mining/internal)         kill-switch state
 *   - `/corpus/versions` (mining/internal)    corpus queue depth
 *   - `/api/v1/feature-flags`                 feature-flag rollouts
 *   - `/api/v1/audit-trail/verify`            audit chain integrity
 *
 * Each query surfaces ApiErr through the normal react-query `error`
 * channel; panels render an env-missing state when the endpoint is
 * not yet wired (503 / 501).
 */

const dashboardKey = (slot: string) => ['admin-dashboard', slot] as const;

// ----------------------------------------------------------------------------
// Tenants overview — reuses the live /mining/internal/tenants endpoint.
// ----------------------------------------------------------------------------

export interface DashboardTenantRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly plan: string;
  readonly createdAt: string;
}

interface RawDashboardTenant {
  readonly id: string;
  readonly name?: string;
  readonly slug?: string;
  readonly status?: string;
  readonly subscriptionTier?: string;
  readonly plan?: string;
  readonly createdAt?: string;
}

function adaptTenantRow(raw: RawDashboardTenant): DashboardTenantRow {
  return {
    id: raw.id,
    name: raw.name ?? raw.slug ?? raw.id,
    status: raw.status ?? 'unknown',
    plan: raw.subscriptionTier ?? raw.plan ?? 'starter',
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

export interface TenantsOverview {
  readonly total: number;
  readonly recent: ReadonlyArray<DashboardTenantRow>;
}

export function useDashboardTenants() {
  return useQuery({
    queryKey: dashboardKey('tenants'),
    queryFn: async (): Promise<TenantsOverview> => {
      const res = await apiClient.get<ReadonlyArray<RawDashboardTenant>>(
        '/tenants',
      );
      if (!res.ok) throw new Error(res.message);
      const rows = res.data.map(adaptTenantRow);
      const sorted = [...rows].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      return { total: rows.length, recent: sorted.slice(0, 5) };
    },
  });
}

// ----------------------------------------------------------------------------
// Pilot errors — hits the gateway directly (the route lives outside the
// /mining/internal prefix so we cannot use apiClient).
// ----------------------------------------------------------------------------

export interface PilotErrorRow {
  readonly id: string;
  readonly cohort: string;
  readonly message: string;
  readonly capturedAt: string;
}

interface PilotErrorsPayload {
  readonly results?: ReadonlyArray<{
    readonly id?: string;
    readonly cohort?: string;
    readonly message?: string;
    readonly capturedAt?: string;
  }>;
}

function rootGateway(): string {
  const configured =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim()
      : undefined;
  return configured && configured.length > 0
    ? configured.replace(/\/$/, '')
    : 'http://localhost:3001';
}

export interface PilotErrorsResult {
  readonly state: 'ok' | 'unconfigured' | 'unauthorized' | 'failed';
  readonly rows: ReadonlyArray<PilotErrorRow>;
  readonly message?: string;
}

async function fetchPilotErrors(
  signal?: AbortSignal,
): Promise<PilotErrorsResult> {
  const base = rootGateway();
  try {
    const res = await fetch(`${base}/api/v1/pilot/errors?limit=10`, {
      credentials: 'include',
      ...(signal !== undefined ? { signal } : {}),
    });
    if (res.status === 401 || res.status === 403) {
      return { state: 'unauthorized', rows: [], message: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        state: 'failed',
        rows: [],
        message: text || `HTTP ${res.status}`,
      };
    }
    const parsed = (await res.json().catch(() => null)) as
      | { readonly data?: PilotErrorsPayload }
      | PilotErrorsPayload
      | null;
    const payload =
      parsed && typeof parsed === 'object' && 'data' in parsed
        ? (parsed.data as PilotErrorsPayload)
        : (parsed as PilotErrorsPayload | null);
    const results = payload?.results ?? [];
    const rows = results.map((r, i) => ({
      id: r.id ?? `pilot-${i}`,
      cohort: r.cohort ?? 'unknown',
      message: r.message ?? '(no message)',
      capturedAt: r.capturedAt ?? new Date().toISOString(),
    }));
    return { state: 'ok', rows };
  } catch (err) {
    return {
      state: 'failed',
      rows: [],
      message: err instanceof Error ? err.message : 'network error',
    };
  }
}

export function useDashboardPilotErrors() {
  return useQuery({
    queryKey: dashboardKey('pilot-errors'),
    queryFn: ({ signal }) => fetchPilotErrors(signal),
  });
}

// ----------------------------------------------------------------------------
// Kill-switch status — reuses /mining/internal/killswitch.
// ----------------------------------------------------------------------------

export interface KillswitchRowSummary {
  readonly scope: string;
  readonly level: 'live' | 'degraded' | 'halt';
  readonly setBy: string;
  readonly setAt: string;
}

interface RawKillswitch {
  readonly scope?: string;
  readonly level?: 'live' | 'degraded' | 'halt';
  readonly setAt?: string;
  readonly setBy?: string;
}

export interface KillswitchStatus {
  readonly rows: ReadonlyArray<KillswitchRowSummary>;
  readonly halt: number;
  readonly degraded: number;
  readonly live: number;
}

export function useDashboardKillswitch() {
  return useQuery({
    queryKey: dashboardKey('killswitch'),
    queryFn: async (): Promise<KillswitchStatus> => {
      const res: ApiResult<ReadonlyArray<RawKillswitch>> =
        await apiClient.get<ReadonlyArray<RawKillswitch>>('/killswitch');
      if (!res.ok) throw new Error(res.message);
      const rows = res.data.map((r) => ({
        scope: r.scope ?? 'platform',
        level: r.level ?? 'live',
        setAt: r.setAt ?? new Date().toISOString(),
        setBy: r.setBy ?? 'system',
      }));
      return {
        rows,
        halt: rows.filter((r) => r.level === 'halt').length,
        degraded: rows.filter((r) => r.level === 'degraded').length,
        live: rows.filter((r) => r.level === 'live').length,
      };
    },
  });
}

// ----------------------------------------------------------------------------
// Corpus queue depth — reuses /mining/internal/corpus/versions.
// ----------------------------------------------------------------------------

interface RawCorpusVersion {
  readonly id: string;
  readonly supersededById?: string | null;
  readonly ingestedAt?: string;
}

export interface CorpusQueueStatus {
  readonly total: number;
  readonly indexed: number;
  readonly superseded: number;
  readonly latestIngestAt: string | null;
}

export function useDashboardCorpus() {
  return useQuery({
    queryKey: dashboardKey('corpus'),
    queryFn: async (): Promise<CorpusQueueStatus> => {
      const res = await apiClient.get<ReadonlyArray<RawCorpusVersion>>(
        '/corpus/versions',
      );
      if (!res.ok) throw new Error(res.message);
      const rows = res.data;
      const indexed = rows.filter((r) => !r.supersededById).length;
      const latest = rows
        .map((r) => r.ingestedAt ?? '')
        .filter((s) => s !== '')
        .sort()
        .at(-1);
      return {
        total: rows.length,
        indexed,
        superseded: rows.length - indexed,
        latestIngestAt: latest ?? null,
      };
    },
  });
}

// ----------------------------------------------------------------------------
// Feature flags — hits /api/v1/feature-flags (outside mining/internal).
// ----------------------------------------------------------------------------

export interface FeatureFlagRow {
  readonly key: string;
  readonly enabled: boolean;
  readonly rolloutPct: number | null;
}

interface RawFeatureFlag {
  readonly key?: string;
  readonly name?: string;
  readonly enabled?: boolean;
  readonly rolloutPercent?: number;
  readonly rolloutPct?: number;
}

export interface FeatureFlagsResult {
  readonly state: 'ok' | 'unconfigured' | 'failed';
  readonly rows: ReadonlyArray<FeatureFlagRow>;
  readonly message?: string;
}

async function fetchFeatureFlags(
  signal?: AbortSignal,
): Promise<FeatureFlagsResult> {
  const base = rootGateway();
  try {
    const res = await fetch(`${base}/api/v1/feature-flags`, {
      credentials: 'include',
      ...(signal !== undefined ? { signal } : {}),
    });
    if (res.status === 503 || res.status === 501) {
      return {
        state: 'unconfigured',
        rows: [],
        message: 'feature-flags service not wired',
      };
    }
    if (!res.ok) {
      return { state: 'failed', rows: [], message: `HTTP ${res.status}` };
    }
    const parsed = (await res.json().catch(() => null)) as
      | { readonly data?: ReadonlyArray<RawFeatureFlag> }
      | ReadonlyArray<RawFeatureFlag>
      | null;
    const rows: ReadonlyArray<RawFeatureFlag> = Array.isArray(parsed)
      ? (parsed as ReadonlyArray<RawFeatureFlag>)
      : ((parsed as { readonly data?: ReadonlyArray<RawFeatureFlag> } | null)?.data ?? []);
    return {
      state: 'ok',
      rows: rows.map((r) => ({
        key: r.key ?? r.name ?? 'flag',
        enabled: Boolean(r.enabled),
        rolloutPct:
          typeof r.rolloutPercent === 'number'
            ? r.rolloutPercent
            : typeof r.rolloutPct === 'number'
              ? r.rolloutPct
              : null,
      })),
    };
  } catch (err) {
    return {
      state: 'failed',
      rows: [],
      message: err instanceof Error ? err.message : 'network error',
    };
  }
}

export function useDashboardFeatureFlags() {
  return useQuery({
    queryKey: dashboardKey('feature-flags'),
    queryFn: ({ signal }) => fetchFeatureFlags(signal),
  });
}

// ----------------------------------------------------------------------------
// Audit chain integrity — /api/v1/audit-trail/verify.
// ----------------------------------------------------------------------------

export interface AuditIntegrityResult {
  readonly state: 'ok' | 'unconfigured' | 'unauthorized' | 'failed';
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly reason?: string;
  readonly firstBrokenEntryId?: string;
  readonly windowStartIso: string;
  readonly windowEndIso: string;
}

async function fetchAuditIntegrity(
  signal?: AbortSignal,
): Promise<AuditIntegrityResult> {
  const base = rootGateway();
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  try {
    const url = new URL(`${base}/api/v1/audit-trail/verify`);
    url.searchParams.set('from', windowStart.toISOString());
    url.searchParams.set('to', windowEnd.toISOString());
    const res = await fetch(url.toString(), {
      credentials: 'include',
      ...(signal !== undefined ? { signal } : {}),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        state: 'unauthorized',
        valid: false,
        entriesChecked: 0,
        windowStartIso: windowStart.toISOString(),
        windowEndIso: windowEnd.toISOString(),
      };
    }
    if (res.status === 501 || res.status === 503) {
      return {
        state: 'unconfigured',
        valid: false,
        entriesChecked: 0,
        windowStartIso: windowStart.toISOString(),
        windowEndIso: windowEnd.toISOString(),
      };
    }
    if (!res.ok) {
      return {
        state: 'failed',
        valid: false,
        entriesChecked: 0,
        reason: `HTTP ${res.status}`,
        windowStartIso: windowStart.toISOString(),
        windowEndIso: windowEnd.toISOString(),
      };
    }
    const parsed = (await res.json().catch(() => null)) as
      | {
          readonly data?: {
            readonly ok?: boolean;
            readonly entriesChecked?: number;
            readonly firstBrokenEntryId?: string;
            readonly reason?: string;
          };
        }
      | null;
    const payload = parsed?.data ?? {};
    return {
      state: 'ok',
      valid: Boolean(payload.ok),
      entriesChecked: payload.entriesChecked ?? 0,
      ...(payload.firstBrokenEntryId !== undefined
        ? { firstBrokenEntryId: payload.firstBrokenEntryId }
        : {}),
      ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
      windowStartIso: windowStart.toISOString(),
      windowEndIso: windowEnd.toISOString(),
    };
  } catch (err) {
    return {
      state: 'failed',
      valid: false,
      entriesChecked: 0,
      reason: err instanceof Error ? err.message : 'network error',
      windowStartIso: windowStart.toISOString(),
      windowEndIso: windowEnd.toISOString(),
    };
  }
}

export function useDashboardAuditIntegrity() {
  return useQuery({
    queryKey: dashboardKey('audit-integrity'),
    queryFn: ({ signal }) => fetchAuditIntegrity(signal),
  });
}
