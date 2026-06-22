'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Skeleton,
  Alert,
  Empty,
  FormField,
  Input,
  Textarea,
} from '@borjie/design-system';
import { getCsrfHeaders } from '@/lib/csrf';

// ─── Allowed target countries (mirror of JC-7 route enum) ─────────────

const ALLOWED_TARGET_COUNTRIES = [
  { code: 'TZ', label: 'Tanzania' },
  { code: 'KE', label: 'Kenya' },
  { code: 'UG', label: 'Uganda' },
  { code: 'NG', label: 'Nigeria' },
  { code: 'ZA', label: 'South Africa' },
  { code: 'AU', label: 'Australia' },
  { code: 'CL', label: 'Chile' },
  { code: 'ID', label: 'Indonesia' },
  { code: 'RW', label: 'Rwanda' },
  { code: 'BI', label: 'Burundi' },
  { code: 'MZ', label: 'Mozambique' },
  { code: 'NA', label: 'Namibia' },
  { code: 'ZW', label: 'Zimbabwe' },
] as const;

// ─── Types ────────────────────────────────────────────────────────────

interface ProposalRecord {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly fromCountryCode: string;
  readonly toCountryCode: string;
  readonly reason: string;
  readonly verifiedWith: string;
  readonly proposedByUserId: string;
  readonly proposedAt: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly decidedByUserId?: string;
  readonly decidedAt?: string;
  readonly decisionNote?: string;
}

interface JurisdictionState {
  readonly current: {
    readonly countryCode: string;
    readonly lockedAt: string | null;
    readonly lockedByUserId: string | null;
  };
  readonly pending: ReadonlyArray<ProposalRecord>;
  readonly history: ReadonlyArray<ProposalRecord>;
}

// ─── Fetch helpers (api-gateway loopback through the BFF) ─────────────

async function fetchJurisdiction(
  tenantId: string,
): Promise<JurisdictionState | null> {
  const res = await fetch(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/jurisdiction`,
    { credentials: 'include' },
  );
  if (!res.ok) return null;
  return (await res.json()) as JurisdictionState;
}

async function postPropose(
  tenantId: string,
  body: {
    newCountryCode: string;
    reason: string;
    verifiedWith: string;
  },
): Promise<{ ok: boolean; status: number; message?: string }> {
  const res = await fetch(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/jurisdiction`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
      body: JSON.stringify(body),
    },
  );
  return {
    ok: res.ok,
    status: res.status,
    ...(res.ok ? {} : { message: await res.text() }),
  };
}

async function postDecision(
  tenantId: string,
  proposalId: string,
  decision: 'approve' | 'reject',
  decisionNote?: string,
): Promise<{ ok: boolean; status: number; message?: string }> {
  const res = await fetch(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/jurisdiction/${encodeURIComponent(
      proposalId,
    )}/${decision}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
      body: JSON.stringify(decisionNote ? { decisionNote } : {}),
    },
  );
  return {
    ok: res.ok,
    status: res.status,
    ...(res.ok ? {} : { message: await res.text() }),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────

function CurrentSnapshot({
  current,
}: {
  readonly current: JurisdictionState['current'];
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-display text-lg font-medium text-foreground">
        Current jurisdiction
      </h2>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-mono text-tiny uppercase text-muted-foreground">
            Country
          </dt>
          <dd className="mt-1 text-base font-medium text-foreground">
            {current.countryCode}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-tiny uppercase text-muted-foreground">
            Locked at
          </dt>
          <dd className="mt-1 text-base text-foreground">
            {current.lockedAt
              ? new Date(current.lockedAt).toISOString()
              : '— (never locked)'}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-tiny uppercase text-muted-foreground">
            Locked by
          </dt>
          <dd className="mt-1 text-base text-foreground">
            {current.lockedByUserId ?? '— (system / backfill)'}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ProposeForm({
  tenantId,
  currentCountry,
  onProposed,
}: {
  readonly tenantId: string;
  readonly currentCountry: string;
  readonly onProposed: () => void;
}): JSX.Element {
  const [newCountryCode, setNewCountryCode] = useState<string>(
    ALLOWED_TARGET_COUNTRIES.find((c) => c.code !== currentCountry)?.code ?? 'KE',
  );
  const [reason, setReason] = useState('');
  const [verifiedWith, setVerifiedWith] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !submitting &&
    reason.trim().length >= 8 &&
    verifiedWith.trim().length >= 2 &&
    newCountryCode !== currentCountry;

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const res = await postPropose(tenantId, {
      newCountryCode,
      reason: reason.trim(),
      verifiedWith: verifiedWith.trim(),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(`Propose failed (${res.status}). ${res.message ?? ''}`);
      return;
    }
    setReason('');
    setVerifiedWith('');
    onProposed();
  }, [tenantId, newCountryCode, reason, verifiedWith, onProposed]);

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-display text-lg font-medium text-foreground">
        Propose change
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        A second Borjie internal admin must approve before the change applies.
        You cannot approve your own proposal.
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <FormField label="Target country" name="new-country" htmlFor="new-country">
          <select
            id="new-country"
            value={newCountryCode}
            onChange={(e) => setNewCountryCode(e.target.value)}
            aria-label="Target country"
            className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {ALLOWED_TARGET_COUNTRIES.filter(
              (c) => c.code !== currentCountry,
            ).map((c) => (
              <option key={c.code} value={c.code}>
                {c.label} ({c.code})
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Reason (min 8 chars)" name="reason" htmlFor="reason" required>
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <FormField
          label="Verified with (call, ticket, in-person)"
          name="verifiedWith"
          htmlFor="verifiedWith"
          required
        >
          <Input
            id="verifiedWith"
            type="text"
            value={verifiedWith}
            onChange={(e) => setVerifiedWith(e.target.value)}
          />
        </FormField>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Button type="submit" disabled={!canSubmit} loading={submitting}>
          Propose change
        </Button>
      </form>
    </section>
  );
}

function PendingQueue({
  tenantId,
  pending,
  onDecided,
}: {
  readonly tenantId: string;
  readonly pending: ReadonlyArray<ProposalRecord>;
  readonly onDecided: () => void;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-display text-lg font-medium text-foreground">
        Pending proposals
      </h2>
      {pending.length === 0 ? (
        <div className="mt-3">
          <Empty
            title="No pending proposals"
            description="No pending jurisdiction changes for this tenant."
          />
        </div>
      ) : (
        <ul className="mt-4 space-y-4">
          {pending.map((p) => (
            <li
              key={p.proposalId}
              className="rounded-md border border-border bg-background p-4"
            >
              <ProposalRow
                tenantId={tenantId}
                proposal={p}
                onDecided={onDecided}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProposalRow({
  tenantId,
  proposal,
  onDecided,
}: {
  readonly tenantId: string;
  readonly proposal: ProposalRecord;
  readonly onDecided: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    async (verdict: 'approve' | 'reject') => {
      setBusy(true);
      setError(null);
      const res = await postDecision(
        tenantId,
        proposal.proposalId,
        verdict,
        note.trim().length > 0 ? note.trim() : undefined,
      );
      setBusy(false);
      if (!res.ok) {
        setError(`${verdict} failed (${res.status}). ${res.message ?? ''}`);
        return;
      }
      onDecided();
    },
    [tenantId, proposal.proposalId, note, onDecided],
  );

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-mono text-tiny uppercase text-signal-500">
          {proposal.proposalId}
        </p>
        <p className="text-tiny text-muted-foreground">
          Proposed by {proposal.proposedByUserId} ·{' '}
          {new Date(proposal.proposedAt).toISOString()}
        </p>
      </div>
      <p className="text-base font-medium text-foreground">
        {proposal.fromCountryCode} → {proposal.toCountryCode}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="font-mono text-tiny uppercase text-muted-foreground">
            Reason
          </p>
          <p className="mt-1 whitespace-pre-line">{proposal.reason}</p>
        </div>
        <div>
          <p className="font-mono text-tiny uppercase text-muted-foreground">
            Verified with
          </p>
          <p className="mt-1">{proposal.verifiedWith}</p>
        </div>
      </div>
      <FormField label="Decision note (optional)" name="decisionNote">
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => void decide('approve')}
        >
          Approve (four-eye)
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void decide('reject')}
        >
          Reject
        </Button>
      </div>
      <p className="text-tiny text-muted-foreground">
        You cannot approve your own proposal — the API enforces four-eye.
      </p>
    </div>
  );
}

function HistoryList({
  history,
}: {
  readonly history: ReadonlyArray<ProposalRecord>;
}): JSX.Element {
  if (history.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-lg font-medium text-foreground">
          Decision history
        </h2>
        <div className="mt-3">
          <Empty
            title="No decision history"
            description="No prior jurisdiction changes recorded for this tenant."
          />
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-display text-lg font-medium text-foreground">
        Decision history
      </h2>
      <ul className="mt-4 space-y-3 text-sm">
        {history.map((p) => (
          <li
            key={p.proposalId}
            className="rounded-md border border-border bg-background p-3"
          >
            <p className="font-mono text-tiny uppercase text-signal-500">
              {p.proposalId} · {p.status}
            </p>
            <p className="mt-1 font-medium text-foreground">
              {p.fromCountryCode} → {p.toCountryCode}
            </p>
            <p className="mt-1 text-tiny text-muted-foreground">
              Proposed by {p.proposedByUserId} on{' '}
              {new Date(p.proposedAt).toISOString()}
              {p.decidedByUserId && p.decidedAt ? (
                <>
                  {' '}
                  · {p.status} by {p.decidedByUserId} on{' '}
                  {new Date(p.decidedAt).toISOString()}
                </>
              ) : null}
            </p>
            {p.decisionNote ? (
              <p className="mt-2 text-foreground">
                <span className="font-mono text-tiny uppercase text-muted-foreground">
                  Note
                </span>
                : {p.decisionNote}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Panel container ──────────────────────────────────────────────────

export function TenantJurisdictionPanel({
  tenantId,
}: {
  readonly tenantId: string;
}): JSX.Element {
  const [state, setState] = useState<JurisdictionState | null | undefined>(
    undefined,
  );

  const reload = useCallback(() => {
    setState(undefined);
    void fetchJurisdiction(tenantId).then((next) => setState(next ?? null));
  }, [tenantId]);

  useMemo(() => {
    reload();
  }, [reload]);

  if (state === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-lg border border-border" />
        <Skeleton className="h-64 w-full rounded-lg border border-border" />
      </div>
    );
  }
  if (state === null) {
    return (
      <Alert variant="error">
        Tenant not found or the admin token does not authorize this view.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <CurrentSnapshot current={state.current} />
      <ProposeForm
        tenantId={tenantId}
        currentCountry={state.current.countryCode}
        onProposed={reload}
      />
      <PendingQueue
        tenantId={tenantId}
        pending={state.pending}
        onDecided={reload}
      />
      <HistoryList history={state.history} />
    </div>
  );
}
