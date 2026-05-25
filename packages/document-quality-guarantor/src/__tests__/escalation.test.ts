/**
 * Escalation tests: workflow-engine wired vs not wired, audit event
 * always appended, getEscalation lookup, workflow-engine failure
 * still produces a ticket.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryAuditChainStore } from '../audit/index.js';
import { createEscalationService, type WorkflowEnginePort } from '../escalation/index.js';

describe('createEscalationService', () => {
  let audit = createInMemoryAuditChainStore();
  beforeEach(() => {
    audit = createInMemoryAuditChainStore();
  });

  it('creates a ticket with workflowRunId when workflow-engine wired', async () => {
    const workflowEngine: WorkflowEnginePort = {
      startReviewableRun: vi.fn(async () => ({ runId: 'wf-run-42' })),
    };
    const svc = createEscalationService({ audit, workflowEngine });
    const ticket = await svc.escalateToHuman({
      tenantId: 't-1',
      cause: 'extraction_failed_n_times',
      contextRefs: [{ ref: 'intake:abc' }],
      summary: 'all 3 OCR engines fell below 0.85 confidence',
    });
    expect(ticket.workflowRunId).toBe('wf-run-42');
    expect(ticket.cause).toBe('extraction_failed_n_times');
    expect(workflowEngine.startReviewableRun).toHaveBeenCalledOnce();
  });

  it('falls back to audit-only when workflow-engine NOT wired', async () => {
    const svc = createEscalationService({ audit });
    const ticket = await svc.escalateToHuman({
      tenantId: 't-1',
      cause: 'format_unsupported',
      contextRefs: [],
      summary: 'received .pages file; no handler',
    });
    expect(ticket.workflowRunId).toBeNull();
    const entries = await audit.list('t-1');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.kind === 'escalation_dispatched')).toBe(true);
  });

  it('still produces a ticket when workflow-engine call throws', async () => {
    const workflowEngine: WorkflowEnginePort = {
      startReviewableRun: vi.fn(async () => {
        throw new Error('engine_down');
      }),
    };
    const svc = createEscalationService({ audit, workflowEngine });
    const ticket = await svc.escalateToHuman({
      tenantId: 't-1',
      cause: 'quality_gate_blocked',
      contextRefs: [{ ref: 'output:xyz' }],
      summary: 'roundtrip drift detected',
    });
    expect(ticket.workflowRunId).toBeNull();
    expect(ticket.ticketId).toBeDefined();
    // Both the engine-failure event AND the dispatch event recorded.
    const entries = await audit.list('t-1');
    const failures = entries.filter(
      (e) =>
        e.kind === 'escalation_dispatched' &&
        (e.details as Record<string, unknown>)['outcome'] === 'workflow_engine_call_failed',
    );
    expect(failures.length).toBe(1);
  });

  it('list returns all tickets for a tenant', async () => {
    const svc = createEscalationService({ audit });
    await svc.escalateToHuman({
      tenantId: 't-1',
      cause: 'user_request',
      contextRefs: [],
      summary: 'manual review please',
    });
    await svc.escalateToHuman({
      tenantId: 't-1',
      cause: 'data_inconsistent',
      contextRefs: [],
      summary: 'amount mismatch',
    });
    expect(svc.list('t-1').length).toBe(2);
    expect(svc.list('t-2').length).toBe(0);
  });

  it('getEscalation retrieves a ticket by id', async () => {
    const svc = createEscalationService({ audit });
    const ticket = await svc.escalateToHuman({
      tenantId: 't-1',
      cause: 'user_request',
      contextRefs: [],
      summary: 'check this',
    });
    const retrieved = svc.getEscalation(ticket.ticketId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.summary).toBe('check this');
  });
});
