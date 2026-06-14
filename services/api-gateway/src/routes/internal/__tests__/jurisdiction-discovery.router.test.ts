/**
 * internal/jurisdiction-discovery.hono — the mwikila.jurisdiction.discover
 * brain-tool loopback.
 *
 * The discover tool POSTed to /internal/jurisdiction-discovery/discover but
 * the route was never mounted AND the discovery service was never composed,
 * so every call 404'd and fell back to a stub. This suite proves the route is
 * now reachable, auth-gated, and serves a REAL seed/fallback profile:
 *
 *   1. AUTH GATE — no token → 401.
 *   2. A seeded country (TZ) short-circuits to origin='seed' with regulators.
 *   3. An unseeded country degrades honestly (structure intact, low
 *      confidence) — Mr. Mwikila NEVER says "I don't know".
 *   4. A missing country → 400.
 *
 * The DB is null in test (no live PG), so the corpus + cache probes return
 * empty — exactly the production degrade path — and the seed short-circuit +
 * fallback still answer.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import internalJurisdictionDiscoveryRouter from '../jurisdiction-discovery.hono.js';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';

function app(): Hono {
  const a = new Hono();
  a.route('/internal/jurisdiction-discovery', internalJurisdictionDiscoveryRouter);
  return a;
}

function bearer(role: UserRole, tenantId = 'tenant_1'): string {
  return `Bearer ${generateToken({
    userId: 'op_1',
    tenantId,
    role: role as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

function discover(country: string, auth?: string) {
  return app().request('/internal/jurisdiction-discovery/discover', {
    method: 'POST',
    body: JSON.stringify({ country }),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  });
}

describe('internal/jurisdiction-discovery — auth gate', () => {
  it('401 without a token', async () => {
    const res = await discover('Tanzania');
    expect(res.status).toBe(401);
  });
});

describe('internal/jurisdiction-discovery — discover', () => {
  it('a seeded country (TZ) short-circuits to origin=seed with regulators', async () => {
    const res = await discover('Tanzania', bearer(UserRole.OWNER));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      countryCode: string;
      origin: string;
      regulators: Array<{ name: string; domain: string }>;
      validityScore: number;
      promotionHint: string;
    };
    expect(body.countryCode).toBe('TZ');
    expect(body.origin).toBe('seed');
    expect(body.regulators.length).toBeGreaterThanOrEqual(1);
    expect(body.validityScore).toBe(1);
    expect(body.promotionHint).toContain('curated');
  });

  it('an unseeded country degrades honestly — never "I don\'t know"', async () => {
    const res = await discover('Mongolia', bearer(UserRole.SUPER_ADMIN));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      countryName: string;
      regulators: unknown[];
      lowConfidence: boolean;
      origin: string;
    };
    // Structure intact + a best-effort regulator entry; low confidence.
    expect(body.countryName.toLowerCase()).toContain('mongolia');
    expect(body.regulators.length).toBeGreaterThanOrEqual(1);
    expect(body.lowConfidence).toBe(true);
    expect(['discovered', 'fallback']).toContain(body.origin);
  });

  it('400 when country is missing', async () => {
    const res = await app().request('/internal/jurisdiction-discovery/discover', {
      method: 'POST',
      body: JSON.stringify({ notCountry: 1 }),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(400);
  });
});
