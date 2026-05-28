'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Link as LinkIcon,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useChainOfCustody, type ChainStep } from '@/lib/queries/ops';

/**
 * Chain-of-custody visualiser — owner enters a parcelId, sees the
 * ordered pit-to-buyer timeline plus a hash-chain integrity badge.
 *
 * The timeline reads top-down. The audit chain is replayed in the
 * server response (`verification.ok` and `verification.brokenAt`) so
 * any tamper is rendered as a red badge with the broken step index.
 */
export function ChainOfCustodyShell() {
  const [input, setInput] = useState('');
  const [parcelId, setParcelId] = useState<string | null>(null);
  const { data, isLoading } = useChainOfCustody(parcelId);
  const payload = data?.data ?? null;
  const steps = payload?.steps ?? [];
  const verification = payload?.verification ?? null;

  return (
    <section className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParcelId(input.trim() || null);
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Parcel id (ore_parcels.id)"
            className="w-full rounded-xl border border-border bg-surface/40 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-neutral-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-xl bg-signal-500 px-4 py-2 text-sm font-medium text-background hover:bg-signal-500/90"
        >
          Trace
        </button>
      </form>

      {parcelId === null ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center text-sm text-neutral-400">
          Enter a parcel id to replay its custody chain.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-neutral-500">Loading chain</p>
      ) : steps.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center text-sm text-neutral-400">
          No custody steps yet for this parcel.
        </p>
      ) : (
        <>
          <VerificationBadge verification={verification} />
          <ol className="flex flex-col gap-3">
            {steps.map((s) => (
              <StepCard key={s.id} step={s} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function VerificationBadge({
  verification,
}: {
  readonly verification: { readonly ok: boolean; readonly brokenAt: number | null } | null;
}) {
  if (!verification) return null;
  if (verification.ok) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-sm text-success">
        <CheckCircle2 className="h-4 w-4" />
        Chain integrity verified — every step links to the previous hash.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <ShieldAlert className="h-4 w-4" />
      Chain broken at step {verification.brokenAt}. Investigate before
      trusting any downstream filing.
    </div>
  );
}

function StepCard({ step }: { readonly step: ChainStep }) {
  return (
    <li className="flex items-start gap-4 rounded-2xl border border-border bg-surface/40 p-5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal-500/10 text-xs font-semibold text-signal-500">
        {step.stepIndex}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-signal-500">
            {step.action.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-neutral-500">
            {new Date(step.happenedAt).toLocaleString()}
          </span>
        </div>
        <p className="mt-1 text-sm text-foreground">
          {step.location ?? 'Location unrecorded'}
          {step.containerSealNo ? ` · seal ${step.containerSealNo}` : ''}
        </p>
        {step.weightGrams ? (
          <p className="text-xs text-neutral-400">
            {step.weightGrams} g
            {step.gradePct ? ` · ${step.gradePct}%` : ''}
          </p>
        ) : null}
        <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono text-neutral-500">
          <LinkIcon className="h-3 w-3" />
          {step.auditHashId.slice(0, 12)}
        </p>
      </div>
    </li>
  );
}
