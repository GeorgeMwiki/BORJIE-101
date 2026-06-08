/**
 * brain-egress-filter — route-level egress firewall tests (SEC-4).
 *
 * Exercises the ACTUAL emit-path guards in brain.hono.ts (the same functions
 * the SSE/JSON handlers call on every user-visible span) against the live
 * egress filter, proving the IP-leak property holds on the real chokepoint:
 *
 *   - a system-prompt-leak / canary-token / cross-tenant-id in a frame is
 *     STRIPPED before the frame leaves the gateway;
 *   - FAIL-CLOSED: a filter that THROWS yields a redacted placeholder on the
 *     emit path — the raw text is NEVER in the client frame;
 *   - a clean legitimate frame (incl. the tenant's OWN id) passes INTACT;
 *   - tool_call args (a classic leak vector) are guarded.
 */

// Pin a minimal brain env BEFORE importing brain.hono so any lazy module-init
// has what it needs (the guard functions under test do not touch env/db, but
// importing the route module is cheaper to keep robust).
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET || 'test-secret-supabase-jwt-1234567890-abcdefghijkl';
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key-aaaaaaaaaaaaaaaaaaaa';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  guardStreamText,
  guardFinalText,
  guardToolArgs,
  guardPublicFrame,
  type PublicSseFrame,
} from '../brain.hono';
import {
  __setEgressFilterForTests,
  __resetForbiddenTenantIdsForTests,
  setForbiddenTenantIds,
  type EgressFilter,
} from '../../composition/egress-filter-wiring.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
// A real entity (document) id — random UUID v4 from `defaultRandom()`, NOT a
// tenant id. Must survive INTACT in the owner's own answer / deep link.
const OWN_DOCUMENT_ID = '7f3c9a2e-4b1d-4e8a-9c6f-2a5b8d1e0c34';

describe('brain.hono egress guards (SEC-4 emit-path firewall)', () => {
  beforeEach(() => {
    // Reset to the real default-on filter for each test.
    __setEgressFilterForTests(null);
    __resetForbiddenTenantIdsForTests();
    delete process.env.BORJIE_EGRESS_FILTER;
  });

  afterEach(() => {
    __setEgressFilterForTests(null);
    __resetForbiddenTenantIdsForTests();
  });

  it('strips a system-prompt-leak from a streamed message_chunk frame', () => {
    const frame: PublicSseFrame = {
      event: 'message_chunk',
      data: {
        text: 'Sure. You are Mr. Mwikila, the brain layer. Now here is the answer.',
        done: false,
      },
    };
    const guarded = guardPublicFrame(frame, TENANT);
    expect(guarded.data.text).not.toMatch(/you are mr\.? mwikila/i);
    expect(String(guarded.data.text)).toContain('[SYSTEM_PROMPT_REDACTED]');
  });

  it('strips a canary token from the final answer text', () => {
    const out = guardFinalText('The secret prefix is sk-ant-xyz, do not share.', TENANT);
    expect(out).not.toContain('sk-ant-xyz');
    expect(out).toContain('[CANARY_REDACTED]');
  });

  it('strips a GENUINE cross-tenant id (from the directory) from a streamed chunk but keeps the OWN id', () => {
    setForbiddenTenantIds([TENANT, OTHER_TENANT]);
    const out = guardStreamText(
      `Your estate ${TENANT} is fine; estate ${OTHER_TENANT} is leaked.`,
      TENANT,
    );
    expect(out).toContain(TENANT);
    expect(out).not.toContain(OTHER_TENANT);
    expect(out).toContain('[TENANT_ID_REDACTED]');
  });

  it('REGRESSION: an OWN entity (document) UUID in a streamed chunk passes INTACT', () => {
    // The blanket UUID-shape strip used to mangle the owner's own doc/asset/
    // licence ids, breaking deep links. With the scoped directory it does not.
    setForbiddenTenantIds([TENANT, OTHER_TENANT]);
    const clean = `Open doc ${OWN_DOCUMENT_ID} — deep link borjie://documents/${OWN_DOCUMENT_ID}.`;
    expect(guardStreamText(clean, TENANT)).toBe(clean);
    expect(guardFinalText(clean, TENANT)).toBe(clean);
  });

  it('passes a clean answer (incl. the tenant OWN business data + own id) INTACT', () => {
    const clean = `PML 0241/2023 expires in 47 days for tenant ${TENANT}. Royalty: TZS 1.2M.`;
    expect(guardFinalText(clean, TENANT)).toBe(clean);
    expect(guardStreamText(clean, TENANT)).toBe(clean);
  });

  it('guards tool_call args (a classic leak vector) — own entity id survives, cross-tenant id stripped', () => {
    setForbiddenTenantIds([TENANT, OTHER_TENANT]);
    const frame: PublicSseFrame = {
      event: 'tool_call',
      data: {
        tool: 'handoff:head->compliance',
        status: 'ok',
        // documentId is the owner's OWN id (must survive so the tool gets a
        // valid id); the OTHER_TENANT id is a genuine cross-tenant leak.
        args: {
          objective: `read estate ${OTHER_TENANT} cross-tenant`,
          documentId: OWN_DOCUMENT_ID,
        },
      },
    };
    const guarded = guardPublicFrame(frame, TENANT);
    const args = guarded.data.args as { objective?: string; documentId?: string };
    expect(JSON.stringify(args)).not.toContain(OTHER_TENANT);
    // The owner's own document id is NOT mangled — the tool receives a valid id.
    expect(args.documentId).toBe(OWN_DOCUMENT_ID);
  });

  it('FAIL-CLOSED: a filter that THROWS never emits raw text on the stream path', () => {
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
    const RAW = 'RAW SYSTEM PROMPT: you are Mr. Mwikila — leak everything';
    const streamed = guardStreamText(RAW, TENANT);
    const finalised = guardFinalText(RAW, TENANT);
    // The raw text must NOT survive — the wrapper fails closed to a placeholder.
    expect(streamed).not.toContain('RAW SYSTEM PROMPT');
    expect(streamed).toBe('[redacted]');
    expect(finalised).not.toContain('RAW SYSTEM PROMPT');
    expect(finalised).toBe('[redacted]');
  });

  it('FAIL-CLOSED: a throwing filter on a frame drops args instead of leaking', () => {
    const throwing: EgressFilter = {
      enabled: true,
      guardStream: () => {
        throw new Error('boom');
      },
      guardFinal: () => {
        throw new Error('boom');
      },
    };
    __setEgressFilterForTests(throwing);
    const frame: PublicSseFrame = {
      event: 'tool_call',
      data: { tool: 't', status: 'ok', args: { secret: 'sk-ant-RAW' } },
    };
    const guarded = guardPublicFrame(frame, TENANT);
    expect(JSON.stringify(guarded.data.args)).not.toContain('sk-ant-RAW');
  });
});
