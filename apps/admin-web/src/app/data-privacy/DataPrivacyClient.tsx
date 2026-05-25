'use client';

/**
 * GDPR right-to-be-forgotten — migrated from
 * apps/admin-portal/src/pages/DataPrivacy.tsx.
 *
 *   POST /api/v1/gdpr/delete-request           — lodge a deletion request
 *   GET  /api/v1/gdpr/delete-request/:id       — poll for status
 *   POST /api/v1/gdpr/delete-request/:id/execute — super-admin execution
 */

import { useCallback, useState } from 'react';
import { Lock, Shield, Download, Loader2, AlertTriangle } from 'lucide-react';
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
  const [record, setRecord] = useState<DeleteRequestRecord | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const execute = useCallback(async () => {
    if (!record) return;
    setLoading(true);
    setError(null);
    const res = await api.post<DeleteRequestRecord>(
      `/gdpr/delete-request/${encodeURIComponent(record.id)}/execute`,
      {},
    );
    setLoading(false);
    if (res.success && res.data) {
      setRecord(res.data);
      setMessage('Deletion executed.');
    } else {
      setError(res.error ?? 'Failed to execute deletion');
    }
  }, [record]);

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

      <section className="platform-card space-y-3">
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
          <span className="text-neutral-300">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!customerId || loading}
          className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          ) : null}
          Submit deletion request
        </button>
      </section>

      <section className="platform-card space-y-3">
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
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={!lookupId || loading}
            className="rounded border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
          >
            Fetch status
          </button>
        </div>
      </section>

      {record && (
        <section className="platform-card space-y-2 text-sm text-neutral-200">
          <p className="font-display text-foreground">Request {record.id}</p>
          <p>Customer: {record.customerId}</p>
          <p>Status: {record.status}</p>
          <p>Created: {record.createdAt}</p>
          {record.executedAt && <p>Executed: {record.executedAt}</p>}
          {record.notes && <p>Notes: {record.notes}</p>}
          {record.status !== 'executed' && (
            <button
              type="button"
              onClick={() => void execute()}
              className="mt-2 rounded bg-rose-700 px-4 py-2 text-sm font-medium text-white"
            >
              Execute deletion
            </button>
          )}
        </section>
      )}
    </div>
  );
}
