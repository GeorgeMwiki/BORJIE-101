'use client';

/**
 * WorkforceTabRequestQueue — Wave WORKFORCE-FIXED-TABS.
 *
 * Owner-side review queue for /api/v1/owner/workforce/tab-change-requests.
 * Each pending row renders requester + role + site + reason + the
 * proposed diff + Approve / Reject buttons. Approve auto-applies the
 * diff via the gateway (hash-chained), Reject just records the decision.
 *
 * Bilingual sw/en. Real BFF wiring; clean empty state when no pending.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';

interface ChangeRequestRow {
  readonly id: string;
  readonly requesterUserId: string;
  readonly requesterRole: string;
  readonly siteId: string | null;
  readonly reason: string;
  readonly requestedChanges: {
    readonly addTabs?: ReadonlyArray<string>;
    readonly removeTabs?: ReadonlyArray<string>;
    readonly densityChange?: 'comfortable' | 'compact';
  };
  readonly status: string;
  readonly createdAt: string;
}

interface QueueProps {
  readonly isSw: boolean;
}

const COPY = {
  en: {
    title: 'Pending tab-change requests',
    empty: 'No pending requests.',
    requester: 'Requester',
    role: 'Role',
    site: 'Site',
    reason: 'Reason',
    diff: 'Proposed changes',
    add: 'Add',
    remove: 'Remove',
    density: 'Density',
    approve: 'Approve',
    reject: 'Reject',
    note: 'Note (optional)',
    deciding: 'Saving…',
    error: 'Decision failed',
    global: 'Global',
  },
  sw: {
    title: 'Maombi ya tabo yanayosubiri',
    empty: 'Hakuna maombi yanayosubiri.',
    requester: 'Mtumaji',
    role: 'Jukumu',
    site: 'Eneo',
    reason: 'Sababu',
    diff: 'Mabadiliko yaliyopendekezwa',
    add: 'Ongeza',
    remove: 'Ondoa',
    density: 'Mpangilio',
    approve: 'Idhinisha',
    reject: 'Kataa',
    note: 'Maelezo (hiari)',
    deciding: 'Inahifadhi…',
    error: 'Maamuzi hayakufaulu',
    global: 'Kote',
  },
} as const;

async function fetchPending(): Promise<ReadonlyArray<ChangeRequestRow>> {
  try {
    return await apiRequest<ReadonlyArray<ChangeRequestRow>>(
      '/api/v1/owner/workforce/tab-change-requests?status=pending',
    );
  } catch {
    return [];
  }
}

export function WorkforceTabRequestQueue(props: QueueProps): JSX.Element {
  const copy = props.isSw ? COPY.sw : COPY.en;
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const pendingQuery = useQuery({
    queryKey: ['workforce', 'tab-change-requests', 'pending'],
    queryFn: fetchPending,
  });

  const decideMutation = useMutation({
    mutationFn: async (input: {
      readonly id: string;
      readonly decision: 'approve' | 'reject';
      readonly note?: string;
    }) =>
      apiRequest(`/api/v1/owner/workforce/tab-change-requests/${input.id}`, {
        method: 'PATCH',
        body: { decision: input.decision, note: input.note },
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ['workforce', 'tab-change-requests', 'pending'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['workforce', 'tab-configs', 'all'],
      });
    },
  });

  async function decide(
    id: string,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    setDecidingId(`${id}::${decision}`);
    try {
      await decideMutation.mutateAsync({
        id,
        decision,
        note: notes[id]?.trim() || undefined,
      });
    } finally {
      setDecidingId(null);
    }
  }

  const rows = pendingQuery.data ?? [];

  return (
    <aside className="rounded-2xl border border-border bg-surface-elevated p-6">
      <header className="mb-4">
        <h2 className="font-display text-lg text-foreground">{copy.title}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => {
            const adds = row.requestedChanges.addTabs ?? [];
            const removes = row.requestedChanges.removeTabs ?? [];
            const density = row.requestedChanges.densityChange;
            return (
              <li
                key={row.id}
                className="rounded-xl border border-border bg-surface-muted/40 p-4"
              >
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{copy.role}</dt>
                  <dd className="font-medium text-foreground">
                    {row.requesterRole}
                  </dd>
                  <dt className="text-muted-foreground">{copy.site}</dt>
                  <dd className="font-medium text-foreground">
                    {row.siteId ?? copy.global}
                  </dd>
                  <dt className="text-muted-foreground">{copy.requester}</dt>
                  <dd className="font-mono text-foreground">
                    {row.requesterUserId}
                  </dd>
                </dl>
                <p className="mt-3 rounded-md bg-background/60 px-3 py-2 text-sm text-foreground">
                  {row.reason}
                </p>
                <div className="mt-3 space-y-1 text-xs">
                  <p className="font-semibold uppercase tracking-wide text-muted-foreground">
                    {copy.diff}
                  </p>
                  {adds.length > 0 ? (
                    <p className="text-foreground">
                      <span className="font-semibold text-success">
                        {copy.add}:
                      </span>{' '}
                      {adds.join(', ')}
                    </p>
                  ) : null}
                  {removes.length > 0 ? (
                    <p className="text-foreground">
                      <span className="font-semibold text-destructive">
                        {copy.remove}:
                      </span>{' '}
                      {removes.join(', ')}
                    </p>
                  ) : null}
                  {density ? (
                    <p className="text-foreground">
                      <span className="font-semibold text-foreground">
                        {copy.density}:
                      </span>{' '}
                      {density}
                    </p>
                  ) : null}
                </div>
                <label className="mt-3 block text-xs text-muted-foreground">
                  {copy.note}
                  <textarea
                    rows={2}
                    value={notes[row.id] ?? ''}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                  />
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void decide(row.id, 'approve')}
                    disabled={decidingId !== null}
                    className="rounded-full bg-success px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-60"
                  >
                    {decidingId === `${row.id}::approve`
                      ? copy.deciding
                      : copy.approve}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(row.id, 'reject')}
                    disabled={decidingId !== null}
                    className="rounded-full border border-destructive px-4 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    {decidingId === `${row.id}::reject`
                      ? copy.deciding
                      : copy.reject}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {decideMutation.isError ? (
        <p className="mt-3 text-xs text-destructive">{copy.error}</p>
      ) : null}
    </aside>
  );
}
