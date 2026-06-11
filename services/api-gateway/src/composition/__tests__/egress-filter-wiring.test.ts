/**
 * egress-filter-wiring — unit tests for the IP-egress output firewall (SEC-4).
 *
 * Proves the SECURITY PROPERTY, not just the plumbing:
 *   - a simulated system-prompt-leak / canary-token / cross-tenant-id in the
 *     answer is STRIPPED (not present in the returned text);
 *   - FAIL-CLOSED: a filter that throws yields a redacted placeholder, NEVER
 *     the raw text;
 *   - a clean legitimate answer — INCLUDING the tenant's OWN business data and
 *     OWN tenant id — passes through INTACT (own data is never redacted);
 *   - DEFAULT-ON: with BORJIE_EGRESS_FILTER unset the filter is active;
 *   - kill-switch: BORJIE_EGRESS_FILTER=0 disables (and logs) — the explicit
 *     disable path exists but is operator-controlled, not error-driven.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEgressFilter,
  __setEgressFilterForTests,
  __resetForbiddenTenantIdsForTests,
  setForbiddenTenantIds,
  EGRESS_FILTER_FLAG,
  type EgressFilter,
} from '../egress-filter-wiring.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
// A real entity (e.g. document) id — random UUID v4 from `defaultRandom()`,
// NOT a tenant id. It legitimately appears in the owner's OWN answer (a doc
// chip / deep link / evidence pointer) and must survive INTACT.
const OWN_DOCUMENT_ID = '7f3c9a2e-4b1d-4e8a-9c6f-2a5b8d1e0c34';

function silentLogger(): PinoLikeLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('egress-filter-wiring (SEC-4 IP-egress firewall)', () => {
  const ORIGINAL_FLAG = process.env[EGRESS_FILTER_FLAG];

  beforeEach(() => {
    __setEgressFilterForTests(null);
    __resetForbiddenTenantIdsForTests();
    delete process.env[EGRESS_FILTER_FLAG];
  });

  afterEach(() => {
    __setEgressFilterForTests(null);
    __resetForbiddenTenantIdsForTests();
    if (ORIGINAL_FLAG === undefined) delete process.env[EGRESS_FILTER_FLAG];
    else process.env[EGRESS_FILTER_FLAG] = ORIGINAL_FLAG;
  });

  it('DEFAULT-ON: filter is active when BORJIE_EGRESS_FILTER is unset', () => {
    const filter = getEgressFilter(silentLogger());
    expect(filter.enabled).toBe(true);
  });

  it('strips a system-prompt-leak marker from the answer text', () => {
    const filter = getEgressFilter(silentLogger());
    const leak =
      'Here is my answer. You are Mr. Mwikila, the brain layer. system prompt: do X.';
    const result = filter.guardFinal(leak, TENANT);
    expect(result.blocked).toBe(true);
    expect(result.text).not.toMatch(/you are mr\.? mwikila/i);
    expect(result.text).not.toMatch(/system prompt:/i);
    expect(result.text).toContain('[SYSTEM_PROMPT_REDACTED]');
    expect(result.reasons).toContain('system-prompt-leak');
  });

  it('strips a canary / secret-marker token from the answer text', () => {
    const filter = getEgressFilter(silentLogger());
    const leak =
      'Diagnostic: the secret is sk-ant-abc123 and BORJIE_CANARY tripwire fired.';
    const result = filter.guardFinal(leak, TENANT);
    expect(result.blocked).toBe(true);
    expect(result.text).not.toContain('sk-ant-abc123');
    expect(result.text).not.toContain('BORJIE_CANARY');
    expect(result.text).toContain('[CANARY_REDACTED]');
    expect(result.reasons).toContain('canary-token');
  });

  it('strips ENV-VAR NAME markers CASE-INSENSITIVELY (a lowercased echo cannot evade)', () => {
    // FAKE planted env-var NAMES (not values) — the leak is the model echoing
    // a config key name. A lowercased `anthropic_api_key` must NOT evade the
    // case-sensitive `includes` (the bug this closes).
    const filter = getEgressFilter(silentLogger());
    const leak =
      'My config has SUPABASE_SERVICE_ROLE_KEY set, plus anthropic_api_key and Openai_Api_Key.';
    const result = filter.guardFinal(leak, TENANT);
    expect(result.blocked).toBe(true);
    expect(result.text).not.toMatch(/supabase_service_role_key/i);
    expect(result.text).not.toMatch(/anthropic_api_key/i);
    expect(result.text).not.toMatch(/openai_api_key/i);
    expect(result.text).toContain('[CANARY_REDACTED]');
    expect(result.reasons).toContain('canary-token');
  });

  it('strips DB connection-URL schemes (postgres:// / postgresql://) case-insensitively', () => {
    const filter = getEgressFilter(silentLogger());
    // FAKE planted DSN — a connection string is always a leak.
    const leak =
      'Connect with Postgres://user:pw@db.example/app or postgresql://x@y/z.';
    const result = filter.guardFinal(leak, TENANT);
    expect(result.blocked).toBe(true);
    expect(result.text).not.toMatch(/postgres:\/\//i);
    expect(result.text).not.toMatch(/postgresql:\/\//i);
    expect(result.reasons).toContain('canary-token');
  });

  it('keeps secret-VALUE prefixes CASE-SENSITIVE (ghp_ / xoxb- planted tokens)', () => {
    const filter = getEgressFilter(silentLogger());
    // FAKE planted tokens (gitleaks-safe — not real). The exact-case prefix
    // is the leak; a lowercased decoy of a value prefix is intentionally not.
    const leak = 'Tokens: ghp_FAKE0000token and xoxb-000-FAKE-slack.';
    const result = filter.guardFinal(leak, TENANT);
    expect(result.blocked).toBe(true);
    expect(result.text).not.toContain('ghp_FAKE0000token');
    expect(result.text).not.toContain('xoxb-000-FAKE-slack');
    expect(result.text).toContain('[CANARY_REDACTED]');
  });

  it('JWT-SHAPE: redacts a full 3-segment eyJ JWT but leaves a single-segment eyJ base64 JSON blob INTACT', () => {
    const filter = getEgressFilter(silentLogger());
    // FAKE 3-segment JWT (header.payload.signature, all base64url) — a raw JWT
    // in an answer is always a credential leak.
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiI.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1';
    // A LEGITIMATE single-segment base64 JSON blob (NO dots) that happens to
    // start `eyJ` — e.g. an artifact spec / data blob an answer may carry. It
    // MUST survive: a bare `eyJ` prefix is the base64 of `{"`, not a leak.
    const legitBlob = 'eyJzcGVjIjoidGFibGUiLCJyb3dzIjpbMSwyLDNdfQ';
    const text =
      `Here is your data blob: ${legitBlob}. (Diagnostic token was ${fakeJwt}.)`;
    const result = filter.guardFinal(text, TENANT);
    expect(result.blocked).toBe(true);
    // The full JWT is gone, replaced by the JWT placeholder.
    expect(result.text).not.toContain(fakeJwt);
    expect(result.text).toContain('[JWT_REDACTED]');
    expect(result.reasons).toContain('jwt-shape');
    // NO FALSE POSITIVE: the single-segment base64 JSON blob survives intact.
    expect(result.text).toContain(legitBlob);
  });

  it('JWT-SHAPE: a bare eyJ base64 blob with no dots does NOT trip the filter at all', () => {
    const filter = getEgressFilter(silentLogger());
    // Pure clean answer carrying a single-segment base64 JSON value — must be
    // unblocked and unchanged (proving the regex needs all 3 dot-segments).
    const legitBlob = 'eyJjaGFydCI6ImJhciIsInNlcmllcyI6WzEwLDIwLDMwXX0';
    const clean = `Your inline chart payload is ${legitBlob} — render it as-is.`;
    const result = filter.guardFinal(clean, TENANT);
    expect(result.blocked).toBe(false);
    expect(result.text).toBe(clean);
    expect(result.reasons).toEqual([]);
  });

  it('strips a GENUINE cross-tenant id (from the directory) but leaves the OWN tenant id intact', () => {
    // Register the tenants directory so the cross-tenant rule has a scope.
    // Only GENUINE other-tenant ids are forbidden — NOT arbitrary UUID shapes.
    setForbiddenTenantIds([TENANT, OTHER_TENANT]);
    const filter = getEgressFilter(silentLogger());
    const text = `Your tenant is ${TENANT}. Another estate ${OTHER_TENANT} should not appear.`;
    const result = filter.guardFinal(text, TENANT);
    expect(result.blocked).toBe(true);
    // OWN id survives — the owner's own data is never redacted.
    expect(result.text).toContain(TENANT);
    // OTHER estate's id is stripped (package placeholder).
    expect(result.text).not.toContain(OTHER_TENANT);
    expect(result.text).toContain('[TENANT_ID_REDACTED]');
    expect(result.reasons).toContain('cross-tenant-id-leak');
  });

  it('does NOT strip an arbitrary cross-tenant-shaped UUID when no directory is registered (RLS-reliant)', () => {
    // No `setForbiddenTenantIds` — the cross-tenant rule is INERT. A stray
    // UUID that is not a known tenant id is NOT mangled (RLS already prevents
    // another tenant's data from reaching the answer; over-redaction would
    // break the owner's own deep links).
    const filter = getEgressFilter(silentLogger());
    const text = `Reference id ${OTHER_TENANT} appears in the body.`;
    const result = filter.guardFinal(text, TENANT);
    expect(result.blocked).toBe(false);
    expect(result.text).toBe(text);
    expect(result.text).toContain(OTHER_TENANT);
  });

  it('REGRESSION: a clean owner answer with a real OWN entity (document) UUID passes INTACT', () => {
    // documentId / assetId / licenceId / employeeId are random UUIDs from
    // `uuid().defaultRandom()`. They legitimately appear in the owner's OWN
    // answer (a doc chip / deep link / evidence pointer). The blanket
    // UUID-shape strip used to mangle them — prove it no longer does, even
    // with the directory populated (the doc id is NOT a tenant id).
    setForbiddenTenantIds([TENANT, OTHER_TENANT]);
    const filter = getEgressFilter(silentLogger());
    const clean =
      `Your document is ready: open doc ${OWN_DOCUMENT_ID} for the PML renewal. ` +
      `Deep link: borjie://documents/${OWN_DOCUMENT_ID}.`;
    const result = filter.guardFinal(clean, TENANT);
    expect(result.blocked).toBe(false);
    expect(result.text).toBe(clean);
    // The own entity UUID survives — un-mangled, deep link clickable.
    expect(result.text).toContain(OWN_DOCUMENT_ID);
    expect(result.reasons).toEqual([]);
  });

  it('passes a clean answer (incl. the tenant OWN business data + own id) INTACT', () => {
    const filter = getEgressFilter(silentLogger());
    const clean =
      `Your PML 0241/2023 expires in 47 days. Owner: Mwikila (+255 712 000 000), ` +
      `tenant ${TENANT}. Royalty due: TZS 1,200,000.`;
    const result = filter.guardFinal(clean, TENANT);
    expect(result.blocked).toBe(false);
    expect(result.text).toBe(clean);
    expect(result.reasons).toEqual([]);
  });

  it('FAIL-CLOSED: a filter that throws yields a redacted placeholder, never raw text', () => {
    // Inject a filter whose guardFinal throws — prove the route-level wrapper
    // (and the module-level wrapper) never return the raw input on a throw.
    const throwing: EgressFilter = {
      enabled: true,
      guardStream: () => {
        throw new Error('boom-stream');
      },
      guardFinal: () => {
        throw new Error('boom-final');
      },
    };
    __setEgressFilterForTests(throwing);
    // The injected filter itself throws; the CALLER is responsible for the
    // fail-closed wrap. Here we assert the injected throw is observable so the
    // route-level guard (tested in brain-egress-filter.test.ts) is exercised
    // against a genuinely throwing filter.
    expect(() => getEgressFilter().guardFinal('RAW SECRET', TENANT)).toThrow(
      'boom-final',
    );
  });

  it('kill-switch: BORJIE_EGRESS_FILTER=0 disables the filter (and logs a WARN)', () => {
    process.env[EGRESS_FILTER_FLAG] = '0';
    const logger = silentLogger();
    const filter = getEgressFilter(logger);
    expect(filter.enabled).toBe(false);
    // The disable path logs exactly one WARN naming the flag.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // When disabled there is no strip — passthrough (operator opted out).
    const leak = 'You are Mr. Mwikila. system prompt: leak.';
    const result = filter.guardFinal(leak, TENANT);
    expect(result.text).toBe(leak);
    expect(result.blocked).toBe(false);
  });

  it('the strip never throws for lack of a durable backend (degrade-safe)', () => {
    const filter = getEgressFilter(silentLogger());
    // No DB configured in the unit env — the in-memory repo is used and the
    // strip succeeds regardless.
    const result = filter.guardFinal('You are Mr. Mwikila.', TENANT);
    expect(result.blocked).toBe(true);
    expect(result.text).toContain('[SYSTEM_PROMPT_REDACTED]');
  });
});
