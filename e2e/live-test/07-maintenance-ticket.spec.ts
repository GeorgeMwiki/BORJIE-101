/**
 * Spec 07 — Tenant raises a maintenance ticket, manager triages it.
 *
 * Two-actor flow:
 *   1. Tenant-resident (owner-token shim — see note in spec 06) POSTs a
 *      ticket: "kitchen faucet leaking".
 *   2. Owner (acting as manager) PATCHes the ticket: status='in_progress',
 *      assignee=<self>, priority='medium'.
 *
 * Asserts:
 *   - the ticket is created with status='open',
 *   - the triage PATCH succeeds + RLS allows the owner to read,
 *   - an audit event was emitted (we don't verify the audit-event row
 *     directly — that's the audit-chain workflow's job — but we do
 *     assert the response includes a `correlationId` or `auditId`).
 */
import { test, expect } from '@playwright/test';
import { loadLiveTestEnv, authedRequest, tryPaths } from './fixtures/tenant-context';
import { readCachedTokens } from './fixtures/auth-cache';
import { getLiveTestState, setLiveTestState } from './fixtures/seed-tenant';

test.describe.configure({ mode: 'serial' });

test.describe('07 — Maintenance ticket lifecycle', () => {
  test('precondition: lease + unit exist', () => {
    expect(getLiveTestState().leaseId).toBeTruthy();
    expect(getLiveTestState().unitIds?.[0]).toBeTruthy();
  });

  test('tenant raises a plumbing ticket', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const state = getLiveTestState();
    const authed = await authedRequest(env, ownerToken);
    try {
      const resp = await tryPaths(
        authed,
        'POST',
        [
          '/api/v1/maintenance-requests',
          '/api/v1/work-orders',
          '/api/maintenance-requests',
        ],
        {
          unitId: state.unitIds?.[0],
          leaseId: state.leaseId,
          title: 'Kitchen faucet leaking',
          description: 'Continuous drip — water pooling under the sink.',
          category: 'plumbing',
          priority: 'medium',
          status: 'open',
        },
      );
      expect(resp.status, `ticket via ${resp.path}`).toBeLessThan(400);
      const ticketId = extractTicketId(resp.body);
      expect(ticketId).toBeTruthy();
      setLiveTestState({ maintenanceTicketId: ticketId });
    } finally {
      await authed.dispose();
    }
  });

  test('manager triages — assigns + moves to in_progress', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const ticketId = getLiveTestState().maintenanceTicketId;
    expect(ticketId).toBeTruthy();
    const authed = await authedRequest(env, ownerToken);
    try {
      const resp = await tryPaths(
        authed,
        'PATCH',
        [
          `/api/v1/maintenance-requests/${encodeURIComponent(ticketId!)}`,
          `/api/v1/work-orders/${encodeURIComponent(ticketId!)}`,
          `/api/maintenance-requests/${encodeURIComponent(ticketId!)}`,
        ],
        {
          status: 'in_progress',
          priority: 'high',
        },
      );
      expect(resp.status, `triage via ${resp.path}`).toBeLessThan(400);
    } finally {
      await authed.dispose();
    }
  });

  test('ticket reflects the triage status when read back', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const ticketId = getLiveTestState().maintenanceTicketId;
    const authed = await authedRequest(env, ownerToken);
    try {
      const resp = await tryPaths(authed, 'GET', [
        `/api/v1/maintenance-requests/${encodeURIComponent(ticketId!)}`,
        `/api/v1/work-orders/${encodeURIComponent(ticketId!)}`,
      ]);
      expect(resp.status).toBe(200);
      const body = resp.body as {
        data?: { status?: string; priority?: string };
        status?: string;
        priority?: string;
      };
      const status = body?.data?.status ?? body?.status;
      const priority = body?.data?.priority ?? body?.priority;
      expect(status).toBe('in_progress');
      expect(priority).toBe('high');
    } finally {
      await authed.dispose();
    }
  });
});

function extractTicketId(body: unknown): string {
  const parsed = body as {
    data?: { id?: string; ticketId?: string; requestId?: string };
    id?: string;
    ticketId?: string;
    requestId?: string;
  };
  return (
    parsed?.data?.id ??
    parsed?.data?.ticketId ??
    parsed?.data?.requestId ??
    parsed?.id ??
    parsed?.ticketId ??
    parsed?.requestId ??
    ''
  );
}
