/**
 * admin-superpowers-tools tests — four-eye QUEUE brain tools (ported from
 * BossNyumba 0301, retargeted real-estate → mining).
 *
 * Drives the 4 admin superpowers queue tools with an in-memory httpClient
 * stub. Verifies, per tool:
 *
 *   - The handler posts the right body / path and returns a validated envelope.
 *   - The schema rejects malformed input (strict — unknown keys rejected).
 *   - HIGH stakes + requiresPolicyRuleLiteral + admin-only allowlist.
 *   - The same-actor 409 surfaces as a thrown handler error (the route maps it).
 *   - The catalog contains exactly 4 tools with the expected ids.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  ADMIN_SUPERPOWERS_TOOLS,
  adminBulkActionTool,
  adminApproveTool,
  adminRejectTool,
  adminListPendingTool,
} from '../admin-superpowers-tools.js';

const ADMIN_CTX = Object.freeze({
  tenantId: 'tenant-platform',
  actorId: 'admin-mwikila',
  personaSlug: 'T2_admin_strategist',
  chatSessionId: 'sess-admin-1',
  chatTurnId: 'turn-admin-1',
});

function makeClient<T>(postResult: T, getResult: unknown = { data: {} }) {
  return {
    get: vi.fn(async () => getResult),
    post: vi.fn(async () => postResult),
  };
}

// ──────────────────────────────────────────────────────────────────
// 1) admin.superpowers.bulk_action
// ──────────────────────────────────────────────────────────────────

describe('adminBulkActionTool', () => {
  it('posts the bulk-action body and returns a pending envelope for a HIGH verb', async () => {
    const client = makeClient({
      data: {
        accepted: true,
        requiresFourEye: true,
        status: 'pending_approval',
        processed: 1,
        failed: 0,
        undoJournalIds: ['j-1'],
        pendingApprovalIds: ['p-1'],
      },
    });
    const result = await adminBulkActionTool.handler(
      {
        entityType: 'licence_holder',
        ids: ['lh-acme'],
        action: 'suspend_licence_holder',
        reason: 'sanctioned-entity-list-match-2026',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.post).toHaveBeenCalledWith(
      '/admin/superpowers/bulk-action',
      expect.objectContaining({
        entityType: 'licence_holder',
        action: 'suspend_licence_holder',
        provenance: expect.objectContaining({ via: 'chat' }),
      }),
    );
    expect(result.requiresFourEye).toBe(true);
    expect(result.status).toBe('pending_approval');
    expect(result.pendingApprovalIds).toEqual(['p-1']);
  });

  it('returns an applied envelope for a MEDIUM verb', async () => {
    const client = makeClient({
      data: {
        accepted: true,
        requiresFourEye: false,
        status: 'applied',
        processed: 2,
        failed: 0,
        undoJournalIds: ['j-1', 'j-2'],
        pendingApprovalIds: [],
      },
    });
    const result = await adminBulkActionTool.handler(
      {
        entityType: 'site',
        ids: ['site-a', 'site-b'],
        action: 'bulk_re_tag_sites',
        reason: 'taxonomy-reorg-2026Q2',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(result.requiresFourEye).toBe(false);
    expect(result.status).toBe('applied');
    expect(result.pendingApprovalIds).toEqual([]);
  });

  it('rejects an unknown entityType / unknown keys (strict schema)', () => {
    const badEntity = adminBulkActionTool.inputSchema.safeParse({
      entityType: 'tenant_org',
      ids: ['x'],
      action: 'suspend_licence_holder',
      reason: 'long-enough-reason',
    });
    const extra = adminBulkActionTool.inputSchema.safeParse({
      entityType: 'licence_holder',
      ids: ['x'],
      action: 'suspend_licence_holder',
      reason: 'long-enough-reason',
      other: 'no',
    });
    expect(badEntity.success).toBe(false);
    expect(extra.success).toBe(false);
  });

  it('rejects a too-short reason and an empty id list', () => {
    const shortReason = adminBulkActionTool.inputSchema.safeParse({
      entityType: 'licence_holder',
      ids: ['x'],
      action: 'suspend_licence_holder',
      reason: 'oops',
    });
    const emptyIds = adminBulkActionTool.inputSchema.safeParse({
      entityType: 'licence_holder',
      ids: [],
      action: 'suspend_licence_holder',
      reason: 'long-enough-reason',
    });
    expect(shortReason.success).toBe(false);
    expect(emptyIds.success).toBe(false);
  });

  it('is HIGH stakes, write, policy-literal, admin-only', () => {
    expect(adminBulkActionTool.stakes).toBe('HIGH');
    expect(adminBulkActionTool.isWrite).toBe(true);
    expect(adminBulkActionTool.requiresPolicyRuleLiteral).toBe(true);
    expect([...adminBulkActionTool.personaSlugs]).toEqual([
      'T2_admin_strategist',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 2) admin.superpowers.approve
// ──────────────────────────────────────────────────────────────────

describe('adminApproveTool', () => {
  it('encodes the journalId in the path and returns the applied envelope', async () => {
    const client = makeClient({
      data: {
        applied: true,
        journalId: 'j-1',
        pendingId: 'p-1',
        action: 'suspend_licence_holder',
        targetEntityRef: 'licence_holder:lh-acme',
        approvedAt: '2026-06-05T10:00:00Z',
      },
    });
    const result = await adminApproveTool.handler(
      { journalId: 'j-1', decisionNote: 'verified out of band' },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.post).toHaveBeenCalledWith(
      '/admin/superpowers/approve/j-1',
      expect.objectContaining({
        decisionNote: 'verified out of band',
        provenance: expect.objectContaining({ via: 'chat' }),
      }),
    );
    expect(result.applied).toBe(true);
    expect(result.targetEntityRef).toBe('licence_holder:lh-acme');
  });

  it('surfaces the same-actor 409 as a thrown handler error', async () => {
    const client = {
      get: vi.fn(async () => ({ data: {} })),
      post: vi.fn(async () => {
        throw new Error(
          'persona-tool loopback POST /admin/superpowers/approve/j-1 → 409',
        );
      }),
    };
    await expect(
      adminApproveTool.handler(
        { journalId: 'j-1' },
        { ...ADMIN_CTX, httpClient: client },
      ),
    ).rejects.toThrow(/409/);
  });

  it('rejects empty journalId + unknown keys', () => {
    const empty = adminApproveTool.inputSchema.safeParse({ journalId: '' });
    const extra = adminApproveTool.inputSchema.safeParse({
      journalId: 'j',
      other: 'no',
    });
    expect(empty.success).toBe(false);
    expect(extra.success).toBe(false);
  });

  it('is HIGH stakes, write, policy-literal, admin-only', () => {
    expect(adminApproveTool.stakes).toBe('HIGH');
    expect(adminApproveTool.requiresPolicyRuleLiteral).toBe(true);
    expect([...adminApproveTool.personaSlugs]).toEqual([
      'T2_admin_strategist',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3) admin.superpowers.reject
// ──────────────────────────────────────────────────────────────────

describe('adminRejectTool', () => {
  it('posts the rejection reason and returns the rejected envelope', async () => {
    const client = makeClient({
      data: { rejected: true, journalId: 'j-1', pendingId: 'p-1' },
    });
    const result = await adminRejectTool.handler(
      {
        journalId: 'j-1',
        rejectionReason: 'hold-until-regulator-confirms',
      },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.post).toHaveBeenCalledWith(
      '/admin/superpowers/reject/j-1',
      expect.objectContaining({
        rejectionReason: 'hold-until-regulator-confirms',
        provenance: expect.objectContaining({ via: 'chat' }),
      }),
    );
    expect(result.rejected).toBe(true);
    expect(result.pendingId).toBe('p-1');
  });

  it('rejects a too-short rejection reason', () => {
    const parsed = adminRejectTool.inputSchema.safeParse({
      journalId: 'j-1',
      rejectionReason: 'no',
    });
    expect(parsed.success).toBe(false);
  });

  it('is HIGH stakes + policy-literal admin-only', () => {
    expect(adminRejectTool.stakes).toBe('HIGH');
    expect(adminRejectTool.requiresPolicyRuleLiteral).toBe(true);
    expect([...adminRejectTool.personaSlugs]).toEqual([
      'T2_admin_strategist',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 4) admin.superpowers.list_pending
// ──────────────────────────────────────────────────────────────────

describe('adminListPendingTool', () => {
  it('reads the pending queue with the default status', async () => {
    const client = makeClient(undefined, {
      data: {
        status: 'pending',
        count: 1,
        rows: [{ id: 'p-1', action: 'suspend_licence_holder' }],
      },
    });
    const result = await adminListPendingTool.handler(
      { status: 'pending', limit: 50 },
      { ...ADMIN_CTX, httpClient: client },
    );
    expect(client.get).toHaveBeenCalledWith(
      '/admin/superpowers/pending',
      expect.objectContaining({
        query: expect.objectContaining({ status: 'pending', limit: 50 }),
      }),
    );
    expect(result.count).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it('degrades to an empty queue when no httpClient is bound', async () => {
    const result = await adminListPendingTool.handler(
      { status: 'pending', limit: 50 },
      ADMIN_CTX,
    );
    expect(result.count).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('rejects a status outside the lifecycle enum', () => {
    const parsed = adminListPendingTool.inputSchema.safeParse({
      status: 'archived',
    });
    expect(parsed.success).toBe(false);
  });

  it('is READ-ONLY (LOW stakes, not a write) but still policy-literal admin-only', () => {
    expect(adminListPendingTool.stakes).toBe('LOW');
    expect(adminListPendingTool.isWrite).toBe(false);
    expect(adminListPendingTool.requiresPolicyRuleLiteral).toBe(true);
    expect([...adminListPendingTool.personaSlugs]).toEqual([
      'T2_admin_strategist',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// Catalog integrity
// ──────────────────────────────────────────────────────────────────

describe('ADMIN_SUPERPOWERS_TOOLS catalog', () => {
  it('exports exactly 4 tools with the documented ids', () => {
    const ids = ADMIN_SUPERPOWERS_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'admin.superpowers.approve',
      'admin.superpowers.bulk_action',
      'admin.superpowers.list_pending',
      'admin.superpowers.reject',
    ]);
  });

  it('every entry is policy-literal + admin-only', () => {
    for (const tool of ADMIN_SUPERPOWERS_TOOLS) {
      expect(tool.requiresPolicyRuleLiteral).toBe(true);
      expect([...tool.personaSlugs]).toEqual(['T2_admin_strategist']);
    }
  });
});
