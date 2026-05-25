'use client';

/**
 * Agent certifications admin — migrated from
 * apps/admin-portal/src/pages/ApiIntegrations.tsx.
 *
 *   GET    /api/v1/agent-certifications
 *   POST   /api/v1/agent-certifications
 *   DELETE /api/v1/agent-certifications/:id
 *   GET    /api/v1/agent-certifications/revocations
 */

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Loader2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Certification {
  readonly id: string;
  readonly agentId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt?: string | null;
}

interface Revocation {
  readonly id: string;
  readonly certId: string;
  readonly reason: string;
  readonly revokedAt: string;
}

export function IntegrationsClient() {
  const [certs, setCerts] = useState<readonly Certification[]>([]);
  const [revocations, setRevocations] = useState<readonly Revocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [form, setForm] = useState({
    agentId: '',
    scopes: 'read:property,read:lease',
    days: '90',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [list, revs] = await Promise.all([
      api.get<readonly Certification[]>('/agent-certifications'),
      api.get<readonly Revocation[]>('/agent-certifications/revocations'),
    ]);
    if (list.success && list.data) setCerts(list.data);
    else setError(list.error ?? 'Failed to load certifications');
    if (revs.success && revs.data) setRevocations(revs.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function issue(): Promise<void> {
    const scopes = form.scopes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!form.agentId || scopes.length === 0) return;
    setIssuing(true);
    setError(null);
    const validForMs = Number(form.days) * 24 * 60 * 60 * 1000;
    const res = await api.post('/agent-certifications', {
      agentId: form.agentId,
      scopes,
      validForMs,
    });
    setIssuing(false);
    if (res.success) {
      setForm({ agentId: '', scopes: 'read:property,read:lease', days: '90' });
      void load();
    } else {
      setError(res.error ?? 'Failed to issue certification');
    }
  }

  async function confirmRevoke(): Promise<void> {
    if (!revokingId || !revokeReason.trim()) return;
    setError(null);
    const res = await api.delete(
      `/agent-certifications/${encodeURIComponent(revokingId)}`,
      { reason: revokeReason.trim() },
    );
    if (res.success) {
      setRevokingId(null);
      setRevokeReason('');
      void load();
    } else {
      setError(res.error ?? 'Failed to revoke');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-amber-600" />
        <p className="text-sm text-neutral-400">
          Issue, view, and revoke agent certifications used by external
          integrators.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <section className="platform-card max-w-xl space-y-3">
        <h3 className="flex items-center gap-2 font-display text-foreground">
          <Plus className="h-4 w-4" /> Issue new certification
        </h3>
        <label className="block text-sm">
          <span className="text-neutral-300">Agent ID</span>
          <input
            type="text"
            value={form.agentId}
            onChange={(e) => setForm({ ...form, agentId: e.target.value })}
            className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">Scopes (comma-separated)</span>
          <input
            type="text"
            value={form.scopes}
            onChange={(e) => setForm({ ...form, scopes: e.target.value })}
            className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">Valid for (days)</span>
          <input
            type="number"
            min="1"
            max="1095"
            value={form.days}
            onChange={(e) => setForm({ ...form, days: e.target.value })}
            className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
          />
        </label>
        <button
          type="button"
          onClick={() => void issue()}
          disabled={!form.agentId || issuing}
          className="inline-flex items-center gap-2 rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {issuing && <Loader2 className="h-3 w-3 animate-spin" />}
          {issuing ? 'Issuing…' : 'Issue'}
        </button>
      </section>

      <section className="platform-card overflow-hidden">
        <header className="border-b border-border/40 pb-3 mb-3">
          <h3 className="font-display text-foreground">Active certifications</h3>
        </header>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : certs.length === 0 ? (
          <p className="text-sm text-neutral-400">No certifications yet.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {certs.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {c.agentId}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Scopes: {c.scopes.join(', ')}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Expires {new Date(c.expiresAt).toLocaleString()}
                  </p>
                </div>
                {!c.revokedAt && (
                  <button
                    type="button"
                    onClick={() => {
                      setRevokingId(c.id);
                      setRevokeReason('');
                    }}
                    className="inline-flex items-center gap-1 text-xs text-rose-400 hover:underline"
                  >
                    <Trash2 className="h-3 w-3" /> Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {revokingId && (
        <section
          role="alertdialog"
          aria-labelledby="revoke-cert-title"
          className="platform-card max-w-xl space-y-3 border-rose-500/30"
        >
          <h3 id="revoke-cert-title" className="font-display text-foreground">
            Revoke certification
          </h3>
          <p className="text-xs text-neutral-400">
            Provide a reason — recorded in the revocation history.
          </p>
          <label className="block text-sm">
            <span className="text-neutral-300">Reason</span>
            <input
              type="text"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              autoFocus
              className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void confirmRevoke()}
              disabled={!revokeReason.trim()}
              className="rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Confirm revoke
            </button>
            <button
              type="button"
              onClick={() => {
                setRevokingId(null);
                setRevokeReason('');
              }}
              className="rounded border border-border px-3 py-1 text-xs text-neutral-300"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {revocations.length > 0 && (
        <section className="platform-card">
          <h3 className="font-display text-foreground mb-3">
            Revocation history
          </h3>
          <ul className="divide-y divide-border/40 text-sm">
            {revocations.map((r) => (
              <li key={r.id} className="py-2">
                <p className="text-neutral-200">
                  Cert <code className="text-xs">{r.certId}</code> — {r.reason}
                </p>
                <p className="text-xs text-neutral-500">
                  {new Date(r.revokedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
