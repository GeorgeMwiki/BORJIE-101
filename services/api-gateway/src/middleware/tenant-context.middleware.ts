// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
import { logger } from '../utils/logger.js';
/**
 * Tenant Context Middleware - BORJIE
 *
 * Sets up tenant context for multi-tenant requests:
 * - Tenant ID extraction and validation
 * - Tenant settings caching
 * - Tenant isolation enforcement
 * - Request scoping
 */

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { AuthContext } from './auth.middleware';
import {
  getCountryPlugin,
  DEFAULT_COUNTRY_ID,
  UnknownJurisdictionError,
  type CountryPlugin,
} from '@borjie/compliance-plugins';
// F10 DecisionTrace — record the tenant-resolution decision (claims in,
// resolved tenantId out, outcome). The trace's tenantId column is NULL
// here because this is platform-tier — service-role admin replay UI
// reads it. Fire-and-forget persistence.
import { startDecisionTrace } from '@borjie/observability';

/**
 * Resolve a country plugin with a SAFE fallback to the platform-default
 * jurisdiction. `getCountryPlugin` throws `UnknownJurisdictionError` for
 * null / unknown country codes (Round-3 audit C6 — fail-closed at the
 * library level). The middleware needs the OPPOSITE behaviour: a
 * pre-migration tenant row with a null countryCode should boot under
 * the platform default rather than 500-ing the request.
 *
 * We log a one-shot warning per process so operators can catch tenants
 * still on the legacy null-countryCode row without spamming logs on
 * every request.
 */
let defaultFallbackWarned = false;
/**
 * Test-only — reset the one-shot warning gate so a test asserting the
 * unknown-country fallback path runs deterministically across cases.
 */
export function __resetDefaultFallbackWarning(): void {
  defaultFallbackWarned = false;
}
function resolveCountryPluginWithDefault(rawCode: string | null): CountryPlugin {
  try {
    return getCountryPlugin(rawCode);
  } catch (error) {
    if (error instanceof UnknownJurisdictionError) {
      if (!defaultFallbackWarned) {
        defaultFallbackWarned = true;
        // eslint-disable-next-line no-console -- one-shot operator visibility
        logger.warn(`[tenant-context] unknown / missing countryCode (${JSON.stringify(rawCode)}); ` +
            `falling back to DEFAULT_COUNTRY_ID=${DEFAULT_COUNTRY_ID}. ` +
            `Update tenants.countryCode to silence this warning.`);
      }
      return getCountryPlugin(DEFAULT_COUNTRY_ID);
    }
    throw error;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface TenantConfig {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  /**
   * ISO-3166-1 alpha-2 country code for the tenant. Drives currency,
   * phone normalization, KYC providers, payment gateways, and regulatory
   * rules via `@borjie/compliance-plugins`. Optional during rollout —
   * when null the middleware falls back to DEFAULT_COUNTRY_ID.
   */
  countryCode?: string | null;
  settings: TenantSettings;
  features: TenantFeatures;
  limits: TenantLimits;
  createdAt: Date;
  updatedAt: Date;
}

export type TenantStatus = 'active' | 'suspended' | 'trial' | 'pending' | 'cancelled';

export interface TenantSettings {
  timezone: string;
  currency: string;
  locale: string;
  dateFormat: string;
  fiscalYearStart: number; // Month (1-12)
  lateFeeEnabled: boolean;
  lateFeePercentage: number;
  gracePeriodDays: number;
  autoInvoiceEnabled: boolean;
  invoiceDueDays: number;
  reminderDays: number[];
  emailNotifications: boolean;
  smsNotifications: boolean;
  customBranding: boolean;
  logoUrl?: string;
  primaryColor?: string;
}

export interface TenantFeatures {
  maxProperties: number;
  maxUnits: number;
  maxUsers: number;
  advancedReporting: boolean;
  apiAccess: boolean;
  customWorkflows: boolean;
  mobileApp: boolean;
  smsNotifications: boolean;
  documentStorage: boolean;
  maintenanceModule: boolean;
  accountingIntegration: boolean;
  aiFeatures: boolean;
}

export interface TenantLimits {
  apiRequestsPerDay: number;
  storageGB: number;
  documentUploadsPerMonth: number;
  smsCredits: number;
  emailsPerDay: number;
}

export interface TenantContext {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  /** Resolved ISO-3166-1 alpha-2 country code (after DEFAULT fallback). */
  countryCode: string;
  settings: TenantSettings;
  features: TenantFeatures;
  limits: TenantLimits;
}

// ============================================================================
// Tenant Cache (In-Memory for Dev, Redis for Production)
// ============================================================================

interface TenantCache {
  get(tenantId: string): TenantConfig | undefined;
  set(tenantId: string, config: TenantConfig, ttlSeconds?: number): void;
  delete(tenantId: string): void;
  clear(): void;
}

class InMemoryTenantCache implements TenantCache {
  private cache = new Map<string, { config: TenantConfig; expiresAt: number }>();
  private defaultTTL = 300; // 5 minutes

  get(tenantId: string): TenantConfig | undefined {
    const entry = this.cache.get(tenantId);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(tenantId);
      return undefined;
    }

    return entry.config;
  }

  set(tenantId: string, config: TenantConfig, ttlSeconds = this.defaultTTL): void {
    this.cache.set(tenantId, {
      config,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  clear(): void {
    this.cache.clear();
  }
}

const tenantCache: TenantCache = new InMemoryTenantCache();

// ============================================================================
// Default Tenant Configuration
// ============================================================================

// IMPORTANT: these defaults are the last-resort fallback used ONLY in the
// dev path where the tenant record hasn't been loaded yet. Production
// resolves real values from the tenant row (see `loadTenantFromDatabase`).
// Keep them country-neutral — never bake in 'TZ', 'TZS', 'en-TZ', or an
// Africa/* timezone, which would quietly push Tanzania onto every tenant
// whose country isn't yet known. Cross-reference `tenant.defaultCurrency`,
// `tenant.countryCode`, `tenant.defaultLocale`, `tenant.defaultTimezone`.
const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  timezone: 'UTC',
  currency: 'USD',
  locale: 'en',
  dateFormat: 'DD/MM/YYYY',
  fiscalYearStart: 1,
  lateFeeEnabled: true,
  lateFeePercentage: 5,
  gracePeriodDays: 5,
  autoInvoiceEnabled: true,
  invoiceDueDays: 5,
  reminderDays: [3, 1, 0, -3, -7],
  emailNotifications: true,
  smsNotifications: false,
  customBranding: false,
};

const DEFAULT_TENANT_FEATURES: TenantFeatures = {
  maxProperties: 10,
  maxUnits: 100,
  maxUsers: 20,
  advancedReporting: false,
  apiAccess: false,
  customWorkflows: false,
  mobileApp: true,
  smsNotifications: false,
  documentStorage: true,
  maintenanceModule: true,
  accountingIntegration: false,
  aiFeatures: false,
};

const DEFAULT_TENANT_LIMITS: TenantLimits = {
  apiRequestsPerDay: 10000,
  storageGB: 5,
  documentUploadsPerMonth: 500,
  smsCredits: 0,
  emailsPerDay: 1000,
};

// ============================================================================
// Tenant Loader (Mock - Replace with Database in Production)
// ============================================================================

// Why: SSRF via X-Tenant-ID — header value flows into a backend fetch URL.
// Without a strict allowlist, an attacker can submit values like
// `../../admin/keys` or URL-encoded `..%2f..%2fadmin` to pivot the internal
// request to other cluster endpoints. Allow only the character set that
// real tenant IDs use (UUIDs, slugs) and cap the length.
const TENANT_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export class InvalidTenantIdError extends Error {
  readonly code = 'INVALID_TENANT_ID';
  constructor(message = 'Invalid tenant ID format') {
    super(message);
    this.name = 'InvalidTenantIdError';
  }
}

export function isValidTenantId(tenantId: unknown): tenantId is string {
  return typeof tenantId === 'string' && TENANT_ID_REGEX.test(tenantId);
}

async function loadTenantFromDatabase(tenantId: string): Promise<TenantConfig | null> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;

  // Why: SSRF defense-in-depth — even though callers should have validated
  // earlier, re-check at the network boundary before any string
  // interpolation reaches `fetch`.
  if (!isValidTenantId(tenantId)) {
    throw new InvalidTenantIdError();
  }

  try {
    const apiBase = process.env.TENANT_SERVICE_URL || process.env.API_URL || '';
    if (!apiBase) return null;

    // Why: build URL via `new URL` and `encodeURIComponent` so path segments
    // can never be reinterpreted as additional path components by `fetch`.
    const base = apiBase.endsWith('/') ? apiBase : `${apiBase}/`;
    const tenantUrl = new URL(
      `internal/tenants/${encodeURIComponent(tenantId)}`,
      base
    );

    const res = await fetch(tenantUrl, {
      headers: {
        'X-API-Key': process.env.INTERNAL_API_KEY || '',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: TenantConfig & { country?: string | null };
    };
    const raw = data.data;
    if (!raw) return null;
    // The tenant schema keeps the column name `country` (legacy); the
    // middleware surface is `countryCode`. Normalize here so every
    // downstream reader sees the unified field.
    return {
      ...raw,
      countryCode: (raw.countryCode ?? raw.country ?? null) as
        | string
        | null,
    };
  } catch {
    return null;
  }
}

async function loadTenantConfig(tenantId: string): Promise<TenantConfig | null> {
  const cached = tenantCache.get(tenantId);
  if (cached) return cached;

  const fromDb = await loadTenantFromDatabase(tenantId);
  if (fromDb) {
    tenantCache.set(tenantId, fromDb);
    return fromDb;
  }

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const config: TenantConfig = {
    id: tenantId,
    name: `Tenant ${tenantId}`,
    slug: tenantId.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    status: 'active',
    // Dev fallback is intentionally null — the resolver in the middleware
    // will fall back to DEFAULT_COUNTRY_ID, which logs a one-shot warning
    // so operators notice a tenant without a country code.
    countryCode: process.env.DEV_DEFAULT_COUNTRY_CODE?.trim() || null,
    settings: { ...DEFAULT_TENANT_SETTINGS },
    features: { ...DEFAULT_TENANT_FEATURES },
    limits: { ...DEFAULT_TENANT_LIMITS },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  tenantCache.set(tenantId, config);
  return config;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract tenant ID from request.
 *
 * DA1 MEDIUM finding: previously the subdomain branch returned
 * `parts[0]` without running `isValidTenantId`, so a direct caller of
 * `extractTenantId` (e.g. a future middleware or a test scaffold) could
 * receive an unvalidated value derived from the `Host` header — a
 * classic SSRF surface where an attacker controls the subdomain.
 * The downstream `tenantContextMiddleware` re-validates the result, but
 * any other consumer of this function (it is exported from this module)
 * had no such guarantee. Move the regex check inside `extractTenantId`
 * so every code path returns either a valid tenantId or `null`.
 */
function extractTenantId(c: Context): string | null {
  // Priority order:
  // 1. Auth context (from JWT)
  const auth = c.get('auth') as AuthContext | undefined;
  if (auth?.tenantId && isValidTenantId(auth.tenantId)) {
    return auth.tenantId;
  }

  // 2. X-Tenant-ID header
  const headerTenantId = c.req.header('X-Tenant-ID');
  if (headerTenantId && isValidTenantId(headerTenantId)) {
    return headerTenantId;
  }

  // 3. Subdomain extraction (tenant-slug.borjie.com)
  const host = c.req.header('Host');
  if (host) {
    const parts = host.split('.');
    if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'api') {
      const subdomain = parts[0];
      // DA1 MEDIUM: validate the subdomain before returning. The Host
      // header is fully attacker-controlled at the L7 boundary; an
      // un-validated value here would let traversal sequences (`..`),
      // URL-encoded escapes, or oversized strings flow downstream.
      if (subdomain && isValidTenantId(subdomain)) {
        return subdomain;
      }
    }
  }

  // 4. Query parameter (for testing/debug only)
  if (process.env.NODE_ENV === 'development') {
    const queryTenantId = c.req.query('tenantId');
    if (queryTenantId && isValidTenantId(queryTenantId)) {
      return queryTenantId;
    }
  }

  return null;
}

/**
 * Validate tenant status
 */
function isTenantActive(config: TenantConfig): boolean {
  return config.status === 'active' || config.status === 'trial';
}

/**
 * Check feature access
 */
function hasFeature(context: TenantContext, feature: keyof TenantFeatures): boolean {
  return Boolean(context.features[feature]);
}

/**
 * Check if limit is exceeded
 */
function isLimitExceeded(
  context: TenantContext,
  limit: keyof TenantLimits,
  currentUsage: number
): boolean {
  const maxValue = context.limits[limit];
  return currentUsage >= maxValue;
}

// ============================================================================
// Middleware Functions
// ============================================================================

/**
 * Main tenant context middleware
 * Extracts and validates tenant, sets context
 */
export const tenantContextMiddleware = createMiddleware(async (c, next) => {
  // F10 DecisionTrace — record the tenant-resolution decision so an
  // operator auditing "why did request X resolve to tenant Y?" gets a
  // single replayable trace. Inputs: the claims/headers we inspected.
  // Outcome: the resolved tenantId or the gate that fired.
  const auth = c.get('auth') as AuthContext | undefined;
  const trace = startDecisionTrace('tenant-context.resolve', {
    inputs: {
      authTenantClaim: auth?.tenantId ?? null,
      authUserId: auth?.userId ?? null,
      headerTenantPresent: typeof c.req.header('X-Tenant-ID') === 'string',
      hostHeader: c.req.header('Host') ?? null,
      method: c.req.method,
      path: c.req.path,
    },
    context: {
      // No tenantId yet — this trace is platform-tier, recorded with a
      // NULL tenant_id column. The admin replay UI reads via service-role.
      userId: auth?.userId,
    },
  });
  trace.addBranch({
    id: 'resolve',
    label: 'Resolve tenant from claims / header / subdomain',
    rationale: 'priority order: JWT > X-Tenant-ID > subdomain > dev query',
  });
  trace.addBranch({
    id: 'reject',
    label: 'Reject request (missing / invalid / inactive / not found)',
    rationale: 'counterfactual — taken when any guard fires',
  });

  const tenantId = extractTenantId(c);

  if (!tenantId) {
    trace.choose('reject', 'no tenantId found in claims/header/subdomain');
    trace.finalize({
      outcome: 'refused',
      output: { code: 'MISSING_TENANT', status: 400 },
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'MISSING_TENANT',
          message: 'Tenant context is required. Provide X-Tenant-ID header.',
        },
      },
      400
    );
  }

  // Why: SSRF via X-Tenant-ID — reject malformed IDs (path traversal,
  // URL-encoded escapes, oversized values) before they flow into the
  // downstream tenant-service fetch URL.
  if (!isValidTenantId(tenantId)) {
    trace.choose('reject', 'tenantId failed format regex');
    trace.finalize({
      outcome: 'refused',
      output: { code: 'INVALID_TENANT_ID', status: 400 },
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_TENANT_ID',
          message: 'Tenant ID format is invalid.',
        },
      },
      400
    );
  }

  const config = await loadTenantConfig(tenantId);

  if (!config) {
    trace.choose('reject', 'tenant row not found in DB');
    trace.finalize({
      outcome: 'refused',
      output: { code: 'TENANT_NOT_FOUND', status: 404, resolvedTenantId: tenantId },
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'TENANT_NOT_FOUND',
          message: 'Tenant not found',
        },
      },
      404
    );
  }

  if (!isTenantActive(config)) {
    trace.choose('reject', `tenant status=${config.status}`);
    trace.finalize({
      outcome: 'refused',
      output: {
        code: 'TENANT_INACTIVE',
        status: 403,
        resolvedTenantId: tenantId,
        tenantStatus: config.status,
      },
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'TENANT_INACTIVE',
          message: `Tenant account is ${config.status}. Please contact support.`,
        },
      },
      403
    );
  }

  // Resolve the country plugin from the tenant's country code. Falls back
  // to DEFAULT_COUNTRY_ID via the safe-resolve helper when the tenant row
  // has not migrated to countryCode yet — a one-shot warning is logged
  // so operators can catch the drift.
  const resolvedCountry = (config.countryCode ?? '').trim().toUpperCase();
  const countryPlugin = resolveCountryPluginWithDefault(resolvedCountry || null);

  // Set tenant context
  const tenantContext: TenantContext = {
    id: config.id,
    name: config.name,
    slug: config.slug,
    status: config.status,
    countryCode: countryPlugin.countryCode,
    settings: config.settings,
    features: config.features,
    limits: config.limits,
  };

  c.set('tenant', tenantContext);
  c.set('countryPlugin', countryPlugin);

  // Set response header for debugging
  c.header('X-Tenant-ID', tenantId);
  c.header('X-Country-Code', countryPlugin.countryCode);

  // F10 DecisionTrace — record the successful resolution. We do this
  // BEFORE `next()` so the outcome reflects the resolution decision
  // itself, not whatever happens downstream.
  trace.choose('resolve', `tenantId=${tenantId} country=${countryPlugin.countryCode}`);
  trace.finalize({
    outcome: 'executed',
    output: { resolvedTenantId: tenantId, countryCode: countryPlugin.countryCode },
  });

  await next();
});

/**
 * Optional tenant context middleware
 * Sets context if available, doesn't fail if missing
 */
export const optionalTenantContextMiddleware = createMiddleware(async (c, next) => {
  const tenantId = extractTenantId(c);

  // Why: SSRF via X-Tenant-ID — silently ignore invalid IDs in the optional
  // path so untrusted header values never reach the tenant-service fetch.
  if (tenantId && isValidTenantId(tenantId)) {
    const config = await loadTenantConfig(tenantId);

    if (config && isTenantActive(config)) {
      const resolvedCountry = (config.countryCode ?? '').trim().toUpperCase();
      const countryPlugin = resolveCountryPluginWithDefault(
        resolvedCountry || null,
      );

      c.set('tenant', {
        id: config.id,
        name: config.name,
        slug: config.slug,
        status: config.status,
        countryCode: countryPlugin.countryCode,
        settings: config.settings,
        features: config.features,
        limits: config.limits,
      } as TenantContext);
      c.set('countryPlugin', countryPlugin);

      c.header('X-Tenant-ID', tenantId);
      c.header('X-Country-Code', countryPlugin.countryCode);
    }
  }

  await next();
});

/**
 * Require specific tenant feature
 */
export const requireFeature = (feature: keyof TenantFeatures) => {
  return createMiddleware(async (c, next) => {
    const tenant = c.get('tenant') as TenantContext | undefined;

    if (!tenant) {
      return c.json(
        {
          success: false,
          error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
        },
        400
      );
    }

    if (!hasFeature(tenant, feature)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FEATURE_NOT_AVAILABLE',
            message: `Feature '${feature}' is not available on your plan. Please upgrade.`,
            feature,
          },
        },
        403
      );
    }

    await next();
  });
};

/**
 * Enforce tenant limits
 */
export const enforceLimit = (
  limit: keyof TenantLimits,
  getCurrentUsage: (c: Context, tenantId: string) => number | Promise<number>
) => {
  return createMiddleware(async (c, next) => {
    const tenant = c.get('tenant') as TenantContext | undefined;

    if (!tenant) {
      return c.json(
        {
          success: false,
          error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
        },
        400
      );
    }

    const currentUsage = await getCurrentUsage(c, tenant.id);

    if (isLimitExceeded(tenant, limit, currentUsage)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'LIMIT_EXCEEDED',
            message: `You have reached your ${limit} limit. Please upgrade your plan.`,
            limit,
            maxValue: tenant.limits[limit],
            currentUsage,
          },
        },
        403
      );
    }

    await next();
  });
};

/**
 * Ensure tenant isolation - request tenant matches auth tenant.
 *
 * Cross-tenant denial is the single highest-signal security event the
 * gateway produces: a fully-authenticated user attempting to reach
 * another tenant's resources. PO-port wave-5 wiring #4 hooks the
 * `crossOrgDenialRecorder` here so every TENANT_MISMATCH lands in the
 * recorder (in-memory ring buffer today; Drizzle adapter in follow-up)
 * and feeds the brute-force pattern scanner. Recording is fire-and-
 * forget: the recorder itself swallows all errors and rate-limits per
 * (actor, target) bucket, so this hook can NEVER break the response
 * path.
 */
export const ensureTenantIsolation = createMiddleware(async (c, next) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const tenant = c.get('tenant') as TenantContext | undefined;

  // Skip for platform admins
  if (auth && ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'].includes(auth.role)) {
    await next();
    return;
  }

  if (auth && tenant && auth.tenantId !== tenant.id) {
    // Fire-and-forget cross-tenant denial recording. The recorder is
    // always wired (in-memory sink as default); guard for shape so
    // older test contexts that don't bind `services` still work.
    try {
      const services = c.get('services') as
        | {
            crossOrgDenialRecorder?: {
              record: (input: {
                actorUserId?: string | null;
                actorTenantId?: string | null;
                targetTenantId: string;
                route: string;
                httpMethod: string;
                reason: string;
                requestId?: string | null;
              }) => Promise<{ admitted: boolean; droppedRollup: number }>;
            };
          }
        | undefined;
      const recorder = services?.crossOrgDenialRecorder;
      if (recorder) {
        // No `await` — the contract is fire-and-forget. We attach a
        // catch so an unhandled rejection cannot leak past the request.
        void recorder
          .record({
            actorUserId: auth.userId ?? null,
            actorTenantId: auth.tenantId ?? null,
            targetTenantId: tenant.id,
            route: c.req.path,
            httpMethod: c.req.method,
            reason: 'PERMISSION_DENIED',
            requestId: c.req.header('X-Request-ID') ?? null,
          })
          .catch(() => undefined);
      }
    } catch {
      // Defensive — never let the recorder block tenant isolation.
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'TENANT_MISMATCH',
          message: 'Access denied: tenant isolation violation',
        },
      },
      403
    );
  }

  await next();
});

/**
 * Validate tenant-specific settings for operation
 */
export const validateTenantSettings = (
  validator: (settings: TenantSettings, c: Context) => boolean | string
) => {
  return createMiddleware(async (c, next) => {
    const tenant = c.get('tenant') as TenantContext | undefined;

    if (!tenant) {
      return c.json(
        {
          success: false,
          error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
        },
        400
      );
    }

    const result = validator(tenant.settings, c);

    if (result !== true) {
      return c.json(
        {
          success: false,
          error: {
            code: 'SETTING_VALIDATION_FAILED',
            message: typeof result === 'string' ? result : 'Operation not allowed by tenant settings',
          },
        },
        400
      );
    }

    await next();
  });
};

// ============================================================================
// Utility Exports
// ============================================================================

export {
  tenantCache,
  loadTenantConfig,
  extractTenantId,
  isTenantActive,
  hasFeature,
  isLimitExceeded,
  DEFAULT_TENANT_SETTINGS,
  DEFAULT_TENANT_FEATURES,
  DEFAULT_TENANT_LIMITS,
};

// ============================================================================
// Hono Context Type Extension
// ============================================================================

declare module 'hono' {
  interface ContextVariableMap {
    tenant: TenantContext;
    countryPlugin: CountryPlugin;
  }
}
// @ts-nocheck
