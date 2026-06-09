'use client';

import { useState } from 'react';
import {
  useSandboxWrites,
  useCommitSandboxWrite,
  useRejectSandboxWrite,
  type SandboxWrite,
} from '@/lib/queries/wave9';

interface AgenticSandboxQueueProps {
  readonly isSw: boolean;
}

const STATUS_OPTIONS = ['pending', 'committed', 'rejected', 'all'] as const;

function tableOf(w: SandboxWrite): string {
  return w.targetTable ?? w.target_table ?? 'unknown';
}

function createdOf(w: SandboxWrite): string | undefined {
  return w.createdAt ?? w.created_at;
}

/**
 * MD-Agentic sandbox-writes review queue (O-W-33).
 *
 * Lists the staged sandbox writes the brain proposed and lets the MD commit
 * (four-eye, high-stakes — the gateway runs the REAL atomic write + audit
 * chain) or reject each one. Read-first: planning / dispatch stays in chat;
 * this surface is the human-judgement gate over the staged writes.
 */
export function AgenticSandboxQueue({ isSw }: AgenticSandboxQueueProps): JSX.Element {
  const [status, setStatus] = useState<string>('pending');
  const query = useSandboxWrites(status);
  const commit = useCommitSandboxWrite(status);
  const reject = useRejectSandboxWrite(status);
  const [toast, setToast] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  function onCommit(w: SandboxWrite) {
    commit.mutate(w.id, {
      onSuccess: () =>
        setToast(isSw ? 'Imewekwa kwenye mfumo.' : 'Committed to the live system.'),
      onError: (err) =>
        setToast(`${isSw ? 'Imeshindikana' : 'Commit failed'}: ${err.message}`),
    });
  }

  function onReject(w: SandboxWrite) {
    const reason = (reasonById[w.id] ?? '').trim();
    if (reason.length < 1) {
      setToast(isSw ? 'Andika sababu kwanza.' : 'Enter a reason first.');
      return;
    }
    reject.mutate(
      { id: w.id, reason },
      {
        onSuccess: () => setToast(isSw ? 'Imekataliwa.' : 'Rejected.'),
        onError: (err) =>
          setToast(`${isSw ? 'Imeshindikana' : 'Reject failed'}: ${err.message}`),
      },
    );
  }

  const writes = query.data?.sandboxWrites ?? [];
  const busy = commit.isPending || reject.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setStatus(opt)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              status === opt
                ? 'border-signal-500 bg-signal-500/10 text-signal-500'
                : 'border-border text-neutral-400 hover:bg-surface'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <p className="text-sm text-neutral-500">
          {isSw ? 'Inapakia…' : 'Loading staged writes…'}
        </p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">{query.error.message}</p>
      ) : writes.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
          <p className="text-sm text-neutral-400">
            {isSw ? 'Hakuna maandishi yaliyosubiri.' : 'No staged writes in this view.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {writes.map((w) => (
            <article key={w.id} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-neutral-300">{tableOf(w)}</span>
                    {w.operation ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-neutral-400">
                        {w.operation}
                      </span>
                    ) : null}
                    {w.status ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-neutral-400">
                        {w.status}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-neutral-500">{w.id}</p>
                  {w.summary ? (
                    <p className="mt-1 text-sm text-foreground">{w.summary}</p>
                  ) : null}
                  {w.rationale ? (
                    <p className="mt-1 text-xs text-neutral-400">{w.rationale}</p>
                  ) : null}
                  {createdOf(w) ? (
                    <p className="mt-1 text-xs text-neutral-500">{createdOf(w)}</p>
                  ) : null}
                </div>
              </div>

              {(w.status ?? 'pending') === 'pending' ? (
                <div className="flex flex-wrap items-end gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onCommit(w)}
                    className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-success hover:bg-surface disabled:opacity-40"
                  >
                    {isSw ? 'Thibitisha (weka)' : 'Commit (four-eye)'}
                  </button>
                  <label className="block flex-1 min-w-[14rem]">
                    <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                      {isSw ? 'Sababu ya kukataa' : 'Reject reason'}
                    </span>
                    <input
                      type="text"
                      value={reasonById[w.id] ?? ''}
                      onChange={(e) =>
                        setReasonById((prev) => ({ ...prev, [w.id]: e.target.value }))
                      }
                      placeholder={isSw ? 'Kwa nini?' : 'Why reject this write?'}
                      className="w-full rounded-md border border-border bg-surface/60 px-3 py-1.5 text-sm text-foreground placeholder:text-neutral-600 focus:border-signal-500 focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onReject(w)}
                    className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-warning hover:bg-surface disabled:opacity-40"
                  >
                    {isSw ? 'Kataa' : 'Reject'}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-foreground"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
