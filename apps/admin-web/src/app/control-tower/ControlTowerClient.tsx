'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Gauge,
  Power,
  ShieldAlert,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

type ControlState = 'on' | 'off' | 'pending';

interface ControlRow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly state: ControlState;
  readonly category: 'kill' | 'autonomy' | 'rate';
  readonly riskLabel: string;
}

const CONTROLS: ReadonlyArray<ControlRow> = [
  {
    id: 'global-kill',
    title: 'Global platform kill-switch',
    description:
      'Stops every brain inference, agent action, and outbound webhook in under 2 seconds. Use only for active incident response.',
    state: 'off',
    category: 'kill',
    riskLabel: 'Catastrophic - 4 eyes',
  },
  {
    id: 'jr-autonomy',
    title: 'Junior agent autonomy',
    description:
      'Junior agents may execute toolbox tasks without operator confirmation when this is on. Defaults to off in production.',
    state: 'on',
    category: 'autonomy',
    riskLabel: 'High - 4 eyes',
  },
  {
    id: 'predictions-mode',
    title: 'Predictions append mode',
    description:
      'Predictions append to rule-based decisions. Disabling forces all output through the deterministic policy gate.',
    state: 'on',
    category: 'autonomy',
    riskLabel: 'Medium - 4 eyes',
  },
  {
    id: 'webhook-rate-cap',
    title: 'Outbound webhook rate cap',
    description:
      'Hard ceiling on per-tenant outbound webhook throughput. Default 600 req/min/tenant.',
    state: 'on',
    category: 'rate',
    riskLabel: 'Low - 2 eyes',
  },
  {
    id: 'embed-throttle',
    title: 'Embeddings token throttle',
    description:
      'Throttles tenant embedding spend per minute. Off during corpus-bootstrap windows; otherwise on.',
    state: 'on',
    category: 'rate',
    riskLabel: 'Low - 2 eyes',
  },
];

const HEALTH_KPI = [
  { label: 'Active tenants', value: '142', sub: 'Across all plans' },
  { label: 'Brain turns / min', value: '2.4k', sub: 'Last 5 min' },
  { label: 'Error budget burn', value: '12%', sub: 'Rolling 30 day' },
  { label: 'RLS denies / min', value: '0', sub: 'Healthy isolation' },
];

function CategoryIcon({ category }: { category: ControlRow['category'] }) {
  if (category === 'kill') return <Power className="h-4 w-4 text-destructive" />;
  if (category === 'autonomy') return <Bot className="h-4 w-4 text-warning" />;
  return <Gauge className="h-4 w-4 text-signal-500" />;
}

/**
 * Control Tower client — cross-tenant ops surface.
 *
 * KPI tiles at top give an at-a-glance read of platform health.
 * Below, a dense control list groups by category (kill-switch /
 * autonomy / rate-limit). Every toggle opens a four-eye confirmation
 * modal because flipping these affects every tenant simultaneously.
 *
 * The modal copy makes the blast-radius explicit. No control flips
 * without a typed-confirmation phrase ("CONFIRM" or the control ID)
 * and an attestation from a second operator. The wire-up is local in
 * this preview; the production path will POST the change to the
 * platform-control service with two signed JWTs in the payload.
 */
export function ControlTowerClient(): JSX.Element {
  const [pending, setPending] = useState<ControlRow | null>(null);
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {HEALTH_KPI.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-border bg-surface/40 p-5"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
              {kpi.label}
            </p>
            <p className="mt-2 font-display text-3xl text-foreground">
              {kpi.value}
            </p>
            <p className="mt-1 text-xs text-neutral-400">{kpi.sub}</p>
          </div>
        ))}
      </div>

      <section>
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Platform controls
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[10px] font-mono uppercase text-warning">
            <AlertTriangle className="h-3 w-3" />
            4-eye confirm required
          </span>
        </header>
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-surface/40">
          {CONTROLS.map((control) => (
            <li
              key={control.id}
              className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
            >
              <div className="flex flex-1 items-start gap-3 min-w-0">
                <CategoryIcon category={control.category} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">
                      {control.title}
                    </h3>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest ${
                        control.category === 'kill'
                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : control.category === 'autonomy'
                            ? 'border-warning/40 bg-warning/10 text-warning'
                            : 'border-info/40 bg-info/10 text-info'
                      }`}
                    >
                      {control.riskLabel}
                    </span>
                  </div>
                  <p className="mt-1 max-w-2xl text-xs text-neutral-400">
                    {control.description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPending(control)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
                  control.state === 'on'
                    ? 'border-success/40 bg-success/10 text-success hover:bg-success/20'
                    : 'border-border bg-background text-neutral-300 hover:bg-surface'
                }`}
                aria-label={`Toggle ${control.title}`}
              >
                {control.state === 'on' ? (
                  <>
                    <ToggleRight className="h-3.5 w-3.5" />
                    On
                  </>
                ) : (
                  <>
                    <ToggleLeft className="h-3.5 w-3.5" />
                    Off
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-signal-500/30 bg-signal-500/5 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-signal-500" />
          Audit footprint
        </h3>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-neutral-300">
          Every Control Tower action records to the hash-chained audit
          trail (append-only, tamper-evident). Toggle attempts include
          actor, timestamp, control ID, blast-radius and the second-
          eye attestation. The audit log is queryable from the Audit
          surface or via the read-only NDJSON export.
        </p>
      </section>

      {pending ? (
        <FourEyeModal
          control={pending}
          onClose={() => setPending(null)}
          onConfirm={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}

interface FourEyeModalProps {
  readonly control: ControlRow;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

function FourEyeModal({ control, onClose, onConfirm }: FourEyeModalProps) {
  const [phrase, setPhrase] = useState('');
  const [attestor, setAttestor] = useState('');
  const canConfirm = phrase === 'CONFIRM' && attestor.trim().length > 2;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border pb-4">
          <ShieldAlert className="mt-1 h-5 w-5 text-warning" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              4-eye confirmation required
            </h3>
            <p className="mt-1 text-xs text-neutral-400">
              Toggling {control.title.toLowerCase()} affects every
              tenant. Type the phrase below and capture the second
              operator&apos;s name.
            </p>
          </div>
        </header>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-neutral-300">
              Type CONFIRM to proceed
            </span>
            <input
              type="text"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value.toUpperCase())}
              placeholder="CONFIRM"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-300">
              Second operator name
            </span>
            <input
              type="text"
              value={attestor}
              onChange={(event) => setAttestor(event.target.value)}
              placeholder="On-call SRE"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
            />
          </label>
        </div>

        <footer className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
              canConfirm
                ? 'bg-warning text-background hover:bg-warning/90'
                : 'cursor-not-allowed bg-warning/30 text-background opacity-50'
            }`}
          >
            Apply change
          </button>
        </footer>
      </div>
    </div>
  );
}
