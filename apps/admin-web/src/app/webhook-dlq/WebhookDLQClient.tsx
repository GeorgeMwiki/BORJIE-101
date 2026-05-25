'use client';

/**
 * Outbound webhook DLQ — migrated from
 * apps/admin-portal/src/pages/WebhookDLQ.tsx.
 *
 *   GET  /api/v1/webhooks/dead-letters
 *   GET  /api/v1/webhooks/dead-letters/:id
 *   POST /api/v1/webhooks/dead-letters/:id/replay
 */

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Loader2, Repeat } from 'lucide-react';
import { api } from '@/lib/api';

interface DlqEntry {
  readonly id: string;
  readonly webhookUrl: string;
  readonly eventType: string;
  readonly lastError: string;
  readonly attempts: number;
  readonly createdAt: string;
  readonly replayedAt?: string | null;
  readonly replayedBy?: string | null;
  readonly payloadPreview?: string;
}

export function WebhookDLQClient() {
  const [entries, setEntries] = useState<readonly DlqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DlqEntry | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<readonly DlqEntry[]>(
      '/webhooks/dead-letters?limit=100',
    );
    if (res.success && res.data) setEntries(res.data);
    else setError(res.error ?? 'Failed to load dead-letter queue');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function replay(entry: DlqEntry): Promise<void> {
    setReplaying(entry.id);
    setError(null);
    const res = await api.post(
      `/webhooks/dead-letters/${encodeURIComponent(entry.id)}/replay`,
      {},
    );
    setReplaying(null);
    if (res.success) void load();
    else setError(res.error ?? 'Replay failed');
  }

  async function inspect(entry: DlqEntry): Promise<void> {
    setInspectingId(entry.id);
    setError(null);
    const res = await api.get<DlqEntry>(
      `/webhooks/dead-letters/${encodeURIComponent(entry.id)}`,
    );
    setInspectingId(null);
    if (res.success && res.data) setSelected(res.data);
    else setError(res.error ?? 'Failed to load delivery detail');
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Inbox className="h-6 w-6 text-rose-500" />
        <p className="text-sm text-neutral-400">
          Dead-letter queue for outbound webhooks. Inspect payloads, replay
          failed deliveries.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : entries.length === 0 ? (
        <div className="platform-card text-sm text-neutral-400">
          DLQ empty.
        </div>
      ) : (
        <section className="platform-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">URL</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Last error</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-border/40 text-neutral-200"
                >
                  <td className="px-3 py-2 font-medium">{e.eventType}</td>
                  <td className="px-3 py-2 max-w-[18ch] truncate font-mono text-xs text-neutral-400">
                    {e.webhookUrl}
                  </td>
                  <td className="px-3 py-2">{e.attempts}</td>
                  <td className="px-3 py-2 max-w-[24ch] truncate text-xs text-rose-300">
                    {e.lastError}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="space-x-2 px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void inspect(e)}
                      disabled={inspectingId === e.id}
                      className="inline-flex items-center gap-1 text-xs text-neutral-300 hover:underline disabled:opacity-50"
                    >
                      {inspectingId === e.id && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      Inspect
                    </button>
                    {!e.replayedAt && (
                      <button
                        type="button"
                        onClick={() => void replay(e)}
                        disabled={replaying === e.id}
                        className="inline-flex items-center gap-1 text-xs text-rose-400 hover:underline disabled:opacity-50"
                      >
                        <Repeat className="h-3 w-3" /> Replay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {selected && (
        <section className="platform-card text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-foreground">
              Delivery {selected.id}
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-neutral-500"
            >
              Close
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded border border-border bg-surface-sunken p-3 text-xs text-neutral-300">
            {selected.payloadPreview ?? 'Payload preview unavailable.'}
          </pre>
        </section>
      )}
    </div>
  );
}
