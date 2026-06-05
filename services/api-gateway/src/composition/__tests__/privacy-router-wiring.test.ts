/**
 * Privacy-router wiring — fail-safe guarded-dispatch tests (security blocker
 * fix). The critical property: a routing error must NEVER forward the
 * original, un-stripped text to a cloud LLM.
 *
 *   - disabled flag        -> passthrough original text (operator opt-out)
 *   - route() throws        -> CONSERVATIVE: PII-strip + cloud, never raw
 *   - route() AND strip throw -> DENY (allowed:false, empty text)
 *   - explicit DENIED       -> allowed:false
 *   - happy path            -> processedText from the router result
 */

import { describe, it, expect } from 'vitest';
import type {
  PiiStripperPort,
  PrivacyRouter,
  PrivacyRoutingRequest,
  PrivacyRoutingResult,
  StripResult,
} from '@borjie/privacy-router';
import {
  consultPrivacyRouter,
  type WiredPrivacyRouter,
} from '../privacy-router-wiring.js';

const RAW = 'owner NIDA 19900101-12345-00001-23 wants a payout';
const STRIPPED = 'owner [REDACTED] wants a payout';

/** PII stripper stub that always strips the literal NIDA block. */
function strippingPii(): PiiStripperPort {
  return {
    stripPii: (): StripResult =>
      Object.freeze({
        stripped: STRIPPED,
        mappings: Object.freeze({ nida: '[REDACTED]' }),
      }),
    containsPii: () => true,
  };
}

/** PII stripper stub that throws (worst case). */
function throwingPii(): PiiStripperPort {
  return {
    stripPii: (): StripResult => {
      throw new Error('stripper exploded');
    },
    containsPii: () => true,
  };
}

/** Router stub whose route() rejects. */
function throwingRouter(): PrivacyRouter {
  return {
    route: async (): Promise<PrivacyRoutingResult> => {
      throw new Error('classify blew up');
    },
    classify: () => 'INTERNAL',
    isCloudAllowed: () => true,
    getAuditLog: () => [],
    getAuditStats: () => ({
      total: 0,
      byClassification: { PUBLIC: 0, INTERNAL: 0, CONFIDENTIAL: 0, RESTRICTED: 0 },
      byEndpoint: {},
      deniedCount: 0,
      piiStrippedCount: 0,
    }),
    clearAuditLog: () => undefined,
  };
}

/** Router stub returning a fixed result. */
function fixedRouter(result: PrivacyRoutingResult): PrivacyRouter {
  return {
    ...throwingRouter(),
    route: async () => result,
  };
}

function wired(over: Partial<WiredPrivacyRouter>): WiredPrivacyRouter {
  return Object.freeze({
    router: throwingRouter(),
    enabled: true,
    pii: strippingPii(),
    ...over,
  });
}

const request: PrivacyRoutingRequest = { text: RAW };

describe('consultPrivacyRouter — fail-safe posture', () => {
  it('disabled flag: passes the ORIGINAL text through (operator opt-out)', async () => {
    const decision = await consultPrivacyRouter(
      wired({ enabled: false }),
      request,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.processedText).toBe(RAW);
  });

  it('route() throws: fails CONSERVATIVE — strips PII, never forwards raw text', async () => {
    const decision = await consultPrivacyRouter(
      wired({ router: throwingRouter(), pii: strippingPii() }),
      request,
    );
    expect(decision.allowed).toBe(true);
    // The raw NIDA must NOT be present; the stripped text is forwarded.
    expect(decision.processedText).toBe(STRIPPED);
    expect(decision.processedText).not.toContain('19900101-12345-00001-23');
    expect(decision.result.piiStripped).toBe(true);
    expect(decision.result.classification).toBe('CONFIDENTIAL');
  });

  it('route() AND strip both throw: DENIES the turn (no egress at all)', async () => {
    const decision = await consultPrivacyRouter(
      wired({ router: throwingRouter(), pii: throwingPii() }),
      request,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.processedText).toBe('');
    expect(decision.result.endpoint).toBe('DENIED');
  });

  it('explicit DENIED from router: allowed:false, empty text', async () => {
    const denied: PrivacyRoutingResult = {
      endpoint: 'DENIED',
      piiStripped: true,
      strippedFields: [],
      classification: 'RESTRICTED',
      reason: 'restricted, local down',
      timestamp: new Date().toISOString(),
    };
    const decision = await consultPrivacyRouter(
      wired({ router: fixedRouter(denied) }),
      request,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.processedText).toBe('');
  });

  it('happy path: forwards the router processedText', async () => {
    const ok: PrivacyRoutingResult = {
      endpoint: 'claude',
      piiStripped: true,
      strippedFields: ['nida'],
      classification: 'CONFIDENTIAL',
      reason: 'ok',
      timestamp: new Date().toISOString(),
      processedText: STRIPPED,
    };
    const decision = await consultPrivacyRouter(
      wired({ router: fixedRouter(ok) }),
      request,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.processedText).toBe(STRIPPED);
  });
});
