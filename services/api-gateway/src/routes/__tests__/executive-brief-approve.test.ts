/**
 * /api/v1/briefs/:id/actions/:idx/approve — W2c producer tests.
 *
 * The approve handler is the SOLE producer for the Piece E executor queue
 * (`executive_brief_actions`), drained by
 * `services/api-gateway/src/workers/executive-brief-action-runner.ts`.
 *
 * Asserts:
 *   - the pure projection `deriveBriefActionQueueRow` derives
 *     junior_name / intent / payload GENERICALLY from a RecommendedAction
 *     (+ ApprovalPacket) — no per-action hardcoding.
 *   - approving a brief action inserts EXACTLY ONE `status='approved'` row
 *     into executive_brief_actions carrying the derived intent + payload.
 *   - 404 when the brief is unknown; 400 when the action index is OOB.
 *   - auth is required.
 *
 * The runner-side drain (consumer) has its own coverage; this file owns the
 * producer half of the create→approve→execute bridge.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// Pin the JWT secret BEFORE importing the router so all middlewares that
// capture the secret at module init agree. Mirrors pilot-feedback.test.ts.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  executiveBriefRouter,
  deriveBriefActionQueueRow,
} from '../executive-brief.hono.js';
import { generateToken } from '../../middleware/auth.js';
import { UserRole } from '../../types/user-role.js';

// ─────────────────────────────────────────────────────────────────────
// Drizzle `sql` reconstruction — recover the SQL skeleton (with `?`
// placeholders) and the ordered bound values from a query's queryChunks.
// ─────────────────────────────────────────────────────────────────────

interface ReconstructedQuery {
  readonly text: string;
  readonly values: ReadonlyArray<unknown>;
}

function reconstruct(query: unknown): ReconstructedQuery {
  const chunks =
    (query as { queryChunks?: ReadonlyArray<unknown> } | null)?.queryChunks ?? [];
  const values: unknown[] = [];
  let text = '';
  for (const ch of chunks) {
    const name =
      ch && (ch as { constructor?: { name?: string } }).constructor?.name;
    if (name === 'StringChunk') {
      const v = (ch as { value?: unknown }).value;
      text += Array.isArray(v) ? v.join('') : String(v);
    } else if (ch && typeof ch === 'object' && 'value' in ch) {
      values.push((ch as { value: unknown }).value);
      text += '?';
    } else {
      values.push(ch);
      text += '?';
    }
  }
  return { text, values };
}

// ─────────────────────────────────────────────────────────────────────
// Stub db — routes by reconstructed SQL; records every execute() call.
// ─────────────────────────────────────────────────────────────────────

interface ExecCall extends ReconstructedQuery {}

function makeStubDb(briefRow: Record<string, unknown> | null) {
  const calls: ExecCall[] = [];
  const db = {
    calls,
    async execute(query: unknown) {
      const r = reconstruct(query);
      calls.push(r);
      // SELECT the brief.
      if (/FROM executive_briefs/i.test(r.text) && /SELECT/i.test(r.text)) {
        return { rows: briefRow ? [briefRow] : [] };
      }
      // INSERT into the executor queue — echo back the id (last value
      // before status/attempts is the first bound param: the row id).
      if (/INSERT INTO executive_brief_actions/i.test(r.text)) {
        return { rows: [{ id: r.values[0] }] };
      }
      // UPDATE brief status / RLS GUC bind / anything else.
      return { rows: [] };
    },
  };
  return db;
}

function bearer(role: UserRole): string {
  return `Bearer ${generateToken({
    userId: 'usr-test',
    tenantId: 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(db: ReturnType<typeof makeStubDb> | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (db) {
      // @ts-expect-error — `db` slot is augmented by the database middleware.
      c.set('db', db);
    }
    await next();
  });
  app.route('/api/v1/briefs', executiveBriefRouter);
  return app;
}

// A representative RecommendedAction + ApprovalPacket (the real
// @borjie/executive-brief-engine shape).
const ACTION = {
  title: 'Open arrears follow-up: ABC Pit royalty in arrears',
  targetModule: 'FINANCE',
  action: 'open_arrears_follow_up',
  payload: { hypothesis_kind: 'risk', severity: 'HIGH', overdue_count: 4 },
  confidence: 0.7,
  requiresApproval: true,
  citationIndices: [0],
};

const PACKET = {
  actionIndex: 0,
  policyId: 'finance.arrears.followup',
  requiredApprovers: [{ powerTier: 2, scope: 'tenant' }],
  payload: { rendered: 'Approve arrears follow-up for ABC Pit' },
};

function briefRowWith(
  actions: ReadonlyArray<Record<string, unknown>>,
  packets: ReadonlyArray<Record<string, unknown>>,
) {
  return {
    id: 'brf-1',
    recommended_actions_jsonb: actions,
    approval_packets_jsonb: packets,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pure projection — GENERIC derivation, no per-action hardcoding.
// ─────────────────────────────────────────────────────────────────────

describe('deriveBriefActionQueueRow — generic projection', () => {
  it('derives intent from the action slug and junior from the targetModule', () => {
    const row = deriveBriefActionQueueRow({
      briefId: 'brf-1',
      tenantId: 'tnt-test',
      actionIndex: 0,
      action: ACTION,
      packet: PACKET,
    });
    expect(row.intent).toBe('open_arrears_follow_up');
    expect(row.juniorName).toBe('finance-agent');
    expect(row.id.startsWith('eba_')).toBe(true);
    // payload carries the action payload, the packet payload, and provenance.
    expect(row.payload.overdue_count).toBe(4);
    expect(row.payload.rendered).toBe('Approve arrears follow-up for ABC Pit');
    expect(row.payload.brief_id).toBe('brf-1');
    expect(row.payload.action_index).toBe(0);
    expect(row.payload.action_slug).toBe('open_arrears_follow_up');
    expect(row.payload.target_module).toBe('FINANCE');
    expect(row.payload.policy_id).toBe('finance.arrears.followup');
  });

  it('prefers an explicit junior hint over the module-derived name', () => {
    const row = deriveBriefActionQueueRow({
      briefId: 'brf-1',
      tenantId: 'tnt-test',
      actionIndex: 1,
      action: {
        ...ACTION,
        payload: { ...ACTION.payload, junior_name: 'Compliance Agent' },
      },
      packet: undefined,
    });
    // slugified explicit hint wins.
    expect(row.juniorName).toBe('compliance-agent');
  });

  it('falls back to a title-slug intent + master-brain when slugs are absent', () => {
    const row = deriveBriefActionQueueRow({
      briefId: 'brf-1',
      tenantId: 'tnt-test',
      actionIndex: 0,
      action: { title: 'Review Something Important' },
      packet: undefined,
    });
    expect(row.intent).toBe('review-something-important');
    expect(row.juniorName).toBe('master-brain');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Route — the producer half of the bridge.
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/briefs/:id/actions/:idx/approve — auth', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('returns 401 without a bearer token', async () => {
    const app = mount(makeStubDb(briefRowWith([ACTION], [PACKET])));
    const res = await app.request('/api/v1/briefs/brf-1/actions/0/approve', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/briefs/:id/actions/:idx/approve — producer', () => {
  it('inserts exactly one approved row carrying the derived intent + payload', async () => {
    const db = makeStubDb(briefRowWith([ACTION], [PACKET]));
    const app = mount(db);

    const res = await app.request('/api/v1/briefs/brf-1/actions/0/approve', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { status: string; juniorName: string; intent: string; actionId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('queued');
    expect(body.data.intent).toBe('open_arrears_follow_up');
    expect(body.data.juniorName).toBe('finance-agent');

    // EXACTLY ONE insert into the executor queue.
    const inserts = db.calls.filter((c) =>
      /INSERT INTO executive_brief_actions/i.test(c.text),
    );
    expect(inserts).toHaveLength(1);

    const insert = inserts[0];
    // It enqueues at status='approved' (literal in the SQL text).
    expect(insert.text).toMatch(/'approved'/);
    // The bound values carry the derived intent + junior + payload JSON.
    expect(insert.values).toContain('open_arrears_follow_up');
    expect(insert.values).toContain('finance-agent');
    const payloadJson = insert.values.find(
      (v): v is string => typeof v === 'string' && v.startsWith('{') && v.includes('action_slug'),
    );
    expect(payloadJson).toBeDefined();
    const parsed = JSON.parse(payloadJson as string) as Record<string, unknown>;
    expect(parsed.action_slug).toBe('open_arrears_follow_up');
    expect(parsed.brief_id).toBe('brf-1');
    expect(parsed.overdue_count).toBe(4);
  });

  it('returns 404 when the brief does not exist', async () => {
    const db = makeStubDb(null);
    const app = mount(db);
    const res = await app.request('/api/v1/briefs/missing/actions/0/approve', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });
    expect(res.status).toBe(404);
    const inserts = db.calls.filter((c) =>
      /INSERT INTO executive_brief_actions/i.test(c.text),
    );
    expect(inserts).toHaveLength(0);
  });

  it('returns 400 when the action index is out of range', async () => {
    const db = makeStubDb(briefRowWith([ACTION], [PACKET]));
    const app = mount(db);
    const res = await app.request('/api/v1/briefs/brf-1/actions/9/approve', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });
    expect(res.status).toBe(400);
    const inserts = db.calls.filter((c) =>
      /INSERT INTO executive_brief_actions/i.test(c.text),
    );
    expect(inserts).toHaveLength(0);
  });
});
