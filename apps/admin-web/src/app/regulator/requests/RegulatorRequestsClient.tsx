'use client';

/**
 * Regulator requests admin inbox — closes chain C-A (issue #194).
 *
 *   GET  /api/v1/regulator/requests            — list
 *   POST /api/v1/regulator/requests            — create
 *   POST /api/v1/regulator/requests/:id/parse  — flip to owner_review
 *   POST /api/v1/regulator/requests/:id/export-redacted
 *   POST /api/v1/regulator/requests/:id/deliver
 *   POST /api/v1/regulator/requests/:id/reject
 *
 * Bilingual sw/en strings; SLA countdown via simple Math; toasts use
 * the shared `useState` message pattern.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type Regulator = 'pccb' | 'nemc' | 'eiti' | 'tmaa' | 'other';
type SubjectKind =
  | 'worker'
  | 'site'
  | 'licence'
  | 'tenant'
  | 'company'
  | 'shipment';
type Status =
  | 'received'
  | 'parsed'
  | 'owner_review'
  | 'disclosure_approved'
  | 'exporting'
  | 'exported'
  | 'delivered'
  | 'rejected'
  | 'expired';

interface RegulatorRequestRow {
  readonly id: string;
  readonly regulator: Regulator;
  readonly regulatorRef: string | null;
  readonly subjectKind: SubjectKind;
  readonly subjectRef: string;
  readonly status: Status;
  readonly summarySw: string | null;
  readonly summaryEn: string | null;
  readonly requestedAt: string;
  readonly dueAt: string;
  readonly responseDocUrl: string | null;
}

interface CreatePayload {
  readonly regulator: Regulator;
  readonly subjectKind: SubjectKind;
  readonly subjectRef: string;
  readonly summarySw?: string;
  readonly summaryEn?: string;
}

const STATUS_BADGE: Readonly<Record<Status, string>> = Object.freeze({
  received: 'bg-slate-100 text-slate-700',
  parsed: 'bg-slate-200 text-slate-800',
  owner_review: 'bg-amber-100 text-amber-800',
  disclosure_approved: 'bg-emerald-100 text-emerald-800',
  exporting: 'bg-blue-100 text-blue-800',
  exported: 'bg-blue-200 text-blue-900',
  delivered: 'bg-green-100 text-green-800',
  rejected: 'bg-rose-100 text-rose-800',
  expired: 'bg-zinc-200 text-zinc-700',
});

function daysUntilLabel(dueAt: string): string {
  const ms = new Date(dueAt).getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d remaining`;
}

export function RegulatorRequestsClient() {
  const [rows, setRows] = useState<readonly RegulatorRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreatePayload>({
    regulator: 'pccb',
    subjectKind: 'worker',
    subjectRef: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.get<readonly RegulatorRequestRow[]>(
      '/regulator/requests',
    );
    setLoading(false);
    if (res.success && res.data) {
      setRows(res.data);
    } else {
      setError(res.error ?? 'Failed to load regulator requests');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitNew = useCallback(async () => {
    if (!draft.subjectRef) {
      setError('Subject reference is required');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    const res = await api.post<RegulatorRequestRow>(
      '/regulator/requests',
      draft,
    );
    setLoading(false);
    if (res.success && res.data) {
      setMessage(`Captured ${res.data.id} — ${res.data.status}`);
      setDraft({ ...draft, subjectRef: '' });
      await load();
    } else {
      setError(res.error ?? 'Failed to capture request');
    }
  }, [draft, load]);

  const advance = useCallback(
    async (id: string, path: 'parse' | 'export-redacted' | 'deliver') => {
      setLoading(true);
      setError(null);
      const res = await api.post<unknown>(`/regulator/requests/${id}/${path}`, {});
      setLoading(false);
      if (res.success) {
        setMessage(`${id}: ${path} ok`);
        await load();
      } else {
        setError(res.error ?? `Failed to ${path} ${id}`);
      }
    },
    [load],
  );

  const reject = useCallback(
    async (id: string) => {
      const reason = window.prompt('Reason for rejection?');
      if (!reason) return;
      setLoading(true);
      setError(null);
      const res = await api.post<unknown>(`/regulator/requests/${id}/reject`, {
        reason,
      });
      setLoading(false);
      if (res.success) {
        setMessage(`${id}: rejected`);
        await load();
      } else {
        setError(res.error ?? `Failed to reject ${id}`);
      }
    },
    [load],
  );

  const totals = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">
          Capture inbound request
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Paste the regulator&apos;s ask. Status starts at <code>received</code>
          and auto-advances to <code>owner_review</code> on parse.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-sm">
            Regulator
            <select
              value={draft.regulator}
              onChange={(e) =>
                setDraft({ ...draft, regulator: e.target.value as Regulator })
              }
              className="mt-1 w-full rounded-md border-slate-300 text-sm"
            >
              <option value="pccb">PCCB / PDPC</option>
              <option value="nemc">NEMC</option>
              <option value="eiti">EITI / TEITI</option>
              <option value="tmaa">TMAA</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="text-sm">
            Subject kind
            <select
              value={draft.subjectKind}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  subjectKind: e.target.value as SubjectKind,
                })
              }
              className="mt-1 w-full rounded-md border-slate-300 text-sm"
            >
              <option value="worker">Worker</option>
              <option value="site">Site</option>
              <option value="licence">Licence</option>
              <option value="tenant">Tenant</option>
              <option value="company">Company</option>
              <option value="shipment">Shipment</option>
            </select>
          </label>
          <label className="text-sm">
            Subject reference
            <input
              value={draft.subjectRef}
              onChange={(e) =>
                setDraft({ ...draft, subjectRef: e.target.value })
              }
              placeholder="usr-… / site-… / lic-…"
              className="mt-1 w-full rounded-md border-slate-300 text-sm"
            />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            Summary (Swahili)
            <textarea
              value={draft.summarySw ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, summarySw: e.target.value })
              }
              rows={2}
              placeholder="Muhtasari kwa Kiswahili"
              className="mt-1 w-full rounded-md border-slate-300 text-sm"
            />
          </label>
          <label className="text-sm">
            Summary (English)
            <textarea
              value={draft.summaryEn ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, summaryEn: e.target.value })
              }
              rows={2}
              placeholder="Summary in English"
              className="mt-1 w-full rounded-md border-slate-300 text-sm"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button
            disabled={loading}
            onClick={() => void submitNew()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Capture request'}
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <section>
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            Inbox ({rows.length})
          </h2>
          <ul className="flex flex-wrap gap-2 text-xs text-slate-600">
            {Object.entries(totals).map(([k, v]) => (
              <li
                key={k}
                className={`rounded-full px-2 py-0.5 ${STATUS_BADGE[k as Status] ?? 'bg-slate-100 text-slate-700'}`}
              >
                {k}: {v}
              </li>
            ))}
          </ul>
        </header>
        <table className="mt-3 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Regulator</th>
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">SLA</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No regulator requests yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium uppercase">
                  {row.regulator}
                </td>
                <td className="px-4 py-2 text-slate-700">
                  <div>{row.subjectKind}</div>
                  <div className="text-xs text-slate-500">
                    {row.subjectRef}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status]}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {daysUntilLabel(row.dueAt)}
                </td>
                <td className="px-4 py-2 text-right space-x-2">
                  {row.status === 'received' && (
                    <button
                      onClick={() => void advance(row.id, 'parse')}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Parse
                    </button>
                  )}
                  {row.status === 'disclosure_approved' && (
                    <button
                      onClick={() => void advance(row.id, 'export-redacted')}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Export
                    </button>
                  )}
                  {row.status === 'exported' && (
                    <button
                      onClick={() => void advance(row.id, 'deliver')}
                      className="text-xs font-medium text-emerald-700 hover:underline"
                    >
                      Deliver
                    </button>
                  )}
                  {row.responseDocUrl && (
                    <a
                      href={row.responseDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-slate-700 hover:underline"
                    >
                      Download
                    </a>
                  )}
                  {row.status !== 'delivered' &&
                    row.status !== 'rejected' && (
                      <button
                        onClick={() => void reject(row.id)}
                        className="text-xs font-medium text-rose-700 hover:underline"
                      >
                        Reject
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
