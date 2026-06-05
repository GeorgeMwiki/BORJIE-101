/**
 * org-admin-tools — descriptor metadata + http-client wiring (migration 0280).
 *
 * Verifies the 5 staff.* chat tools (ported from the BN org/team-management
 * stack, retargeted real-estate → mining) wrap their REAL `/org-admin/*`
 * gateway routes correctly, that provenance is injected on every WRITE, that
 * persona scoping enforces the owner/admin boundary, mining vocab is honoured,
 * and the httpClient-unavailable path degrades honestly (no fabricated data).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  ORG_ADMIN_TOOLS,
  staffCreateTool,
  staffAssignKpiTool,
  staffScheduleTaskTool,
  staffEscalateToHumanTool,
  staffBulkIngestCsvTool,
} from '../org-admin-tools';
import type { PersonaToolHandlerContext } from '../types';

function makeOwnerCtx(client: {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}): PersonaToolHandlerContext {
  return {
    tenantId: '00000000-0000-0000-0000-000000000000',
    actorId: 'owner-1',
    personaSlug: 'T1_owner_strategist',
    chatSessionId: 'session-xyz',
    chatTurnId: 'turn-7',
    httpClient: client as unknown as PersonaToolHandlerContext['httpClient'],
  };
}

const noClientCtx = {
  tenantId: 'tenant-1',
  actorId: 'owner-1',
  personaSlug: 'T1_owner_strategist',
} as PersonaToolHandlerContext;

describe('ORG_ADMIN_TOOLS catalog', () => {
  it('exports exactly 5 descriptors', () => {
    expect(ORG_ADMIN_TOOLS).toHaveLength(5);
  });

  it('includes the five staff tool ids', () => {
    const ids = ORG_ADMIN_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'staff.assign_kpi',
      'staff.bulk_ingest_csv',
      'staff.create',
      'staff.escalate_to_human',
      'staff.schedule_task',
    ]);
  });

  it('every tool is owner/admin-scoped, WRITE, no policy-rule-literal', () => {
    for (const tool of ORG_ADMIN_TOOLS) {
      expect(tool.personaSlugs).toEqual([
        'T1_owner_strategist',
        'T2_admin_strategist',
      ]);
      expect(tool.isWrite).toBe(true);
      expect(tool.requiresPolicyRuleLiteral).toBe(false);
    }
  });

  it('escalate + bulk-ingest are HIGH stakes; the additive writes are MEDIUM', () => {
    expect(staffCreateTool.stakes).toBe('MEDIUM');
    expect(staffAssignKpiTool.stakes).toBe('MEDIUM');
    expect(staffScheduleTaskTool.stakes).toBe('MEDIUM');
    expect(staffEscalateToHumanTool.stakes).toBe('HIGH');
    expect(staffBulkIngestCsvTool.stakes).toBe('HIGH');
  });

  it('every tool name carries both EN and SW copy', () => {
    for (const tool of ORG_ADMIN_TOOLS) {
      expect(tool.name).toContain('(en)');
      expect(tool.name).toContain('(sw)');
    }
  });

  it('uses mining escalation categories (safety_incident, not maintenance)', () => {
    const parsed = staffEscalateToHumanTool.inputSchema.safeParse({
      title: 'haul-road collapse',
      reason: 'north ramp gave way',
      category: 'safety_incident',
    });
    expect(parsed.success).toBe(true);
    const reMaint = staffEscalateToHumanTool.inputSchema.safeParse({
      title: 'x',
      reason: 'y',
      category: 'maintenance_incident',
    });
    expect(reMaint.success).toBe(false);
  });
});

describe('staffCreateTool', () => {
  it('posts to /org-admin/staff with provenance + mining role', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'staff-1',
        full_name: 'Asha',
        role: 'pit_foreman',
        status: 'active',
        hire_date: '2026-06-05T10:00:00Z',
        manager_id: null,
      },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await staffCreateTool.handler(
      { fullName: 'Asha', role: 'pit_foreman' },
      ctx,
    );
    expect(res.id).toBe('staff-1');
    expect(res.role).toBe('pit_foreman');
    expect(res.status).toBe('active');
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('/org-admin/staff');
    const typed = body as {
      fullName: string;
      role: string;
      provenance: { via: string; sessionId: string | null };
    };
    expect(typed.fullName).toBe('Asha');
    expect(typed.provenance.via).toBe('chat');
    expect(typed.provenance.sessionId).toBe('session-xyz');
  });

  it('omits optional fields when not supplied (exactOptionalPropertyTypes)', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 's', full_name: 'A', role: 'geologist', status: 'active' },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    await staffCreateTool.handler({ fullName: 'A', role: 'geologist' }, ctx);
    const [, body] = post.mock.calls[0]!;
    expect(Object.prototype.hasOwnProperty.call(body, 'hireDate')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'managerId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'contact')).toBe(false);
  });

  it('degrades honestly when httpClient is unavailable', async () => {
    const res = await staffCreateTool.handler(
      { fullName: 'Asha', role: 'pit_foreman' },
      noClientCtx,
    );
    expect(res.id).toBe('');
    expect(res.status).toBe('unavailable');
  });
});

describe('staffAssignKpiTool', () => {
  it('posts to /org-admin/staff/kpis and maps the row', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'kpi-1',
        name: 'tonnes hauled',
        staffMemberName: 'Asha',
        target_value: '5000',
        metric_unit: 'count',
        period: 'quarter',
        period_end: null,
        status: 'active',
      },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await staffAssignKpiTool.handler(
      { staffMemberName: 'Asha', name: 'tonnes hauled', targetValue: 5000 },
      ctx,
    );
    expect(res.id).toBe('kpi-1');
    expect(res.targetValue).toBe('5000');
    expect(res.staffMemberName).toBe('Asha');
    const [url] = post.mock.calls[0]!;
    expect(url).toBe('/org-admin/staff/kpis');
  });

  it('rejects a non-positive target at the schema layer', () => {
    const parsed = staffAssignKpiTool.inputSchema.safeParse({
      name: 'x',
      targetValue: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it('degrades honestly when httpClient is unavailable', async () => {
    const res = await staffAssignKpiTool.handler(
      { name: 'tonnes', targetValue: 5000 },
      noClientCtx,
    );
    expect(res.id).toBe('');
    expect(res.status).toBe('unavailable');
    expect(res.targetValue).toBe('5000');
  });
});

describe('staffScheduleTaskTool', () => {
  it('posts to /org-admin/tasks with provenance', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'task-1',
        title: 'pit-wall inspection',
        status: 'open',
        priority: 'high',
        due_at: '2026-06-10T08:00:00Z',
        assigned_to: 'staff-1',
      },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await staffScheduleTaskTool.handler(
      { title: 'pit-wall inspection', priority: 'high' },
      ctx,
    );
    expect(res.id).toBe('task-1');
    expect(res.priority).toBe('high');
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('/org-admin/tasks');
    expect((body as { provenance: { via: string } }).provenance.via).toBe('chat');
  });

  it('degrades honestly when httpClient is unavailable', async () => {
    const res = await staffScheduleTaskTool.handler(
      { title: 'pit-wall inspection' },
      noClientCtx,
    );
    expect(res.id).toBe('');
    expect(res.status).toBe('unavailable');
    expect(res.priority).toBe('normal');
  });
});

describe('staffEscalateToHumanTool', () => {
  it('posts to /org-admin/escalations with category + severity', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'esc-1',
        title: 'haul-road collapse',
        category: 'safety_incident',
        severity: 'critical',
        status: 'open',
        escalated_to_staff_id: null,
        related_task_id: null,
      },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await staffEscalateToHumanTool.handler(
      {
        title: 'haul-road collapse',
        reason: 'north ramp gave way',
        category: 'safety_incident',
        severity: 'critical',
      },
      ctx,
    );
    expect(res.id).toBe('esc-1');
    expect(res.category).toBe('safety_incident');
    expect(res.severity).toBe('critical');
    const [url] = post.mock.calls[0]!;
    expect(url).toBe('/org-admin/escalations');
  });

  it('degrades honestly when httpClient is unavailable', async () => {
    const res = await staffEscalateToHumanTool.handler(
      { title: 'x', reason: 'y' },
      noClientCtx,
    );
    expect(res.id).toBe('');
    expect(res.status).toBe('unavailable');
    expect(res.category).toBe('other');
  });
});

describe('staffBulkIngestCsvTool', () => {
  it('posts to /org-admin/staff/bulk-csv and maps the per-row outcomes', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: {
        totalRows: 2,
        inserted: 1,
        skippedDuplicates: 1,
        rejected: 0,
        outcomes: [
          { line: 2, status: 'inserted', staffMemberId: 'staff-9' },
          { line: 3, status: 'skipped_duplicate', reason: 'dup' },
        ],
      },
    });
    const ctx = makeOwnerCtx({ get: vi.fn(), post });
    const res = await staffBulkIngestCsvTool.handler(
      { csv: 'name,role\nAsha,pit_foreman\nAsha,geologist' },
      ctx,
    );
    expect(res.totalRows).toBe(2);
    expect(res.inserted).toBe(1);
    expect(res.skippedDuplicates).toBe(1);
    expect(res.outcomes).toHaveLength(2);
    expect(res.outcomes[0]!.staffMemberId).toBe('staff-9');
    const [url] = post.mock.calls[0]!;
    expect(url).toBe('/org-admin/staff/bulk-csv');
  });

  it('degrades honestly when httpClient is unavailable', async () => {
    const res = await staffBulkIngestCsvTool.handler(
      { csv: 'name,role\nAsha,pit_foreman' },
      noClientCtx,
    );
    expect(res.totalRows).toBe(0);
    expect(res.inserted).toBe(0);
    expect(res.outcomes).toEqual([]);
  });
});
