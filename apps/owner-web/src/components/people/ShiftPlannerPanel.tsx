'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  HardHat,
  ShieldCheck,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  Button,
  FormField,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@borjie/design-system';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { shiftPlannerPanelStrings as M } from '@/i18n/strings/shift-planner-panel';
import { pickByLocale, type Locale } from '@/lib/locale-shared';
import {
  useShiftPlan,
  useShiftRoster,
  type Certification,
  type EquipmentKind,
  type RosterEquipment,
  type ShiftKind,
  type ShiftPlanRequest,
  type ShiftTaskInput,
  type TaskZone,
} from '@/lib/queries/shift-planner';

interface ShiftPlannerPanelProps {
  readonly locale?: 'sw' | 'en';
}

const SHIFT_KINDS: ReadonlyArray<ShiftKind> = ['morning', 'afternoon', 'night'];

function shiftKindLabel(kind: ShiftKind, isSw: boolean): string {
  return isSw ? M.shiftKind[kind].sw : M.shiftKind[kind].en;
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
      return 'border-danger/40 bg-danger-subtle text-danger';
    case 'medium':
      return 'border-warning/40 bg-warning-subtle text-warning';
    case 'low':
      return 'border-info/40 bg-info-subtle text-info';
    default:
      return 'border-border bg-surface text-muted-foreground';
  }
}

/**
 * Localized render of a compliance-rule status pill. A passing rule reads
 * "OK"/"Sawa"; a failing rule renders its severity word in the active
 * locale (never the raw English enum token), per the zero-mix canon.
 */
function complianceStatusLabel(
  pass: boolean,
  severity: string,
  isSw: boolean,
): string {
  if (pass) return isSw ? M.compliance.statusOk.sw : M.compliance.statusOk.en;
  const leaf = M.compliance.severity[severity as keyof typeof M.compliance.severity];
  if (leaf) return isSw ? leaf.sw : leaf.en;
  return isSw ? M.compliance.severityUnknown.sw : M.compliance.severityUnknown.en;
}

// ── Language-neutral planner projection (gateway `data.structured`) ─────
// The gateway returns stable enum keys + numeric parts so the cockpit can
// render these surfaces in the active locale (no English prose crosses the
// wire). We resolve the {en,sw} copy here via `pickByLocale`, composing the
// whole localized template (never concatenating across languages).

type RuleKey = keyof typeof M.rule;

interface StructuredUnassigned {
  readonly taskId: string;
  readonly reasonKey: 'no-certified-worker' | 'no-matching-equipment' | 'all-assigned';
  readonly certifications?: ReadonlyArray<Certification>;
  readonly equipmentKinds?: ReadonlyArray<EquipmentKind>;
}

interface StructuredRotationAlert {
  readonly workerId: string;
  readonly atISO: string;
  readonly rotationHours: number;
  readonly zone: TaskZone;
}

interface StructuredComplianceResult {
  readonly ruleKey: string;
  readonly pass: boolean;
  readonly severity: string;
  readonly affectedCount: number;
  readonly affectedWorkerIds: ReadonlyArray<string>;
}

interface StructuredBlockingFailure {
  readonly ruleKey: string;
  readonly severity: string;
  readonly affectedCount: number;
}

interface StructuredPlanner {
  readonly unassignedTasks: ReadonlyArray<StructuredUnassigned>;
  readonly rotationAlerts: ReadonlyArray<StructuredRotationAlert>;
  readonly compliance: {
    readonly results: ReadonlyArray<StructuredComplianceResult>;
    readonly blockingFailures: ReadonlyArray<StructuredBlockingFailure>;
  };
  readonly labelContext: {
    readonly ambientTemperatureC: number;
    readonly thresholds: {
      readonly maxShiftHours: number;
      readonly minRestHours: number;
      readonly maxConsecutiveDays: number;
      readonly undergroundMaxWeeklyHours: number;
      readonly hazardRotationHours: number;
      readonly heatStressTempC: number;
      readonly safetyBriefingMaxAgeHours: number;
    };
  };
}

/** Localized hazard-zone word (single-locale, never the raw enum token). */
function zoneLabel(zone: TaskZone, locale: Locale): string {
  const leaf = M.zone[zone];
  return leaf ? pickByLocale(locale, leaf) : zone;
}

type RosterFlagKey = keyof typeof M.rosterFlag;

/**
 * Resolve a gateway roster-honesty flag CODE to its label in the active
 * locale. The gateway emits stable UPPER_SNAKE codes (no English prose on the
 * wire); an unrecognized future code falls back to a visible single-locale
 * `unknown` label — never the other language's text (zero-mix canon).
 */
function rosterFlagLabel(code: string, locale: Locale): string {
  const leaf =
    code in M.rosterFlag
      ? M.rosterFlag[code as RosterFlagKey]
      : M.rosterFlag.unknown;
  return pickByLocale(locale, leaf);
}

/** Comma-joined, fully-localized certification list for a reason template. */
function certListLabel(
  certifications: ReadonlyArray<Certification>,
  locale: Locale,
): string {
  if (certifications.length === 0) {
    return pickByLocale(locale, M.unassignedReason.listEmpty);
  }
  return certifications
    .map((c) => {
      const leaf = M.certification[c];
      return leaf ? pickByLocale(locale, leaf) : c;
    })
    .join(', ');
}

/** Comma-joined, fully-localized equipment-kind list for a reason template. */
function equipmentListLabel(
  kinds: ReadonlyArray<EquipmentKind>,
  locale: Locale,
): string {
  if (kinds.length === 0) {
    return pickByLocale(locale, M.unassignedReason.listEmpty);
  }
  return kinds
    .map((k) => {
      const leaf = M.equipmentKind[k];
      return leaf ? pickByLocale(locale, leaf) : k;
    })
    .join(', ');
}

/** Compose the unfilled-task reason in the active locale. */
function unassignedReasonLabel(
  u: StructuredUnassigned,
  locale: Locale,
): string {
  if (u.reasonKey === 'no-certified-worker') {
    return pickByLocale(locale, M.unassignedReason['no-certified-worker']).replace(
      '{list}',
      certListLabel(u.certifications ?? [], locale),
    );
  }
  if (u.reasonKey === 'no-matching-equipment') {
    return pickByLocale(locale, M.unassignedReason['no-matching-equipment']).replace(
      '{list}',
      equipmentListLabel(u.equipmentKinds ?? [], locale),
    );
  }
  return pickByLocale(locale, M.unassignedReason['all-assigned']);
}

/** Compose the hazard-rotation alert line in the active locale. */
function rotationAlertLabel(
  r: StructuredRotationAlert,
  locale: Locale,
): string {
  return pickByLocale(locale, M.rotationAlert.template)
    .replace('{hours}', String(r.rotationHours))
    .replace('{zone}', zoneLabel(r.zone, locale));
}

/** Compose the OSHA rule label in the active locale (interpolated thresholds). */
function ruleLabelText(
  ruleKey: string,
  ctx: StructuredPlanner['labelContext'],
  locale: Locale,
): string {
  const rule = M.rule[ruleKey as RuleKey];
  if (!rule || !('label' in rule)) {
    return pickByLocale(locale, M.rule.unknownLabel);
  }
  const t = ctx.thresholds;
  return pickByLocale(locale, rule.label)
    .replace('{h1}', String(t.maxShiftHours))
    .replace('{h2}', String(t.minRestHours))
    .replace('{days}', String(t.maxConsecutiveDays))
    .replace('{wk}', String(t.undergroundMaxWeeklyHours))
    .replace('{temp}', String(t.heatStressTempC));
}

/** Compose the OSHA rule detail in the active locale (pass/fail + counts). */
function ruleDetailText(
  r: StructuredComplianceResult,
  ctx: StructuredPlanner['labelContext'],
  locale: Locale,
): string {
  const rule = M.rule[r.ruleKey as RuleKey];
  if (!rule || !('detailPass' in rule)) {
    return pickByLocale(locale, M.rule.unknownDetail);
  }
  if (r.pass) return pickByLocale(locale, rule.detailPass);
  return pickByLocale(locale, rule.detailFail)
    .replace('{n}', String(r.affectedCount))
    .replace('{ambient}', String(ctx.ambientTemperatureC));
}

/** Compose one blocking-failure line in the active locale. */
function blockingFailureLabel(
  f: StructuredBlockingFailure,
  ctx: StructuredPlanner['labelContext'],
  locale: Locale,
): string {
  const label = ruleLabelText(f.ruleKey, ctx, locale);
  // A blocking failure is always a FAIL; reuse the fail-detail composer.
  const detail = ruleDetailText(
    {
      ruleKey: f.ruleKey,
      pass: false,
      severity: f.severity,
      affectedCount: f.affectedCount,
      affectedWorkerIds: [],
    },
    ctx,
    locale,
  );
  return pickByLocale(locale, M.blockingFailure.template)
    .replace('{label}', label)
    .replace('{detail}', detail);
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
        label: isSw ? M.metrics.activeWorkersLabel.sw : M.metrics.activeWorkersLabel.en,
        value: String(roster.data?.counts.workers ?? 0),
        sub: isSw ? M.metrics.activeWorkersSub.sw : M.metrics.activeWorkersSub.en,
        icon: Users,
      },
      {
        label: isSw ? M.metrics.equipmentLabel.sw : M.metrics.equipmentLabel.en,
        value: String(roster.data?.counts.equipment ?? 0),
        sub: isSw ? M.metrics.equipmentSub.sw : M.metrics.equipmentSub.en,
        icon: Truck,
      },
      {
        label: isSw ? M.metrics.sitesLabel.sw : M.metrics.sitesLabel.en,
        value: String(roster.data?.counts.sites ?? 0),
        sub: isSw ? M.metrics.sitesSub.sw : M.metrics.sitesSub.en,
        icon: HardHat,
      },
      {
        label: isSw ? M.metrics.certLabel.sw : M.metrics.certLabel.en,
        value: `${certCoverage}%`,
        sub: isSw ? M.metrics.certSub.sw : M.metrics.certSub.en,
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
  // The gateway attaches a language-neutral `structured` projection (stable
  // keys + numeric parts) alongside the legacy English `plan` / `compliance`.
  // It is not in the shared query type yet (out-of-scope file), so read it
  // through a narrow local view — the cockpit renders ONLY from `structured`
  // for the rule/severity/reason/rotation/blocking surfaces.
  const structured = (result as unknown as { structured?: StructuredPlanner })
    ?.structured;
  const canPlan =
    Boolean(siteId) && workers.length > 0 && equipment.length > 0;

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={4} />

      {/* Roster honesty flags */}
      {(roster.data?.flags?.length ?? 0) > 0 ? (
        <div className="rounded-2xl border border-border bg-surface/30 px-5 py-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            {isSw ? M.provenance.title.sw : M.provenance.title.en}
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {(roster.data?.flags ?? []).map((flag, i) => (
              <li key={i} className="leading-relaxed">
                {rosterFlagLabel(flag, locale)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Plan controls */}
      <div className="rounded-2xl border border-border bg-surface/40 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 text-signal-500" />
          {isSw ? M.controls.title.sw : M.controls.title.en}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={isSw ? M.controls.site.sw : M.controls.site.en}>
            <Select
              {...(siteId ? { value: siteId } : {})}
              onValueChange={(value) => setSiteId(value)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={isSw ? M.controls.selectSite.sw : M.controls.selectSite.en}
                />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.mineral})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label={isSw ? M.controls.shiftKind.sw : M.controls.shiftKind.en}>
            <Select
              value={shiftKind}
              onValueChange={(value) => setShiftKind(value as ShiftKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {shiftKindLabel(k, isSw)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label={isSw ? M.controls.duration.sw : M.controls.duration.en}>
            <Input
              type="number"
              min={1}
              max={12}
              value={durationHours}
              onChange={(e) =>
                setDurationHours(Math.min(12, Math.max(1, Number(e.target.value) || 1)))
              }
            />
          </FormField>

          <FormField label={isSw ? M.controls.ambient.sw : M.controls.ambient.en}>
            <Input
              type="number"
              min={0}
              max={60}
              value={ambientC}
              onChange={(e) =>
                setAmbientC(Math.min(60, Math.max(0, Number(e.target.value) || 0)))
              }
            />
          </FormField>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={!canPlan}
            loading={plan.isPending}
            onClick={runPlan}
            leftIcon={<CalendarClock className="h-3.5 w-3.5" />}
            className="gap-2 bg-signal-500 text-background hover:bg-signal-400"
          >
            {isSw ? M.controls.runPlan.sw : M.controls.runPlan.en}
          </Button>
          {!canPlan ? (
            <span className="text-xs text-muted-foreground">
              {isSw ? M.controls.pickSiteHint.sw : M.controls.pickSiteHint.en}
            </span>
          ) : null}
        </div>
      </div>

      {roster.isError ? (
        <div className="rounded-2xl border border-danger/40 bg-danger-subtle px-5 py-4 text-xs text-danger">
          {isSw ? M.errors.rosterLoad.sw : M.errors.rosterLoad.en}
        </div>
      ) : null}

      {plan.isError ? (
        <div className="rounded-2xl border border-danger/40 bg-danger-subtle px-5 py-4 text-xs text-danger">
          {isSw ? M.errors.planUnsat.sw : M.errors.planUnsat.en}
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
                {isSw ? M.assignments.title.sw : M.assignments.title.en}
              </h2>
              <span className="font-mono text-xs text-muted-foreground">
                {result.plan.assignments.length}
              </span>
            </header>
            {result.plan.assignments.length === 0 ? (
              <div className="px-5 py-6 text-xs text-muted-foreground">
                {isSw ? M.assignments.none.sw : M.assignments.none.en}
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
                      <div className="mt-0.5 text-muted-foreground">
                        {isSw ? M.assignments.worker.sw : M.assignments.worker.en}:{' '}
                        {a.workerId} ·{' '}
                        {isSw ? M.assignments.equip.sw : M.assignments.equip.en}:{' '}
                        {a.equipmentId} ·{' '}
                        <span className="capitalize">{a.zone}</span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono ${
                        a.fatigueAtAssignment > 0.6
                          ? 'border-warning/40 bg-warning-subtle text-warning'
                          : 'border-success/40 bg-success-subtle text-success'
                      }`}
                    >
                      {isSw ? M.assignments.fatigue.sw : M.assignments.fatigue.en}{' '}
                      {a.fatigueAtAssignment.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {(structured?.unassignedTasks.length ?? 0) > 0 ? (
              <div className="border-t border-border px-5 py-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-warning">
                  <XCircle className="h-3.5 w-3.5" />
                  {isSw ? M.assignments.unfilled.sw : M.assignments.unfilled.en}
                </h3>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {(structured?.unassignedTasks ?? []).map((t) => (
                    <li key={t.taskId}>
                      <span className="font-medium text-muted-foreground">
                        {t.taskId}
                      </span>{' '}
                      &mdash; {unassignedReasonLabel(t, locale)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {(structured?.rotationAlerts.length ?? 0) > 0 ? (
              <div className="border-t border-border px-5 py-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-info">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {isSw ? M.assignments.rotationAlerts.sw : M.assignments.rotationAlerts.en}
                </h3>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {(structured?.rotationAlerts ?? []).map((r, i) => (
                    <li key={`${r.workerId}-${i}`}>
                      {rotationAlertLabel(r, locale)}
                    </li>
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
                {isSw ? M.compliance.title.sw : M.compliance.title.en}
              </h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-badge font-medium ${
                  result.compliance.pass
                    ? 'border-success/40 bg-success-subtle text-success'
                    : 'border-danger/40 bg-danger-subtle text-danger'
                }`}
              >
                {result.compliance.pass
                  ? isSw
                    ? M.compliance.pass.sw
                    : M.compliance.pass.en
                  : isSw
                    ? M.compliance.fail.sw
                    : M.compliance.fail.en}
              </span>
            </header>
            <ul className="divide-y divide-border/60">
              {(structured?.compliance.results ?? []).map((r) => (
                <li key={r.ruleKey} className="px-5 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {structured
                        ? ruleLabelText(r.ruleKey, structured.labelContext, locale)
                        : null}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono ${
                        r.pass
                          ? 'border-success/40 bg-success-subtle text-success'
                          : severityTone(r.severity)
                      }`}
                    >
                      {complianceStatusLabel(r.pass, r.severity, isSw)}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {structured
                      ? ruleDetailText(r, structured.labelContext, locale)
                      : null}
                  </div>
                </li>
              ))}
            </ul>
            {(structured?.compliance.blockingFailures.length ?? 0) > 0 ? (
              <div className="border-t border-border px-5 py-4">
                <h3 className="text-xs font-semibold text-danger">
                  {isSw ? M.compliance.blocking.sw : M.compliance.blocking.en}
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {(structured?.compliance.blockingFailures ?? []).map((f, i) => (
                    <li key={`${f.ruleKey}-${i}`}>
                      {structured
                        ? blockingFailureLabel(f, structured.labelContext, locale)
                        : null}
                    </li>
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
