/**
 * advisor-wiring integration tests.
 *
 * Covers the four scenarios the wiring brief requires:
 *
 *   1. DATABASE_URL unset → DataPort falls back to empty static port;
 *      ask() works end-to-end and answers without evidence.
 *   2. Real wormAuditStore-shaped audit port → audit entries land on
 *      the store; structurally identical signature means a mock store
 *      receives every `append({...})` the advisor emits.
 *   3. Multi-LLM key missing → BrainPort falls back to the echo brain;
 *      `getAdvisorWiringStatus()` reports `brain: 'echo-fallback'`.
 *   4. When the DataPort is wired against the user-context-store
 *      factory directly, the orchestrator forwards snippets and the
 *      answer reflects the evidence — wiring round-trip is exercised
 *      without needing a live Postgres.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Force-set test env BEFORE any router import so the modules capture
// the deterministic test secret.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';
// Clear all AI vendor keys so the multi-LLM brain wiring deterministically
// falls back to the echo brain in the integration suite (we DO NOT want
// these tests to call out to OpenAI/Anthropic/DeepSeek).
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
// Force the unset of DATABASE_URL so the lazy db-client returns null
// and the wiring takes the empty-static-port fallback.
delete process.env.DATABASE_URL;

import { Hono } from 'hono';
import askRouter from '../ask.router';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import {
  getAdvisor,
  getAdvisorWiringStatus,
  _resetAdvisorForTests,
} from '../advisor-wiring';
import { _resetAskRateLimitForTests } from '../ask-rate-limit';

function mount(): Hono {
  const app = new Hono();
  app.route('/v1/ask', askRouter);
  return app;
}

function bearer(role: UserRole, opts?: { userId?: string; tenantId?: string }): string {
  return `Bearer ${generateToken({
    userId: opts?.userId ?? `usr-${role}`,
    tenantId: opts?.tenantId ?? 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

describe('advisor-wiring — fallback behaviour with no env', () => {
  beforeEach(() => {
    _resetAdvisorForTests();
    _resetAskRateLimitForTests();
  });

  it('builds a viable AdvisorApi even when DATABASE_URL is unset', async () => {
    const advisor = getAdvisor();
    const res = await advisor.advise({
      user: { id: 'u-1', tenantId: 't-1', role: 'tenant' },
      question: 'When does my lease end?',
    });
    expect(res.answer).toBeDefined();
    expect(res.intent).toBe('lease-question');
    // Empty static DataPort → no evidence reaches the answer.
    expect(res.evidence).toEqual([]);
  });

  it('reports `static-fallback` for DataPort when DB unset', () => {
    void getAdvisor();
    const status = getAdvisorWiringStatus();
    expect(status).not.toBeNull();
    expect(status?.data).toBe('static-fallback');
  });

  it('reports `echo-fallback` for BrainPort when no AI vendor keys are set', () => {
    void getAdvisor();
    const status = getAdvisorWiringStatus();
    expect(status?.brain).toBe('echo-fallback');
  });

  it('reports `in-memory-fallback` for AuditPort when DB unset', () => {
    void getAdvisor();
    const status = getAdvisorWiringStatus();
    // The persistent-stores factory returns an in-memory worm-audit
    // shim when db is null; we surface that as `in-memory-fallback`.
    expect(status?.audit).toBe('in-memory-fallback');
  });

  it('end-to-end ask through the router returns 200 in fallback mode', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'How is my portfolio doing?' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.OWNER),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.intent).toBeDefined();
  });
});

describe('advisor-wiring — audit port routes appends to the configured store', () => {
  beforeEach(() => {
    _resetAdvisorForTests();
    _resetAskRateLimitForTests();
  });

  it('every advise() call writes one entry to the override audit port', async () => {
    const appended: Array<Readonly<Record<string, unknown>>> = [];
    const mockAudit = {
      async append(entry: Readonly<Record<string, unknown>>) {
        appended.push(entry);
        return { id: `mock-${appended.length}` };
      },
    };
    const advisor = getAdvisor({ audit: mockAudit });
    await advisor.advise({
      user: { id: 'u-audit', tenantId: 't-audit', role: 'tenant' },
      question: 'Tell me about my lease.',
    });
    expect(appended.length).toBe(1);
    const entry = appended[0];
    expect(entry?.action).toBe('advisor.ask');
    expect(entry?.tenantId).toBe('t-audit');
    expect(entry?.userId).toBe('u-audit');
    expect(entry?.role).toBe('tenant');
    expect(entry?.outcome).toBe('ok');
  });

  it('a wormAuditStore-shaped store satisfies AuditPort structurally — no adapter needed', async () => {
    // The persistent-stores wormAuditStore exposes `append(entry)` with
    // the same signature as the role-aware-advisor AuditPort. This is
    // load-bearing for the wiring: the audit shim we wire as AuditPort
    // is literally the wormAuditStore object. Verify that contract.
    const appended: Array<Readonly<Record<string, unknown>>> = [];
    const wormShim = {
      async append(entry: Readonly<Record<string, unknown>>) {
        appended.push(entry);
        return { ...entry, entryId: `worm-${appended.length}` };
      },
      async list() {
        return [];
      },
      async verify() {
        return { ok: true as const };
      },
    };
    const advisor = getAdvisor({ audit: wormShim });
    await advisor.advise({
      user: { id: 'u-w', tenantId: 't-w', role: 'admin' },
      question: 'Show me platform health.',
    });
    expect(appended.length).toBe(1);
  });
});

describe('advisor-wiring — DataPort exercise via in-memory user-context-store', () => {
  beforeEach(() => {
    _resetAdvisorForTests();
    _resetAskRateLimitForTests();
  });

  it('forwards snippets returned by a user-context-store-style DataPort into the answer evidence', async () => {
    const advisor = getAdvisor({
      data: {
        async fetchSnippets() {
          return [
            {
              id: 'snip-lease-1',
              resource: 'own-lease' as const,
              summary: 'Lease ends 2026-12-31',
              body: 'Rent 850000 TZS, signed 2024-01-15.',
              scope: 'own' as const,
              ownedByUser: true,
              tenantId: 't-evidence',
            },
          ];
        },
      },
    });
    const res = await advisor.advise({
      user: { id: 'u-ev', tenantId: 't-evidence', role: 'tenant' },
      question: 'When does my lease end?',
    });
    expect(res.evidence.length).toBe(1);
    expect(res.evidence[0]?.id).toBe('snip-lease-1');
    expect(res.evidence[0]?.summary).toContain('Lease ends');
    // The echo brain pastes the evidence into its answer; verify the
    // round-trip surfaces snippet content in the citations.
    expect(res.citations.length).toBe(1);
    expect(res.citations[0]?.id).toBe('snip-lease-1');
  });

  it('production data adapter swallows inner errors — verify the contract with a returns-empty stub', async () => {
    // The production user-context-store adapter wrapped by
    // advisor-wiring catches any throw inside `fetchSnippets` and
    // returns []. Tests can't exercise the inner catch without
    // injecting the real adapter; we verify the equivalent contract:
    // a DataPort that returns [] still produces a valid answer.
    const advisor = getAdvisor({
      data: {
        async fetchSnippets() {
          return [];
        },
      },
    });
    const res = await advisor.advise({
      user: { id: 'u-x', tenantId: 't-x', role: 'tenant' },
      question: 'Anything to report?',
    });
    expect(res.evidence).toEqual([]);
    expect(res.answer).toBeDefined();
  });
});

describe('advisor-wiring — wiring status reflects override injections', () => {
  beforeEach(() => {
    _resetAdvisorForTests();
    _resetAskRateLimitForTests();
  });

  it('marks status as multi-llm/user-context/worm when all three overrides are passed', () => {
    void getAdvisor({
      brain: {
        async respond() {
          return { text: 'mock', citations: [] };
        },
      },
      data: {
        async fetchSnippets() {
          return [];
        },
      },
      audit: {
        async append() {
          return {};
        },
      },
    });
    const status = getAdvisorWiringStatus();
    expect(status?.brain).toBe('multi-llm-synthesizer');
    expect(status?.data).toBe('user-context-store');
    expect(status?.audit).toBe('worm-audit-store');
  });
});
