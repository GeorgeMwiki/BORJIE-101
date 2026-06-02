'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Gauge,
  Loader2,
  Power,
  ShieldAlert,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

import {
  CONTROL_META,
  fetchControls,
  postToggle,
  type ControlMeta,
  type ControlRow,
  type ToggleResult,
} from './control-tower-api';

const HEALTH_KPI = [
  { label: 'Active tenants', value: '142', sub: 'Across all plans' },
  { label: 'Brain turns / min', value: '2.4k', sub: 'Last 5 min' },
  { label: 'Error budget burn', value: '12%', sub: 'Rolling 30 day' },
  { label: 'RLS denies / min', value: '0', sub: 'Healthy isolation' },
];

function CategoryIcon({ category }: { category: ControlMeta['category'] }) {
  if (category === 'kill') return <Power className="h-4 w-4 text-destructive" />;
  if (category === 'autonomy') return <Bot className="h-4 w-4 text-warning" />;
  return <Gauge className="h-4 w-4 text-signal-500" />;
}

/**
 * Control Tower client — cross-tenant ops surface, wired to REAL backend
 * controls.
 *
 * On mount it hydrates each toggle's live state from
 * `GET /api/platform/control-tower` (kill-switch / feature-flags / rate caps).
 * Flipping a toggle opens a four-eye confirmation modal and POSTs the change;
 * HIGH-impact controls (kill / autonomy) land as `pending_approval` and require
 * a second operator to approve before the platform state actually changes —
 * surfaced via the returned journal id. Every attempt is SOC2-audited server-
 * side on the hash-chained trail.
 */
export function ControlTowerClient(): JSX.Element {
  const [controls, setControls] = useState<ReadonlyArray<ControlRow>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ControlRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchControls();
      setControls(rows);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load controls');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onApplied = useCallback(
    (result: ToggleResult) => {
      setPending(null);
      if (result.status === 'pending_approval') {
        setNotice(
          `Change recorded and awaiting a second operator's approval` +
            (result.journalId ? ` (ref ${result.journalId}).` : '.'),
        );
      } else {
        setNotice('Change applied to live platform state.');
      }
      void refresh();
    },
    [refresh],
  );

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {HEALTH_KPI.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-border bg-surface/40 p-5"
          >
            <p className="text-tiny font-semibold uppercase tracking-eyebrow text-neutral-500">
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
          <h2 className="text-tiny font-semibold uppercase tracking-eyebrow text-neutral-500">
            Platform controls
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-tiny font-mono uppercase text-warning">
            <AlertTriangle className="h-3 w-3" />
            4-eye confirm required
          </span>
        </header>

        {notice ? (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-signal-500/40 bg-signal-500/10 px-4 py-3 text-xs text-signal-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" />
            <span>{notice}</span>
          </div>
        ) : null}
        {loadError ? (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Could not load live control state: {loadError}</span>
          </div>
        ) : null}

        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-surface/40">
          {loading && controls.length === 0 ? (
            <li className="flex items-center gap-2 px-5 py-6 text-xs text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading live platform state…
            </li>
          ) : null}
          {controls.map((control) => {
            const meta = CONTROL_META[control.id];
            if (!meta) return null;
            return (
              <li
                key={control.id}
                className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
              >
                <div className="flex flex-1 items-start gap-3 min-w-0">
                  <CategoryIcon category={meta.category} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-foreground">
                        {meta.title}
                      </h3>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-tiny font-mono uppercase tracking-widest ${
                          meta.category === 'kill'
                            ? 'border-destructive/40 bg-destructive/10 text-destructive'
                            : meta.category === 'autonomy'
                              ? 'border-warning/40 bg-warning/10 text-warning'
                              : 'border-info/40 bg-info/10 text-info'
                        }`}
                      >
                        {meta.riskLabel}
                      </span>
                    </div>
                    <p className="mt-1 max-w-2xl text-xs text-neutral-400">
                      {meta.description}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setPending(control);
                  }}
                  disabled={control.state === 'unknown'}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    control.state === 'on'
                      ? 'border-success/40 bg-success/10 text-success hover:bg-success/20'
                      : 'border-border bg-background text-neutral-300 hover:bg-surface'
                  }`}
                  aria-label={`Toggle ${meta.title}`}
                >
                  {control.state === 'on' ? (
                    <>
                      <ToggleRight className="h-3.5 w-3.5" />
                      On
                    </>
                  ) : control.state === 'off' ? (
                    <>
                      <ToggleLeft className="h-3.5 w-3.5" />
                      Off
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Unknown
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-signal-500/30 bg-signal-500/5 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-signal-500" />
          Audit footprint
        </h3>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-neutral-300">
          Every Control Tower action records to the hash-chained audit trail
          (append-only, tamper-evident) and emits a SOC2 security event. Toggle
          attempts include actor, timestamp, control id, blast-radius and the
          second-eye attestation. High-impact controls only change live platform
          state after a second operator approves.
        </p>
      </section>

      {pending ? (
        <FourEyeModal
          control={pending}
          onClose={() => setPending(null)}
          onApplied={onApplied}
        />
      ) : null}
    </div>
  );
}

interface FourEyeModalProps {
  readonly control: ControlRow;
  readonly onClose: () => void;
  readonly onApplied: (result: ToggleResult) => void;
}

function FourEyeModal({ control, onClose, onApplied }: FourEyeModalProps) {
  const meta = CONTROL_META[control.id];
  const desiredState = control.state === 'on' ? 'off' : 'on';
  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canConfirm = phrase === 'CONFIRM' && reason.trim().length >= 8;

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await postToggle({
        controlId: control.id,
        desiredState,
        reason: reason.trim(),
      });
      onApplied(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setSubmitting(false);
    }
  }, [control.id, desiredState, reason, onApplied]);

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
              Setting {(meta?.title ?? control.id).toLowerCase()} to{' '}
              <span className="font-mono uppercase text-foreground">
                {desiredState}
              </span>{' '}
              affects every tenant. Type the phrase and capture an operational
              reason; a second operator must approve high-impact changes before
              they take effect.
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
              Operational reason (min 8 chars — recorded on the audit trail)
            </span>
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. active incident #4821 — pausing all inference"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
            />
          </label>
          {error ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </p>
          ) : null}
        </div>

        <footer className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canConfirm || submitting}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold ${
              canConfirm && !submitting
                ? 'bg-warning text-background hover:bg-warning/90'
                : 'cursor-not-allowed bg-warning/30 text-background opacity-50'
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Applying…
              </>
            ) : (
              'Apply change'
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
