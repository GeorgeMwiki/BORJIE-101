/**
 * Cross-tenant route allow-list.
 *
 * Some routes LEGITIMATELY span tenants (platform admin, billing
 * collection, system jobs, public auth). Each entry MUST carry a
 * documented reason so the next auditor can see why the bypass is
 * acceptable.
 *
 * The cross-tenant regression generator (and the CI gate) consults
 * this list to skip routes that match.
 *
 * Pattern matching is glob-ish but evaluated as a plain RegExp built
 * from the path:
 *   - `*` matches one path segment
 *   - `**` matches any depth
 *   - everything else is treated literally and `:param` segments are
 *     treated as `[^/]+`.
 */

export interface AllowlistEntry {
  /** Route path pattern, e.g. `/v1/admin/**` */
  readonly path: string;
  /** Allowed HTTP methods. `*` = all. */
  readonly methods: ReadonlyArray<string> | '*';
  /** Why this route is allowed to span tenants — required. */
  readonly reason: string;
  /** GitHub handle / team that owns the bypass — for follow-ups. */
  readonly owner: string;
}

export const CROSS_TENANT_ALLOWLIST: ReadonlyArray<AllowlistEntry> = [
  {
    path: '/v1/admin/**',
    methods: '*',
    reason:
      'Platform SUPER_ADMIN routes audit + manage every tenant. Role gate enforces SUPER_ADMIN; audit events emit per call.',
    owner: 'platform-admin',
  },
  {
    path: '/v1/platform/**',
    methods: '*',
    reason:
      'Platform-level health, killswitch + feature-flag controls. Cross-tenant by design; SUPER_ADMIN-gated.',
    owner: 'platform-admin',
  },
  {
    path: '/v1/billing/**',
    methods: '*',
    reason:
      'Billing collection runs cross-tenant ledger walks. Service-role bypass; not exposed to authenticated users.',
    owner: 'finance',
  },
  {
    path: '/v1/system/**',
    methods: '*',
    reason:
      'System / health / metrics endpoints have no tenant context — they report platform state.',
    owner: 'sre',
  },
  {
    path: '/v1/public/**',
    methods: '*',
    reason:
      'Public marketing site routes (leads capture, public sandbox) — no tenant context expected.',
    owner: 'marketing',
  },
  {
    path: '/v1/auth/**',
    methods: '*',
    reason:
      'Authentication routes (login, refresh, password reset) precede tenant context resolution.',
    owner: 'platform-auth',
  },
  {
    path: '/v1/onboarding/**',
    methods: '*',
    reason:
      'Tenant-bootstrap onboarding sessions exist BEFORE a tenant row — see migration 0164_onboarding_sessions.sql.',
    owner: 'onboarding',
  },
  {
    path: '/v1/webhooks/**',
    methods: '*',
    reason:
      'Inbound webhooks from external systems (Stripe, M-Pesa) carry their own signed payloads + provider tenant routing.',
    owner: 'integrations',
  },
  {
    path: '/v1/cot/query',
    methods: ['GET'],
    reason:
      'Admin-only CoT-query endpoint already has its own RLS-aware route-layer assertion at services/api-gateway/src/routes/__tests__/cot-query-rls.test.ts.',
    owner: 'safety',
  },
  {
    path: '/v1/health',
    methods: ['GET'],
    reason: 'Health probe — no tenant context.',
    owner: 'sre',
  },
  {
    path: '/v1/metrics',
    methods: ['GET'],
    reason: 'Prometheus scrape — no tenant context.',
    owner: 'sre',
  },
  {
    path: '/v1/openapi*',
    methods: ['GET'],
    reason: 'OpenAPI schema — no tenant data.',
    owner: 'platform-api',
  },
  {
    path: '/v1/marketplace/public/**',
    methods: ['GET'],
    reason:
      'Public marketplace listings are cross-tenant by design (tenants opt in to listing).',
    owner: 'marketplace',
  },
  {
    path: '/v1/migration/run',
    methods: '*',
    reason:
      'Database-migration runner — platform-wide DDL, runs under service role.',
    owner: 'platform-data',
  },
];

/**
 * Convert a glob-ish pattern to a RegExp. Exposed for tests.
 */
export function patternToRegExp(pattern: string): RegExp {
  // Tokenise globs and route params BEFORE regex-escaping so the
  // sentinels survive the escape pass and become real regex syntax.
  const tokenised = pattern
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '__SINGLESTAR__')
    .replace(/:[A-Za-z0-9_]+/g, '__PARAM__');
  const escaped = tokenised
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/__GLOBSTAR__/g, '.*')
    .replace(/__SINGLESTAR__/g, '[^/]+')
    .replace(/__PARAM__/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

/**
 * Check whether a given (method, path) is in the cross-tenant allowlist.
 */
export function isAllowedCrossTenant(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  return CROSS_TENANT_ALLOWLIST.some((entry) => {
    const methodOk =
      entry.methods === '*' ||
      entry.methods.map((m) => m.toUpperCase()).includes(upper);
    if (!methodOk) return false;
    return patternToRegExp(entry.path).test(path);
  });
}
