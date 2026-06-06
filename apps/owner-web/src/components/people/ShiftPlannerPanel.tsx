'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  HardHat,
  Loader2,
  ShieldCheck,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import {
  useShiftPlan,
  useShiftRoster,
  type EquipmentKind,
  type RosterEquipment,
  type ShiftKind,
  type ShiftPlanRequest,
  type ShiftTaskInput,
} from '@/lib/queries/shift-planner';

interface ShiftPlannerPanelProps {
  readonly locale?: 'sw' | 'en';
}

const SHIFT_KINDS: ReadonlyArray<ShiftKind> = ['morning', 'afternoon', 'night'];

function shiftKindLabel(kind: ShiftKind, isSw: boolean): string {
  if (isSw) {
    return kind === 'morning'
      ? 'Asubuhi'
      : kind === 'afternoon'
        ? 'Mchana'
        : 'Usiku';
  }
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Build a minimal, deterministic task list from the live equipment pool so
 * the owner can run a real plan against today's roster with one click. One
 * task per DISTINCT operational equipment kind, each requiring that kind +
 * (when known) the kind's default operator certification. This is an
 * honest pre-fill derived from real assets — the owner can refine it via
 * the planner API for bespoke task lists.
 */
function deriveTasksFromEquipment(
  equipment: ReadonlyArray<RosterEquipment>,
): ReadonlyArray<ShiftTaskInput> {
  const byKind = new Map<EquipmentKind, RosterEquipment>();
  for (const eq of equipment) {
    if (!byKind.has(eq.kind)) byKind.set(eq.kind, eq);
  }
  return Array.from(byKind.entries()).map(([kind, eq], index) => ({
    id: `task-${kind}-${index}`,
    zone: kind === 'lhd' ? 'underground' : 'surface-pit',
    requiredEquipment: [kind],
    requiredCertifications: [eq.requiredCertification],
    estimatedHours: 8,
  }));
}

function severityTone(severity: string): string {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'border-destructive/40 bg-destructive/10 text-destructive';
    case 'medium':
      return 'border-warning/40 bg-warning/10 text-warning';
    case 'low':
      return 'border-info/40 bg-info/10 text-info';
    default:
      return 'border-border bg-surface text-neutral-300';
  }
}

/**
 * Owner-cockpit shift planner surface.
 *
 * Pulls the REAL roster (employees / assets / sites) from
 * `/api/v1/mining/shift-planner/roster`, lets the owner pick a site +
 * shift kind + duration, and solves an OSHA-TZ-aware plan via
 * `/api/v1/mining/shift-planner/plan`. Renders the assignments, any
 * unfilled tasks with their reason, hazard-rotation alerts, and the full
 * OSHA-TZ compliance report (the evidence behind the plan).
 */
export function ShiftPlannerPanel({
  locale = 'en',
}: ShiftPlannerPanelProps): JSX.Element {
  const isSw = locale === 'sw';
  const [siteId, setSiteId] = useState<string>('');
  const [shiftKind, setShiftKind] = useState<ShiftKind>('morning');
  const [durationHours, setDurationHours] = useState<number>(8);
  const [ambientC, setAmbientC] = useState<number>(28);

  const roster = useShiftRoster(siteId || undefined);
  const plan = useShiftPlan();

  const workers = roster.data?.workers ?? [];
  const equipment = roster.data?.equipment ?? [];
  const sites = roster.data?.sites ?? [];

  const certCoverage = useMemo(() => {
    if (workers.length === 0) return 0;
    const withCert = workers.filter((w) => w.certifications.length > 0).length;
    return Math.round((withCert / workers.length) * 100);
  }, [workers]);

  const metrics = useMemo<readonly MetricTile[]>(
    () => [
      {
        label: isSw ? 'Wafanyakazi hai' : 'Active workers',
        value: String(roster.data?.counts.workers ?? 0),
        sub: isSw ? 'Wenye hadhi hai' : 'With active status',
        icon: Users,
      },
      {
        label: isSw ? 'Mitambo inayofanya kazi' : 'Operational equipment',
        value: String(roster.data?.counts.equipment ?? 0),
        sub: isSw ? 'Imepangwa kwa aina' : 'Mapped by planner kind',
        icon: Truck,
      },
      {
        label: isSw ? 'Maeneo' : 'Sites',
        value: String(roster.data?.counts.sites ?? 0),
        sub: isSw ? 'Yenye leseni hai' : 'Across the estate',
        icon: HardHat,
      },
      {
        label: isSw ? 'Vyeti vya wafanyakazi' : 'Cert coverage',
        value: `${certCoverage}%`,
        sub: isSw ? 'Wenye angalau cheti 1' : 'Workers with >=1 cert',
        icon: ShieldCheck,
        tone: certCoverage >= 50 ? ('success' as const) : ('warning' as const),
      },
    ],
    [roster.data, certCoverage, isSw],
  );

  function runPlan() {
    if (!siteId || workers.length === 0 || equipment.length === 0) return;
    const tasks = deriveTasksFromEquipment(equipment);
    const request: ShiftPlanRequest = {
      siteId,
      shiftStartISO: new Date().toISOString(),
      durationHours,
      shiftKind,
      workers,
      equipment,
      tasks,
      ambientTemperatureC: ambientC,
    };
    plan.mutate(request);
  }

  const result = plan.data;
  const canPlan =
    Boolean(siteId) && workers.length > 0 && equipment.length > 0;

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={4} />

      {/* Roster honesty flags */}
      {(roster.data?.flags?.length ?? 0) > 0 ? (
        <div className="rounded-2xl border border-border bg-surface/30 px-5 py-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            {isSw ? 'Maelezo ya data' : 'Data provenance notes'}
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-neutral-500">
            {(roster.data?.flags ?? []).map((flag, i) => (
              <li key={i} className="leading-relaxed">
                {flag}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Plan controls */}
      <div className="rounded-2xl border border-border bg-surface/40 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 text-signal-500" />
          {isSw ? 'Panga zamu' : 'Plan a shift'}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {isSw ? 'Eneo' : 'Site'}
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">
                {isSw ? '— Chagua eneo —' : '— Select site —'}
              </option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.mineral})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {isSw ? 'Aina ya zamu' : 'Shift kind'}
            <select
              value={shiftKind}
              onChange={(e) => setShiftKind(e.target.value as ShiftKind)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {SHIFT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {shiftKindLabel(k, isSw)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {isSw ? 'Muda (saa)' : 'Duration (hrs)'}
            <input
              type="number"
              min={1}
              max={12}
              value={durationHours}
              onChange={(e) =>
                setDurationHours(
                  Math.min(12, Math.max(1, Number(e.target.value) || 1)),
                )
              }
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {isSw ? 'Joto la nje (°C)' : 'Ambient (°C)'}
            <input
              type="number"
              min={0}
              max={60}
              value={ambientC}
              onChange={(e) =>
                setAmbientC(Math.min(60, Math.max(0, Number(e.target.value) || 0)))
              }
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={!canPlan || plan.isPending}
            onClick={runPlan}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {plan.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CalendarClock className="h-3.5 w-3.5" />
            )}
            {isSw ? 'Endesha mpango' : 'Run plan'}
          </button>
          {!canPlan ? (
            <span className="text-xs text-neutral-500">
              {isSw
                ? 'Chagua eneo lenye wafanyakazi na mitambo.'
                : 'Pick a site with workers and equipment.'}
            </span>
          ) : null}
        </div>
      </div>

      {roster.isError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-xs text-destructive">
          {isSw
            ? 'Imeshindwa kupakia ratiba ya wafanyakazi.'
            : 'Failed to load the live roster.'}
        </div>
      ) : null}

      {plan.isError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-xs text-destructive">
          {isSw
            ? 'Mpango haukuwezekana kwa vikwazo vilivyopo (uchovu / OSHA / mzigo).'
            : 'Plan was unsatisfiable under current constraints (fatigue / OSHA / load).'}
        </div>
      ) : null}

      {/* Plan result */}
      {result ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Assignments */}
          <div className="overflow-hidden rounded-2xl border border-border bg-surface/40 lg:col-span-2">
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                {isSw ? 'Migao' : 'Assignments'}
              </h2>
              <span className="font-mono text-xs text-neutral-400">
                {result.plan.assignments.length}
              </span>
            </header>
            {result.plan.assignments.length === 0 ? (
              <div className="px-5 py-6 text-xs text-neutral-500">
                {isSw ? 'Hakuna migao.' : 'No assignments produced.'}
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {result.plan.assignments.map((a) => (
                  <li
                    key={a.taskId}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">
                        {a.taskId}
                      </div>
                      <div className="mt-0.5 text-neutral-500">
                        {isSw ? 'Mfanyakazi' : 'Worker'}: {a.workerId} ·{' '}
                        {isSw ? 'Mtambo' : 'Equip'}: {a.equipmentId} ·{' '}
                        <span className="capitalize">{a.zone}</span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono ${
                        a.fatigueAtAssignment > 0.6
                          ? 'border-warning/40 bg-warning/10 text-warning'
                          : 'border-success/40 bg-success/10 text-success'
                      }`}
                    >
                      {isSw ? 'uchovu' : 'fatigue'}{' '}
                      {a.fatigueAtAssignment.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {result.plan.unassignedTasks.length > 0 ? (
              <div className="border-t border-border px-5 py-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-warning">
                  <XCircle className="h-3.5 w-3.5" />
                  {isSw ? 'Kazi zisizo na mtu' : 'Unfilled tasks'}
                </h3>
                <ul className="mt-2 space-y-1 text-xs text-neutral-500">
                  {result.plan.unassignedTasks.map((t) => (
                    <li key={t.taskId}>
                      <span className="font-medium text-neutral-300">
                        {t.taskId}
                      </span>{' '}
                      — {t.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.plan.rotationAlerts.length > 0 ? (
              <div className="border-t border-border px-5 py-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-info">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {isSw ? 'Tahadhari za mzunguko' : 'Rotation alerts'}
                </h3>
                <ul className="mt-2 space-y-1 text-xs text-neutral-500">
                  {result.plan.rotationAlerts.map((r, i) => (
                    <li key={`${r.workerId}-${i}`}>{r.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* OSHA compliance (evidence) */}
          <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldCheck className="h-4 w-4 text-signal-500" />
                {isSw ? 'Ufuasi wa OSHA-TZ' : 'OSHA-TZ compliance'}
              </h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-badge font-medium ${
                  result.compliance.pass
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                }`}
              >
                {result.compliance.pass
                  ? isSw
                    ? 'Imepita'
                    : 'PASS'
                  : isSw
                    ? 'Imeshindwa'
                    : 'FAIL'}
              </span>
            </header>
            <ul className="divide-y divide-border/60">
              {result.compliance.results.map((r) => (
                <li key={r.ruleId} className="px-5 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {r.ruleLabel}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono ${
                        r.pass
                          ? 'border-success/40 bg-success/10 text-success'
                          : severityTone(r.severity)
                      }`}
                    >
                      {r.pass ? 'ok' : r.severity}
                    </span>
                  </div>
                  <div className="mt-1 text-neutral-500">{r.detail}</div>
                </li>
              ))}
            </ul>
            {result.compliance.blockingFailures.length > 0 ? (
              <div className="border-t border-border px-5 py-4">
                <h3 className="text-xs font-semibold text-destructive">
                  {isSw ? 'Vizuizi vya idhini' : 'Blocking failures'}
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-neutral-500">
                  {result.compliance.blockingFailures.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
