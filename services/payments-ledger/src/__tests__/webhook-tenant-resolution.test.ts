/**
 * W4-A follow-up: webhook tenant resolution tests.
 *
 * W4-A widened `PaymentOrchestrationService.handleWebhook` to require a
 * `tenantId` so the tenant-scoped repository (`findByExternalId`, migration
 * 0169) can guarantee cross-tenant isolation. The webhook routers in
 * `server.ts` MUST resolve tenantId from the verified provider payload
 * before forwarding. These tests pin down the resolution semantics for
 * Stripe and M-Pesa:
 *
 *   - Webhook with derivable tenantId succeeds (returns a TenantId).
 *   - Webhook with no derivable tenantId rejects (returns null so the
 *     router can short-circuit with 400 + MISSING_TENANT_CONTEXT).
 *   - A spoofed `metadata.tenant_id` claiming tenant A while the payment
 *     intent belongs to tenant B is detected downstream because the
 *     repository's `findByExternalId` is tenant-scoped and will not find
 *     the row — the resolver's job is only to surface the metadata claim.
 *     We assert the surfacing is faithful so the repo's scoping can do its
 *     job.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';

// `server.ts` initialises pino with `pino-pretty` when NODE_ENV !== 'production';
// that transport package isn't resolvable from this workspace at test time.
// Force production-mode logger init BEFORE the dynamic import so the side
// effect doesn't crash the suite.
type ServerExports = typeof import('../server');
let resolveStripeTenantId: ServerExports['resolveStripeTenantId'];
let resolveMpesaTenantByShortCode: ServerExports['resolveMpesaTenantByShortCode'];
let resolveMpesaStkTenantId: ServerExports['resolveMpesaStkTenantId'];
let loadMpesaShortCodeMap: ServerExports['loadMpesaShortCodeMap'];
let __resetMpesaShortCodeMapCache: ServerExports['__resetMpesaShortCodeMapCache'];
let MissingTenantContextError: ServerExports['MissingTenantContextError'];

beforeAll(async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevMpesaSecret = process.env.MPESA_WEBHOOK_SECRET;
  // Force production-mode pino init (skip pino-pretty) but supply a
  // dummy webhook secret so the M-Pesa signature middleware's fail-closed
  // guard accepts the route mount.
  process.env.NODE_ENV = 'production';
  process.env.MPESA_WEBHOOK_SECRET =
    process.env.MPESA_WEBHOOK_SECRET ?? 'test-secret-not-used-here';
  const mod = await import('../server');
  resolveStripeTenantId = mod.resolveStripeTenantId;
  resolveMpesaTenantByShortCode = mod.resolveMpesaTenantByShortCode;
  resolveMpesaStkTenantId = mod.resolveMpesaStkTenantId;
  loadMpesaShortCodeMap = mod.loadMpesaShortCodeMap;
  __resetMpesaShortCodeMapCache = mod.__resetMpesaShortCodeMapCache;
  MissingTenantContextError = mod.MissingTenantContextError;
  // Restore so suite expectations against NODE_ENV / secrets are unaffected.
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
  if (prevMpesaSecret === undefined) delete process.env.MPESA_WEBHOOK_SECRET;
  else process.env.MPESA_WEBHOOK_SECRET = prevMpesaSecret;
});

describe('W4-A webhook tenant resolution', () => {
  describe('resolveStripeTenantId', () => {
    it('returns the tenantId when metadata.tenantId is present', () => {
      const result = resolveStripeTenantId({
        metadata: { tenantId: 'tenant_alpha' },
      });
      expect(result).toBe('tenant_alpha');
    });

    it('also accepts snake_case metadata.tenant_id', () => {
      const result = resolveStripeTenantId({
        metadata: { tenant_id: 'tenant_beta' },
      });
      expect(result).toBe('tenant_beta');
    });

    it('returns null when metadata is missing', () => {
      expect(resolveStripeTenantId({})).toBeNull();
    });

    it('returns null when metadata is present but tenantId absent', () => {
      expect(
        resolveStripeTenantId({ metadata: { unrelated: 'value' } })
      ).toBeNull();
    });

    it('returns null when metadata is null', () => {
      expect(resolveStripeTenantId({ metadata: null })).toBeNull();
    });

    it('returns null when metadata.tenantId is non-string (ignores it)', () => {
      expect(
        resolveStripeTenantId({ metadata: { tenantId: 12345 } as unknown as Record<string, unknown> })
      ).toBeNull();
    });

    it('faithfully surfaces the metadata claim so the repo can detect cross-tenant spoofs', () => {
      // Scenario: an attacker who controls the metadata at intent-creation
      // time stamps it with tenant A, but at processing time the external
      // id actually belongs to tenant B in the database. This resolver's
      // contract is to surface what the metadata says (tenant A); the
      // tenant-scoped repository will then fail to find the row under
      // tenant A and the orchestrator logs a non-mutating miss. We pin
      // the surfacing here.
      const result = resolveStripeTenantId({
        metadata: { tenantId: 'tenant_attacker_claim' },
      });
      expect(result).toBe('tenant_attacker_claim');
    });
  });

  describe('resolveMpesaTenantByShortCode + loadMpesaShortCodeMap', () => {
    let prevMap: string | undefined;

    beforeEach(() => {
      prevMap = process.env.MPESA_SHORTCODE_TENANT_MAP;
      __resetMpesaShortCodeMapCache();
    });

    afterEach(() => {
      if (prevMap === undefined) {
        delete process.env.MPESA_SHORTCODE_TENANT_MAP;
      } else {
        process.env.MPESA_SHORTCODE_TENANT_MAP = prevMap;
      }
      __resetMpesaShortCodeMapCache();
    });

    it('parses a JSON map and resolves a known shortcode', () => {
      process.env.MPESA_SHORTCODE_TENANT_MAP = JSON.stringify({
        '174379': 'tenant_one',
        '600000': 'tenant_two',
      });
      expect(resolveMpesaTenantByShortCode('174379')).toBe('tenant_one');
      expect(resolveMpesaTenantByShortCode('600000')).toBe('tenant_two');
    });

    it('returns null for an unknown shortcode', () => {
      process.env.MPESA_SHORTCODE_TENANT_MAP = JSON.stringify({
        '174379': 'tenant_one',
      });
      expect(resolveMpesaTenantByShortCode('999999')).toBeNull();
    });

    it('returns null when the env var is unset (empty map)', () => {
      delete process.env.MPESA_SHORTCODE_TENANT_MAP;
      expect(resolveMpesaTenantByShortCode('174379')).toBeNull();
    });

    it('fails closed on malformed JSON (empty map, no throw)', () => {
      process.env.MPESA_SHORTCODE_TENANT_MAP = '{not json';
      expect(loadMpesaShortCodeMap().size).toBe(0);
      expect(resolveMpesaTenantByShortCode('174379')).toBeNull();
    });

    it('ignores entries whose value is not a string', () => {
      process.env.MPESA_SHORTCODE_TENANT_MAP = JSON.stringify({
        '174379': 'tenant_one',
        '600000': 42,
      });
      expect(resolveMpesaTenantByShortCode('174379')).toBe('tenant_one');
      expect(resolveMpesaTenantByShortCode('600000')).toBeNull();
    });
  });

  describe('resolveMpesaStkTenantId', () => {
    let prevMap: string | undefined;
    let prevShortCode: string | undefined;

    beforeEach(() => {
      prevMap = process.env.MPESA_SHORTCODE_TENANT_MAP;
      prevShortCode = process.env.MPESA_BUSINESS_SHORT_CODE;
      __resetMpesaShortCodeMapCache();
    });

    afterEach(() => {
      if (prevMap === undefined) delete process.env.MPESA_SHORTCODE_TENANT_MAP;
      else process.env.MPESA_SHORTCODE_TENANT_MAP = prevMap;
      if (prevShortCode === undefined) delete process.env.MPESA_BUSINESS_SHORT_CODE;
      else process.env.MPESA_BUSINESS_SHORT_CODE = prevShortCode;
      __resetMpesaShortCodeMapCache();
    });

    it('resolves via the configured default shortcode', () => {
      process.env.MPESA_BUSINESS_SHORT_CODE = '174379';
      process.env.MPESA_SHORTCODE_TENANT_MAP = JSON.stringify({
        '174379': 'tenant_default',
      });
      expect(resolveMpesaStkTenantId()).toBe('tenant_default');
    });

    it('returns null when the configured shortcode is not in the map', () => {
      process.env.MPESA_BUSINESS_SHORT_CODE = '174379';
      process.env.MPESA_SHORTCODE_TENANT_MAP = JSON.stringify({
        '600000': 'tenant_other',
      });
      expect(resolveMpesaStkTenantId()).toBeNull();
    });

    it('returns null when MPESA_BUSINESS_SHORT_CODE is unset', () => {
      delete process.env.MPESA_BUSINESS_SHORT_CODE;
      process.env.MPESA_SHORTCODE_TENANT_MAP = JSON.stringify({
        '174379': 'tenant_default',
      });
      expect(resolveMpesaStkTenantId()).toBeNull();
    });
  });

  describe('MissingTenantContextError', () => {
    it('exposes the MISSING_TENANT_CONTEXT code', () => {
      const err = new MissingTenantContextError('stripe', 'no metadata');
      expect(err.code).toBe('MISSING_TENANT_CONTEXT');
      expect(err.message).toContain('stripe');
      expect(err.message).toContain('no metadata');
      expect(err.name).toBe('MissingTenantContextError');
    });
  });
});
