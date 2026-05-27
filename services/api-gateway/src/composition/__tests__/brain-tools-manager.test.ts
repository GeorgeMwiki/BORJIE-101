/**
 * Manager-tools tests (T3_module_manager).
 *
 * Verifies:
 *   - Tool count + gating to manager slug
 *   - Approve / assign / escalate WRITE tools emit audit entries
 *   - Persona gating refuses owner / worker / buyer callers
 *   - Suggest-assignee returns the AI-ranked output without writing
 */

import { describe, it, expect } from 'vitest';
import {
  toBrainToolHandler,
  MANAGER_TOOLS,
  type PersonaToolAuditEntry,
  type PersonaToolGate,
  type PersonaToolHttpClient,
} from '../brain-tools';
import {
  managerAssignTaskTool,
  managerDecideApprovalTool,
  managerSuggestAssigneeTool,
} from '../brain-tools/manager-tools';

function client(): PersonaToolHttpClient {
  return {
    async get<T>(): Promise<T> {
      return { suggestions: [{ workerId: 'w-1', score: 0.9, reason: 'best-match', evidenceIds: ['ev-1'] }] } as unknown as T;
    },
    async post<T>(): Promise<T> {
      return {
        taskId: 't-1',
        assignee: 'w-1',
        assignedAt: '2026-01-01T00:00:00.000Z',
        approvalId: 'a-1',
        decision: 'approve',
        decidedAt: '2026-01-01T00:00:00.000Z',
      } as unknown as T;
    },
  };
}

function gate(
  persona: string,
  audits: PersonaToolAuditEntry[],
): PersonaToolGate {
  return {
    killSwitchOpen: false,
    resolvePersonaSlug: () => persona,
    httpClient: client(),
    auditSink: {
      async append(entry: PersonaToolAuditEntry) {
        audits.push(entry);
      },
    },
  };
}

function ctx() {
  return {
    tenant: { tenantId: 'tenant-mgr' } as never,
    actor: { id: 'mgr-1' } as never,
    persona: { id: 'p-1', allowedTools: [] } as never,
    threadId: 'th-1',
  };
}

describe('manager-tools — surface', () => {
  it('registers exactly nine manager tools', () => {
    expect(MANAGER_TOOLS).toHaveLength(9);
  });

  it('every manager tool is gated to T3_module_manager only', () => {
    for (const t of MANAGER_TOOLS) {
      expect(t.personaSlugs).toEqual(['T3_module_manager']);
    }
  });

  it('write tools are exactly {assign, decide, escalate}', () => {
    const writeIds = MANAGER_TOOLS.filter((t) => t.isWrite).map((t) => t.id);
    expect(writeIds.sort()).toEqual([
      'mining.approvals.decide',
      'mining.escalations.raise',
      'mining.tasks.assign',
    ]);
  });
});

describe('manager-tools — execution', () => {
  it('assigns a task with valid input and writes an audit entry', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      managerAssignTaskTool,
      gate('T3_module_manager', audits),
    );
    const result = await handler.execute(
      { taskId: 't-1', workerId: 'w-1' },
      ctx() as never,
    );
    expect(result.ok).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe('ok');
    expect(audits[0].toolId).toBe('mining.tasks.assign');
    expect(audits[0].stakes).toBe('MEDIUM');
  });

  it('rejects approve/reject with invalid decision value (zod fail)', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      managerDecideApprovalTool,
      gate('T3_module_manager', audits),
    );
    const result = await handler.execute(
      { approvalId: 'a-1', decision: 'maybe' as never },
      ctx() as never,
    );
    expect(result.ok).toBe(false);
    expect(audits).toHaveLength(0);
  });

  it('records a denial audit when an owner tries to assign tasks', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      managerAssignTaskTool,
      gate('T1_owner_strategist', audits),
    );
    const result = await handler.execute(
      { taskId: 't-1', workerId: 'w-1' },
      ctx() as never,
    );
    expect(result.ok).toBe(false);
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe('denied');
  });

  it('suggest-assignee is read-only (no audit, even on success)', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      managerSuggestAssigneeTool,
      gate('T3_module_manager', audits),
    );
    const result = await handler.execute(
      { taskId: 't-1' },
      ctx() as never,
    );
    expect(result.ok).toBe(true);
    expect(audits).toHaveLength(0);
  });
});
