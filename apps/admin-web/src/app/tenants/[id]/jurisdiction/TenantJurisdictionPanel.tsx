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
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

// ─── Single language per locale (canon): every user-facing string below
// resolves to the active locale via pickByLocale with full en/sw parity. ───

const TARGET_COUNTRY_LABEL = { en: 'Target country', sw: 'Nchi lengwa' } as const;

const STRINGS = {
  currentJurisdiction: { en: 'Current jurisdiction', sw: 'Mamlaka ya sasa' },
  country: { en: 'Country', sw: 'Nchi' },
  lockedAt: { en: 'Locked at', sw: 'Ilifungwa' },
  lockedBy: { en: 'Locked by', sw: 'Ilifungwa na' },
  neverLocked: { en: '(never locked)', sw: '(haijawahi kufungwa)' },
  systemBackfill: { en: '(system / backfill)', sw: '(mfumo / ujazo wa nyuma)' },
  proposeChange: { en: 'Propose change', sw: 'Pendekeza mabadiliko' },
  proposeIntro: {
    en: 'A second Borjie internal admin must approve before the change applies. You cannot approve your own proposal.',
    sw: 'Msimamizi wa pili wa ndani wa Borjie lazima aidhinishe kabla ya mabadiliko kuanza. Huwezi kuidhinisha pendekezo lako mwenyewe.',
  },
  reasonLabel: { en: 'Reason (min 8 chars)', sw: 'Sababu (herufi 8 au zaidi)' },
  verifiedWithLabel: {
    en: 'Verified with (call, ticket, in-person)',
    sw: 'Imethibitishwa kwa (simu, tikiti, ana kwa ana)',
  },
  proposeFailed: { en: 'Propose failed', sw: 'Kupendekeza kumeshindwa' },
  pendingProposals: { en: 'Pending proposals', sw: 'Mapendekezo yanayosubiri' },
  noPendingTitle: { en: 'No pending proposals', sw: 'Hakuna mapendekezo yanayosubiri' },
  noPendingBody: {
    en: 'No pending jurisdiction changes for this tenant.',
    sw: 'Hakuna mabadiliko ya mamlaka yanayosubiri kwa mteja huyu.',
  },
  proposedBy: { en: 'Proposed by', sw: 'Limependekezwa na' },
  reason: { en: 'Reason', sw: 'Sababu' },
  verifiedWith: { en: 'Verified with', sw: 'Imethibitishwa kwa' },
  decisionNote: { en: 'Decision note (optional)', sw: 'Maelezo ya uamuzi (hiari)' },
  approveFourEye: { en: 'Approve (four-eye)', sw: 'Idhinisha (macho-manne)' },
  reject: { en: 'Reject', sw: 'Kataa' },
  approveFailed: { en: 'Approve failed', sw: 'Kuidhinisha kumeshindwa' },
  rejectFailed: { en: 'Reject failed', sw: 'Kukataa kumeshindwa' },
  cannotApproveOwn: {
    en: 'You cannot approve your own proposal. The API enforces four-eye.',
    sw: 'Huwezi kuidhinisha pendekezo lako mwenyewe. API inatekeleza macho-manne.',
  },
  decisionHistory: { en: 'Decision history', sw: 'Historia ya maamuzi' },
  noHistoryTitle: { en: 'No decision history', sw: 'Hakuna historia ya maamuzi' },
  noHistoryBody: {
    en: 'No prior jurisdiction changes recorded for this tenant.',
    sw: 'Hakuna mabadiliko ya awali ya mamlaka yaliyorekodiwa kwa mteja huyu.',
  },
  by: { en: 'by', sw: 'na' },
  on: { en: 'on', sw: 'tarehe' },
  note: { en: 'Note', sw: 'Maelezo' },
  tenantNotFound: {
    en: 'Tenant not found or the admin token does not authorize this view.',
    sw: 'Mteja hakupatikana au tokeni ya msimamizi hairuhusu mwonekano huu.',
  },
} as const;

const STATUS_LABELS = {
  pending: { en: 'pending', sw: 'inasubiri' },
  approved: { en: 'approved', sw: 'imeidhinishwa' },
  rejected: { en: 'rejected', sw: 'imekataliwa' },
} as const;

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

function isJurisdictionState(body: unknown): body is JurisdictionState {
  return (
    typeof body === 'object' &&
    body !== null &&
    'current' in body &&
    typeof (body as { current?: unknown }).current === 'object' &&
    (body as { current?: unknown }).current !== null
  );
}

async function fetchJurisdiction(
  tenantId: string,
): Promise<JurisdictionState | null> {
  const res = await fetch(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/jurisdiction`,
    { credentials: 'include' },
  );
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as unknown;
  // The BFF proxy returns a `{ success:false }` degraded envelope (HTTP 200)
  // when the gateway is unreachable — guard so we render the honest error
  // state instead of crashing on undefined `current`/`pending`/`history`.
  if (!isJurisdictionState(body)) return null;
  return body;
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
  locale,
}: {
  readonly current: JurisdictionState['current'];
  readonly locale: Locale;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-display text-lg font-medium text-foreground">
        {pickByLocale(locale, STRINGS.currentJurisdiction)}
      </h2>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-mono text-tiny uppercase text-muted-foreground">
            {pickByLocale(locale, STRINGS.country)}
          </dt>
          <dd className="mt-1 text-base font-medium text-foreground">
            {current.countryCode}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-tiny uppercase text-muted-foreground">
            {pickByLocale(locale, STRINGS.lockedAt)}
          </dt>
          <dd className="mt-1 text-base text-foreground">
            {current.lockedAt
              ? new Date(current.lockedAt).toISOString()
              : pickByLocale(locale, STRINGS.neverLocked)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-tiny uppercase text-muted-foreground">
            {pickByLocale(locale, STRINGS.lockedBy)}
          </dt>
          <dd className="mt-1 text-base text-foreground">
            {current.lockedByUserId ?? pickByLocale(locale, STRINGS.systemBackfill)}
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
  locale,
}: {
  readonly tenantId: string;
  readonly currentCountry: string;
  readonly onProposed: () => void;
  readonly locale: Locale;
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
      setError(
        `${pickByLocale(locale, STRINGS.proposeFailed)} (${res.status}). ${res.message ?? ''}`,
      );
      return;
    }
    setReason('');
    setVerifiedWith('');
    onProposed();
  }, [tenantId, newCountryCode, reason, verifiedWith, onProposed, locale]);

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-display text-lg font-medium text-foreground">
        {pickByLocale(locale, STRINGS.proposeChange)}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {pickByLocale(locale, STRINGS.proposeIntro)}
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <FormField
          label={pickByLocale(locale, TARGET_COUNTRY_LABEL)}
          name="new-country"
          htmlFor="new-country"
        >
          <select
            id="new-country"
            value={newCountryCode}
            onChange={(e) => setNewCountryCode(e.target.value)}
            aria-label={pickByLocale(locale, TARGET_COUNTRY_LABEL)}
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
        <FormField
          label={pickByLocale(locale, STRINGS.reasonLabel)}
          name="reason"
          htmlFor="reason"
          required
        >
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <FormField
          label={pickByLocale(locale, STRINGS.verifiedWithLabel)}
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
          {pickByLocale(locale, STRINGS.proposeChange)}
        </Button>
      </form>
    </section>
  );
}

function PendingQueue({
  tenantId,
  pending,
  onDecided,
  locale,
}: {
  readonly tenantId: string;
  readonly pending: ReadonlyArray<ProposalRecord>;
  readonly onDecided: () => void;
  readonly locale: Locale;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-display text-lg font-medium text-foreground">
        {pickByLocale(locale, STRINGS.pendingProposals)}
      </h2>
      {pending.length === 0 ? (
        <div className="mt-3">
          <Empty
            title={pickByLocale(locale, STRINGS.noPendingTitle)}
            description={pickByLocale(locale, STRINGS.noPendingBody)}
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
                locale={locale}
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
  locale,
}: {
  readonly tenantId: string;
  readonly proposal: ProposalRecord;
  readonly onDecided: () => void;
  readonly locale: Locale;
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
        const failed =
          verdict === 'approve' ? STRINGS.approveFailed : STRINGS.rejectFailed;
        setError(
          `${pickByLocale(locale, failed)} (${res.status}). ${res.message ?? ''}`,
        );
        return;
      }
      onDecided();
    },
    [tenantId, proposal.proposalId, note, onDecided, locale],
  );

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-mono text-tiny uppercase text-signal-500">
          {proposal.proposalId}
        </p>
        <p className="text-tiny text-muted-foreground">
          {pickByLocale(locale, STRINGS.proposedBy)} {proposal.proposedByUserId} ·{' '}
          {new Date(proposal.proposedAt).toISOString()}
        </p>
      </div>
      <p className="text-base font-medium text-foreground">
        {proposal.fromCountryCode} → {proposal.toCountryCode}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="font-mono text-tiny uppercase text-muted-foreground">
            {pickByLocale(locale, STRINGS.reason)}
          </p>
          <p className="mt-1 whitespace-pre-line">{proposal.reason}</p>
        </div>
        <div>
          <p className="font-mono text-tiny uppercase text-muted-foreground">
            {pickByLocale(locale, STRINGS.verifiedWith)}
          </p>
          <p className="mt-1">{proposal.verifiedWith}</p>
        </div>
      </div>
      <FormField
        label={pickByLocale(locale, STRINGS.decisionNote)}
        name="decisionNote"
      >
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
          {pickByLocale(locale, STRINGS.approveFourEye)}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void decide('reject')}
        >
          {pickByLocale(locale, STRINGS.reject)}
        </Button>
      </div>
      <p className="text-tiny text-muted-foreground">
        {pickByLocale(locale, STRINGS.cannotApproveOwn)}
      </p>
    </div>
  );
}

function HistoryList({
  history,
  locale,
}: {
  readonly history: ReadonlyArray<ProposalRecord>;
  readonly locale: Locale;
}): JSX.Element {
  if (history.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-lg font-medium text-foreground">
          {pickByLocale(locale, STRINGS.decisionHistory)}
        </h2>
        <div className="mt-3">
          <Empty
            title={pickByLocale(locale, STRINGS.noHistoryTitle)}
            description={pickByLocale(locale, STRINGS.noHistoryBody)}
          />
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-display text-lg font-medium text-foreground">
        {pickByLocale(locale, STRINGS.decisionHistory)}
      </h2>
      <ul className="mt-4 space-y-3 text-sm">
        {history.map((p) => (
          <li
            key={p.proposalId}
            className="rounded-md border border-border bg-background p-3"
          >
            <p className="font-mono text-tiny uppercase text-signal-500">
              {p.proposalId} · {pickByLocale(locale, STATUS_LABELS[p.status])}
            </p>
            <p className="mt-1 font-medium text-foreground">
              {p.fromCountryCode} → {p.toCountryCode}
            </p>
            <p className="mt-1 text-tiny text-muted-foreground">
              {pickByLocale(locale, STRINGS.proposedBy)} {p.proposedByUserId}{' '}
              {pickByLocale(locale, STRINGS.on)}{' '}
              {new Date(p.proposedAt).toISOString()}
              {p.decidedByUserId && p.decidedAt ? (
                <>
                  {' '}
                  · {pickByLocale(locale, STATUS_LABELS[p.status])}{' '}
                  {pickByLocale(locale, STRINGS.by)} {p.decidedByUserId}{' '}
                  {pickByLocale(locale, STRINGS.on)}{' '}
                  {new Date(p.decidedAt).toISOString()}
                </>
              ) : null}
            </p>
            {p.decisionNote ? (
              <p className="mt-2 text-foreground">
                <span className="font-mono text-tiny uppercase text-muted-foreground">
                  {pickByLocale(locale, STRINGS.note)}
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
  initialLocale,
}: {
  readonly tenantId: string;
  readonly initialLocale?: Locale;
}): JSX.Element {
  // Seed from the server-resolved cookie (passed by the page) to avoid the
  // first-paint EN/SW split-brain; falls back to the cookie on mount when the
  // page has not seeded it yet.
  const locale = useLocale(initialLocale);
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
        {pickByLocale(locale, STRINGS.tenantNotFound)}
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <CurrentSnapshot current={state.current} locale={locale} />
      <ProposeForm
        tenantId={tenantId}
        currentCountry={state.current.countryCode}
        onProposed={reload}
        locale={locale}
      />
      <PendingQueue
        tenantId={tenantId}
        pending={state.pending}
        onDecided={reload}
        locale={locale}
      />
      <HistoryList history={state.history} locale={locale} />
    </div>
  );
}
