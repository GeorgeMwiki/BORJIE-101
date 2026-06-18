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
import { Button } from '@borjie/design-system';
import { apiRequest } from '@/lib/api-client';
import { tailStrings as S } from '@/i18n/strings/tail';

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

const Q = S.workforceTabRequestQueue;

const COPY = {
  en: {
    title: Q.title.en,
    empty: Q.empty.en,
    requester: Q.requester.en,
    role: Q.role.en,
    site: Q.site.en,
    reason: Q.reason.en,
    diff: Q.diff.en,
    add: Q.add.en,
    remove: Q.remove.en,
    density: Q.density.en,
    approve: Q.approve.en,
    reject: Q.reject.en,
    note: Q.note.en,
    deciding: Q.deciding.en,
    error: Q.error.en,
    global: Q.global.en,
  },
  sw: {
    title: Q.title.sw,
    empty: Q.empty.sw,
    requester: Q.requester.sw,
    role: Q.role.sw,
    site: Q.site.sw,
    reason: Q.reason.sw,
    diff: Q.diff.sw,
    add: Q.add.sw,
    remove: Q.remove.sw,
    density: Q.density.sw,
    approve: Q.approve.sw,
    reject: Q.reject.sw,
    note: Q.note.sw,
    deciding: Q.deciding.sw,
    error: Q.error.sw,
    global: Q.global.sw,
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
  /** Per-row error messages keyed by request id. Cleared when a new decision starts. */
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});

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
    onSettled: (_data, _err, input) => {
      void queryClient.invalidateQueries({
        queryKey: ['workforce', 'tab-change-requests', 'pending'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['workforce', 'tab-configs', 'all'],
      });
      // Per-request cache key (owner-genui-10 cache invalidation).
      void queryClient.invalidateQueries({
        queryKey: ['workforce', 'tab-change-request', input.id],
      });
    },
    onError: (err, input) => {
      const message =
        err instanceof Error ? err.message : copy.error;
      setRowErrors((prev) => ({ ...prev, [input.id]: message }));
    },
  });

  async function decide(
    id: string,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    // Clear the per-row error for this request before starting a new attempt.
    setRowErrors((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    setDecidingId(`${id}::${decision}`);
    try {
      const trimmedNote = notes[id]?.trim();
      await decideMutation.mutateAsync({
        id,
        decision,
        ...(trimmedNote ? { note: trimmedNote } : {}),
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
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void decide(row.id, 'approve')}
                      disabled={decidingId !== null}
                      className="bg-success text-background hover:bg-success/90"
                    >
                      {decidingId === `${row.id}::approve`
                        ? copy.deciding
                        : copy.approve}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void decide(row.id, 'reject')}
                      disabled={decidingId !== null}
                      className="border-destructive text-destructive hover:bg-destructive/10"
                    >
                      {decidingId === `${row.id}::reject`
                        ? copy.deciding
                        : copy.reject}
                    </Button>
                  </div>
                  {rowErrors[row.id] ? (
                    <p
                      className="text-xs text-destructive"
                      data-testid={`workforce-request-error-${row.id}`}
                    >
                      {rowErrors[row.id]}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
