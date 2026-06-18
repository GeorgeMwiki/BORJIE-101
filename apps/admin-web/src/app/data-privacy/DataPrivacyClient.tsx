'use client';

/**
 * GDPR right-to-be-forgotten — migrated from
 * apps/admin-portal/src/pages/DataPrivacy.tsx.
 *
 *   POST /api/v1/gdpr/delete-request           — lodge a deletion request
 *   GET  /api/v1/gdpr/delete-request/:id       — poll for status
 *   POST /api/v1/gdpr/delete-request/:id/execute?tenant=… — break-glass exec
 *
 * INV-A / FIRE-5: RTBF EXECUTION deletes a tenant's PII from this internal
 * console. It is now bound to the break-glass spine — a platform operator must
 * have an active, tenant-consented, time-boxed grant (scope `rtbf_execution`)
 * for the TARGET tenant before the gateway will execute. The execution is
 * hash-chain audited and surfaced on the tenant's owner-web Trust Center. The
 * operator files the request here; the gateway enforces the gate.
 */

import { useCallback, useState } from 'react';
import { Lock, Shield, Download, AlertTriangle } from 'lucide-react';
import { Button, Card } from '@borjie/design-system';
import { api } from '@/lib/api';

interface DeleteRequestRecord {
  readonly id: string;
  readonly customerId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly executedAt?: string | null;
  readonly notes?: string;
}

export function DataPrivacyClient() {
  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [targetTenantId, setTargetTenantId] = useState('');
  const [record, setRecord] = useState<DeleteRequestRecord | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestingGrant, setRequestingGrant] = useState(false);

  const submit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    const res = await api.post<DeleteRequestRecord>('/gdpr/delete-request', {
      customerId,
      notes: notes || undefined,
    });
    setLoading(false);
    if (res.success && res.data) {
      setRecord(res.data);
      setMessage(
        `Request ${res.data.id} recorded with status ${res.data.status}.`,
      );
    } else {
      setError(res.error ?? 'Failed to record request');
    }
  }, [customerId, notes]);

  const lookup = useCallback(async () => {
    if (!lookupId) return;
    setLoading(true);
    setError(null);
    const res = await api.get<DeleteRequestRecord>(
      `/gdpr/delete-request/${encodeURIComponent(lookupId)}`,
    );
    setLoading(false);
    if (res.success && res.data) {
      setRecord(res.data);
    } else {
      setError(res.error ?? 'Lookup failed');
    }
  }, [lookupId]);

  const requestBreakGlass = useCallback(async () => {
    if (!targetTenantId) {
      setError('A target tenant id is required to request break-glass.');
      return;
    }
    setRequestingGrant(true);
    setError(null);
    setMessage(null);
    const res = await api.post('/mining/internal/break-glass/requests', {
      tenantId: targetTenantId,
      justificationCode: 'rtbf_execution',
      reason: `RTBF execution${record ? ` for request ${record.id}` : ''}`,
      scopes: ['rtbf_execution'],
    });
    setRequestingGrant(false);
    if (res.success) {
      setMessage(
        'Break-glass request filed. The tenant must consent on their Trust Center before execution will run. Retry execution once consented.',
      );
    } else {
      setError(res.error ?? 'Failed to file break-glass request');
    }
  }, [targetTenantId, record]);

  const execute = useCallback(async () => {
    if (!record) return;
    if (!targetTenantId) {
      setError('A target tenant id is required to execute (break-glass scope).');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await api.post<DeleteRequestRecord>(
      `/gdpr/delete-request/${encodeURIComponent(record.id)}/execute?tenant=${encodeURIComponent(targetTenantId)}`,
      {},
    );
    setLoading(false);
    if (res.success && res.data) {
      setRecord(res.data);
      setMessage('Deletion executed under break-glass (audited + tenant-visible).');
    } else {
      setError(
        res.error ??
          'Failed to execute deletion — an active tenant-consented break-glass grant is required.',
      );
    }
  }, [record, targetTenantId]);

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="flex items-center gap-3">
        <Lock className="h-6 w-6 text-rose-500" />
        <p className="text-sm text-neutral-400">
          Lodge GDPR right-to-be-forgotten requests and execute approved
          deletions.
        </p>
      </header>

      {message && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {message}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
        </div>
      )}

      <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-rose-500" />
          <h3 className="font-display text-foreground">New deletion request</h3>
        </div>
        <label className="block text-sm">
          <span className="text-neutral-300">Customer ID</span>
          <input
            type="text"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="cust_…"
            className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
            data-testid="gdpr-customer-id"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">Target tenant id</span>
          <input
            type="text"
            value={targetTenantId}
            onChange={(e) => setTargetTenantId(e.target.value)}
            placeholder="tenant_… (required for break-glass execution)"
            className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
            data-testid="gdpr-target-tenant"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
          />
        </label>
        <Button
          type="button"
          variant="destructive"
          onClick={() => void submit()}
          disabled={!customerId || loading}
          loading={loading}
        >
          Submit deletion request
        </Button>
      </Card>

      <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong space-y-3">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-indigo-400" />
          <h3 className="font-display text-foreground">Look up request</h3>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Request ID"
            className="flex-1 rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void lookup()}
            disabled={!lookupId || loading}
          >
            Fetch status
          </Button>
        </div>
      </Card>

      {record && (
        <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong space-y-2 text-sm text-neutral-200">
          <p className="font-display text-foreground">Request {record.id}</p>
          <p>Customer: {record.customerId}</p>
          <p>Status: {record.status}</p>
          <p>Created: {record.createdAt}</p>
          {record.executedAt && <p>Executed: {record.executedAt}</p>}
          {record.notes && <p>Notes: {record.notes}</p>}
          {record.status !== 'executed' && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void requestBreakGlass()}
                disabled={!targetTenantId || requestingGrant}
                loading={requestingGrant}
                className="border-amber-700 text-amber-300"
              >
                {requestingGrant ? 'Filing…' : 'Request break-glass'}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void execute()}
                disabled={!targetTenantId}
                className="bg-rose-700 text-white hover:bg-rose-700/90"
              >
                Execute deletion (break-glass)
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
