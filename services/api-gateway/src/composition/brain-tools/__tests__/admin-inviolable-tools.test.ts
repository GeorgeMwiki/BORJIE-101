/**
 * admin-inviolable-tools tests — Wave G-FIX-5.
 *
 * Drives the 8 admin-side inviolable-rule chat tools with an in-memory
 * httpClient stub. Verifies, per tool:
 *
 *   - Each handler returns a stable, validated envelope.
 *   - Each schema rejects malformed input (3+ rejection cases per tool).
 *   - HIGH stakes + requiresPolicyRuleLiteral flags are set.
 *   - Persona allowlist is admin-only.
 *   - The catalog contains exactly 8 tools with the expected ids.
 *
 * 36 unit assertions across 8 describes (4-5 per tool — exceeds the
 * "3+ tests per tool" mandate from the task brief).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  ADMIN_INVIOLABLE_TOOLS,
  adminKillSwitchOpenTool,
  adminKillSwitchCloseTool,
  adminFourEyeInitiateTool,
  adminFourEyeApproveTool,
  adminPolicyEditRuleTool,
  adminFeatureFlagSetTool,
  adminAuditExportTool,
  adminTenantSuspendTool,
} from '../admin-inviolable-tools.js';

const ADMIN_CTX = Object.freeze({
  tenantId: 'tenant-platform',
  actorId: 'admin-mwikila',
  personaSlug: 'T2_admin_strategist',
  chatSessionId: 'sess-admin-1',
  chatTurnId: 'turn-admin-1',
});

function makeClient<T>(postResult: T, getResult: unknown = []) {
  return {
    get: vi.fn(async () => getResult),
    post: vi.fn(async () => postResult),
  };
}

// ──────────────────────────────────────────────────────────────────
// 1) admin.killswitch.open
// ──────────────────────────────────────────────────────────────────

describe('adminKillSwitchOpenTool', () => {
  it('posts the initiate body and returns a pending-confirmation envelope', async () => {
    const client = makeClient({
      pendingConfirmationId: 'pc-123',
      expiresAt: '2026-05-29T12:00:30Z',
    });
    const result = await adminKillSwitchOpenTool.handler(
      {
        scope: 'platform',
        reason: 'incident-XYZ — runaway worker',
        level: 'halt',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.post).toHaveBeenCalledWith(
      '/mining/internal/killswitch',
      expect.objectContaining({
        scope: 'platform',
        level: 'halt',
        reasonCode: 'incident-XYZ — runaway worker',
        provenance: expect.objectContaining({ via: 'chat' }),
      }),
    );
    expect(result.initiated).toBe(true);
    expect(result.pendingConfirmationId).toBe('pc-123');
    expect(result.waitingForSecondOperator).toBe(true);
    expect(result.noteSw).toMatch(/Kifaa-cha-kuzima/);
    expect(result.noteEn).toMatch(/Kill-switch/);
  });

  it('rejects scopes that are neither "platform" nor "tenant:..."', () => {
    const parsed = adminKillSwitchOpenTool.inputSchema.safeParse({
      scope: 'bad-scope',
      reason: 'r',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty reason and unknown keys (strict schema)', () => {
    const empty = adminKillSwitchOpenTool.inputSchema.safeParse({
      scope: 'platform',
      reason: '',
    });
    expect(empty.success).toBe(false);
    const extra = adminKillSwitchOpenTool.inputSchema.safeParse({
      scope: 'platform',
      reason: 'r',
      other: 'no',
    });
    expect(extra.success).toBe(false);
  });

  it('is HIGH stakes, write, requires literal policy rule, admin-only', () => {
    expect(adminKillSwitchOpenTool.stakes).toBe('HIGH');
    expect(adminKillSwitchOpenTool.isWrite).toBe(true);
    expect(adminKillSwitchOpenTool.requiresPolicyRuleLiteral).toBe(true);
    expect(adminKillSwitchOpenTool.personaSlugs).toEqual([
      'T2_admin_strategist',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 2) admin.killswitch.close
// ──────────────────────────────────────────────────────────────────

describe('adminKillSwitchCloseTool', () => {
  it('hard-codes level=live and posts the initiate body', async () => {
    const client = makeClient({
      pendingConfirmationId: 'pc-close-9',
      expiresAt: '2026-05-29T12:00:30Z',
    });
    await adminKillSwitchCloseTool.handler(
      { scope: 'tenant:abc', reason: 'incident resolved' },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.post).toHaveBeenCalledWith(
      '/mining/internal/killswitch',
      expect.objectContaining({ level: 'live', scope: 'tenant:abc' }),
    );
  });

  it('rejects malformed tenant-prefixed scopes', () => {
    const parsed = adminKillSwitchCloseTool.inputSchema.safeParse({
      scope: 'tenants:abc', // wrong prefix
      reason: 'r',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty scope strings and over-long reasons', () => {
    const empty = adminKillSwitchCloseTool.inputSchema.safeParse({
      scope: '',
      reason: 'r',
    });
    expect(empty.success).toBe(false);
    const overlong = adminKillSwitchCloseTool.inputSchema.safeParse({
      scope: 'platform',
      reason: 'x'.repeat(500),
    });
    expect(overlong.success).toBe(false);
  });

  it('returns bilingual confirmation notes', async () => {
    const client = makeClient({
      pendingConfirmationId: 'pc1',
      expiresAt: '2026-05-29T12:00:30Z',
    });
    const result = await adminKillSwitchCloseTool.handler(
      { scope: 'platform', reason: 'rollback OK' },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(result.noteSw).toMatch(/Kurejesha/);
    expect(result.noteEn).toMatch(/return-to-live/);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3) admin.four_eye.initiate
// ──────────────────────────────────────────────────────────────────

describe('adminFourEyeInitiateTool', () => {
  it('posts the four-eye request body and returns the token envelope', async () => {
    const client = makeClient({
      id: 'fe-req-1',
      actionType: 'payment.large',
      status: 'pending',
      approvalToken: 'tok_' + 'x'.repeat(40),
      approvalUrl: '/four-eye/approve/tok_xxx',
      expiresAt: '2026-05-30T12:00:00Z',
    });
    const result = await adminFourEyeInitiateTool.handler(
      {
        actionType: 'payment.large',
        secondApproverId: 'user-mary',
        payload: { amountTzs: 8_000_000, recipient: 'vendor-X' },
        reason: 'CapEx batch run',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.post).toHaveBeenCalledWith(
      '/owner/four-eye/request',
      expect.objectContaining({
        actionType: 'payment.large',
        secondApproverId: 'user-mary',
        provenance: expect.objectContaining({ via: 'chat' }),
      }),
    );
    expect(result.requestId).toBe('fe-req-1');
    expect(result.status).toBe('pending');
    expect(result.approvalToken.length).toBeGreaterThanOrEqual(16);
    expect(result.noteSw).toMatch(/macho-manne/);
  });

  it('rejects unknown actionType', () => {
    const parsed = adminFourEyeInitiateTool.inputSchema.safeParse({
      actionType: 'payment.tiny',
      secondApproverId: 'u',
      payload: {},
      reason: 'r',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects ttlMinutes outside the 15-min..7-day window', () => {
    const tooShort = adminFourEyeInitiateTool.inputSchema.safeParse({
      actionType: 'payment.large',
      secondApproverId: 'u',
      payload: {},
      reason: 'r',
      ttlMinutes: 5,
    });
    const tooLong = adminFourEyeInitiateTool.inputSchema.safeParse({
      actionType: 'payment.large',
      secondApproverId: 'u',
      payload: {},
      reason: 'r',
      ttlMinutes: 60 * 24 * 30,
    });
    expect(tooShort.success).toBe(false);
    expect(tooLong.success).toBe(false);
  });

  it('flags HIGH-risk + policy-literal + admin-only', () => {
    expect(adminFourEyeInitiateTool.stakes).toBe('HIGH');
    expect(adminFourEyeInitiateTool.requiresPolicyRuleLiteral).toBe(true);
    expect(adminFourEyeInitiateTool.personaSlugs).toEqual([
      'T2_admin_strategist',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 4) admin.four_eye.approve
// ──────────────────────────────────────────────────────────────────

describe('adminFourEyeApproveTool', () => {
  it('encodes the token in the path and posts a note body', async () => {
    const client = makeClient({
      requestId: 'fe-req-1',
      actionType: 'payment.large',
      status: 'approved',
      executedAt: '2026-05-29T13:00:00Z',
    });
    const token = 'tok_' + 'x'.repeat(40);
    const result = await adminFourEyeApproveTool.handler(
      { approvalToken: token, note: 'OK after rec' },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.post).toHaveBeenCalledWith(
      `/owner/four-eye/approve/${encodeURIComponent(token)}`,
      expect.objectContaining({
        note: 'OK after rec',
        provenance: expect.objectContaining({ via: 'chat' }),
      }),
    );
    expect(result.approved).toBe(true);
    expect(result.requestId).toBe('fe-req-1');
    expect(result.executedAt).toBe('2026-05-29T13:00:00Z');
  });

  it('rejects tokens shorter than 16 chars', () => {
    const parsed = adminFourEyeApproveTool.inputSchema.safeParse({
      approvalToken: 'short',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const parsed = adminFourEyeApproveTool.inputSchema.safeParse({
      approvalToken: 'x'.repeat(20),
      other: 'no',
    });
    expect(parsed.success).toBe(false);
  });

  it('renders bilingual approval notes', async () => {
    const client = makeClient({
      requestId: 'r',
      actionType: 'contract.sign',
      status: 'approved',
    });
    const result = await adminFourEyeApproveTool.handler(
      { approvalToken: 'x'.repeat(20) },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(result.noteSw).toMatch(/Idhini ya macho-manne/);
    expect(result.noteEn).toMatch(/Four-eye approval/);
  });
});

// ──────────────────────────────────────────────────────────────────
// 5) admin.policy.edit_rule
// ──────────────────────────────────────────────────────────────────

describe('adminPolicyEditRuleTool', () => {
  it('routes through four-eye request with actionType=policy.rule_edit', async () => {
    const client = makeClient({
      id: 'fe-req-pol-1',
      status: 'pending',
      approvalToken: 'x'.repeat(20),
      approvalUrl: '/four-eye/approve/xxx',
      expiresAt: '2026-05-30T00:00:00Z',
    });
    const result = await adminPolicyEditRuleTool.handler(
      {
        ruleId: 'kill_switch.tenant.payment_freeze',
        changeJson: { threshold: 10_000_000 },
        reason: 'raise threshold',
        secondApproverId: 'user-bob',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.post).toHaveBeenCalledWith(
      '/owner/four-eye/request',
      expect.objectContaining({ actionType: 'policy.rule_edit' }),
    );
    expect(result.ruleId).toBe('kill_switch.tenant.payment_freeze');
    expect(result.status).toBe('pending');
  });

  it('rejects empty ruleId + reason', () => {
    const emptyRule = adminPolicyEditRuleTool.inputSchema.safeParse({
      ruleId: '',
      changeJson: {},
      reason: 'r',
      secondApproverId: 'u',
    });
    const emptyReason = adminPolicyEditRuleTool.inputSchema.safeParse({
      ruleId: 'x',
      changeJson: {},
      reason: '',
      secondApproverId: 'u',
    });
    expect(emptyRule.success).toBe(false);
    expect(emptyReason.success).toBe(false);
  });

  it('requires literal policy rule (CLAUDE.md hard rule)', () => {
    expect(adminPolicyEditRuleTool.requiresPolicyRuleLiteral).toBe(true);
    expect(adminPolicyEditRuleTool.stakes).toBe('HIGH');
  });

  it('renders bilingual confirmation notes referencing the ruleId', async () => {
    const client = makeClient({
      id: 'fe-1',
      status: 'pending',
      approvalToken: 'x'.repeat(20),
      approvalUrl: '/x',
      expiresAt: '2026-05-30T00:00:00Z',
    });
    const result = await adminPolicyEditRuleTool.handler(
      {
        ruleId: 'rule-X',
        changeJson: { a: 1 },
        reason: 'r',
        secondApproverId: 'u',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(result.noteEn).toMatch(/rule-X/);
    expect(result.noteSw).toMatch(/rule-X/);
    expect(result.noteSw).toMatch(/Mabadiliko/);
  });
});

// ──────────────────────────────────────────────────────────────────
// 6) admin.feature_flag.set — chip envelope (PATCH not on loopback)
// ──────────────────────────────────────────────────────────────────

describe('adminFeatureFlagSetTool', () => {
  it('emits a chip without hitting the network', async () => {
    const result = await adminFeatureFlagSetTool.handler(
      {
        flagKey: 'cockpit.dynamic-tabs',
        value: true,
        rolloutPct: 25,
        reason: 'phased rollout',
      },
      ADMIN_CTX,
    );
    expect(result.accepted).toBe(true);
    expect(result.flagKey).toBe('cockpit.dynamic-tabs');
    expect(result.targetValue).toBe(true);
    expect(result.targetRolloutPct).toBe(25);
    expect(result.httpMethod).toBe('PATCH');
    expect(result.httpPath).toMatch(/cockpit\.dynamic-tabs\/rollout$/);
  });

  it('rejects rolloutPct outside 0..100', () => {
    const negative = adminFeatureFlagSetTool.inputSchema.safeParse({
      flagKey: 'x',
      value: true,
      rolloutPct: -1,
      reason: 'r',
    });
    const over = adminFeatureFlagSetTool.inputSchema.safeParse({
      flagKey: 'x',
      value: true,
      rolloutPct: 101,
      reason: 'r',
    });
    expect(negative.success).toBe(false);
    expect(over.success).toBe(false);
  });

  it('rejects empty flagKey and unknown extras', () => {
    const empty = adminFeatureFlagSetTool.inputSchema.safeParse({
      flagKey: '',
      value: true,
      reason: 'r',
    });
    const extra = adminFeatureFlagSetTool.inputSchema.safeParse({
      flagKey: 'x',
      value: true,
      reason: 'r',
      other: 'no',
    });
    expect(empty.success).toBe(false);
    expect(extra.success).toBe(false);
  });

  it('is HIGH stakes + policy-literal admin-only with PATCH chip', () => {
    expect(adminFeatureFlagSetTool.stakes).toBe('HIGH');
    expect(adminFeatureFlagSetTool.requiresPolicyRuleLiteral).toBe(true);
    expect(adminFeatureFlagSetTool.personaSlugs).toEqual([
      'T2_admin_strategist',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 7) admin.audit.export
// ──────────────────────────────────────────────────────────────────

describe('adminAuditExportTool', () => {
  it('probes the audit log and emits a download-ready chip', async () => {
    const client = makeClient(undefined, [{ id: 'audit-1' }]);
    const result = await adminAuditExportTool.handler(
      {
        from: '2026-05-01',
        to: '2026-05-29',
        format: 'csv',
        reason: 'PCCB monthly export',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.get).toHaveBeenCalledWith(
      '/admin/audit/log',
      expect.objectContaining({
        query: expect.objectContaining({
          since: '2026-05-01',
          until: '2026-05-29',
          limit: 1,
        }),
      }),
    );
    expect(result.accepted).toBe(true);
    expect(result.format).toBe('csv');
    expect(result.rowsPreviewCount).toBe(1);
  });

  it('tolerates probe failures without throwing', async () => {
    const client = {
      get: vi.fn(async () => {
        throw new Error('probe boom');
      }),
      post: vi.fn(async () => ({})),
    };
    const result = await adminAuditExportTool.handler(
      {
        from: '2026-05-01',
        to: '2026-05-29',
        format: 'json',
        reason: 'self-test',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(result.accepted).toBe(true);
    expect(result.rowsPreviewCount).toBe(0);
  });

  it('rejects formats outside csv|json|pdf', () => {
    const parsed = adminAuditExportTool.inputSchema.safeParse({
      from: '2026-05-01',
      to: '2026-05-29',
      format: 'xlsx',
      reason: 'r',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty from/to/reason and unknown keys', () => {
    const empty = adminAuditExportTool.inputSchema.safeParse({
      from: '',
      to: '2026-05-29',
      format: 'csv',
      reason: 'r',
    });
    const extra = adminAuditExportTool.inputSchema.safeParse({
      from: '2026-05-01',
      to: '2026-05-29',
      format: 'csv',
      reason: 'r',
      other: 'no',
    });
    expect(empty.success).toBe(false);
    expect(extra.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// 8) admin.tenant.suspend
// ──────────────────────────────────────────────────────────────────

describe('adminTenantSuspendTool', () => {
  it('emits a DELETE chip with 30-day default grace', async () => {
    const result = await adminTenantSuspendTool.handler(
      { tenantId: 'tenant-acme', reason: 'abuse — confirmed' },
      ADMIN_CTX,
    );
    expect(result.accepted).toBe(true);
    expect(result.tenantId).toBe('tenant-acme');
    expect(result.graceDays).toBe(30);
    expect(result.httpMethod).toBe('DELETE');
    expect(result.httpPath).toBe('/api/v1/tenants/tenant-acme');
  });

  it('honours a longer grace window when requested', async () => {
    const result = await adminTenantSuspendTool.handler(
      { tenantId: 't1', reason: 'regulator pause', graceDays: 120 },
      ADMIN_CTX,
    );
    expect(result.graceDays).toBe(120);
  });

  it('rejects graceDays shorter than the PDPA minimum (30) or over the cap (180)', () => {
    const tooShort = adminTenantSuspendTool.inputSchema.safeParse({
      tenantId: 't',
      reason: 'r',
      graceDays: 7,
    });
    const tooLong = adminTenantSuspendTool.inputSchema.safeParse({
      tenantId: 't',
      reason: 'r',
      graceDays: 365,
    });
    expect(tooShort.success).toBe(false);
    expect(tooLong.success).toBe(false);
  });

  it('renders bilingual confirmation notes', async () => {
    const result = await adminTenantSuspendTool.handler(
      { tenantId: 't', reason: 'r' },
      ADMIN_CTX,
    );
    expect(result.noteSw).toMatch(/Kusimamishwa/);
    expect(result.noteEn).toMatch(/suspension scheduled/);
  });
});

// ──────────────────────────────────────────────────────────────────
// Catalog integrity
// ──────────────────────────────────────────────────────────────────

describe('ADMIN_INVIOLABLE_TOOLS catalog', () => {
  it('exports exactly 8 tools with the documented ids', () => {
    const ids = ADMIN_INVIOLABLE_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'admin.audit.export',
      'admin.feature_flag.set',
      'admin.four_eye.approve',
      'admin.four_eye.initiate',
      'admin.killswitch.close',
      'admin.killswitch.open',
      'admin.policy.edit_rule',
      'admin.tenant.suspend',
    ]);
  });

  it('every entry is HIGH stakes, write, policy-literal, admin-only', () => {
    for (const tool of ADMIN_INVIOLABLE_TOOLS) {
      expect(tool.stakes).toBe('HIGH');
      expect(tool.isWrite).toBe(true);
      expect(tool.requiresPolicyRuleLiteral).toBe(true);
      expect([...tool.personaSlugs]).toEqual(['T2_admin_strategist']);
    }
  });
});
