'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Skeleton,
  Alert,
  Modal,
  ModalBody,
  ModalFooter,
  FormField,
  Input,
} from '@borjie/design-system';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Gauge,
  Power,
  ShieldAlert,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import {
  CONTROL_META,
  fetchControls,
  postToggle,
  type ControlMeta,
  type ControlRow,
  type ToggleResult,
} from './control-tower-api';

const S = {
  loadFailed: { en: 'Failed to load controls', sw: 'Imeshindwa kupakia vidhibiti' },
  toggleFailed: { en: 'Toggle failed', sw: 'Kubadilisha kumeshindwa' },
  pendingApproval: {
    en: "Change recorded and awaiting a second operator's approval",
    sw: 'Mabadiliko yamerekodiwa na yanasubiri idhini ya mendeshaji wa pili',
  },
  applied: {
    en: 'Change applied to live platform state.',
    sw: 'Mabadiliko yametumika kwenye hali hai ya jukwaa.',
  },
  ref: { en: 'ref', sw: 'kumb.' },
  activeTenants: { en: 'Active tenants', sw: 'Wateja hai' },
  brainTurns: { en: 'Brain turns / min', sw: 'Mizunguko ya ubongo / dakika' },
  errorBudget: { en: 'Error budget burn', sw: 'Mwako wa bajeti ya hitilafu' },
  rlsDenies: { en: 'RLS denies / min', sw: 'Vikatazo vya RLS / dakika' },
  loadingShort: { en: 'Loading…', sw: 'Inapakia…' },
  acrossPlans: { en: 'Across all plans', sw: 'Katika mipango yote' },
  sinceStart: { en: 'Since gateway start', sw: 'Tangu kuanza kwa lango' },
  errorRate: { en: 'Brain turn error rate', sw: 'Kiwango cha hitilafu za ubongo' },
  healthyIsolation: { en: 'Healthy isolation', sw: 'Utengaji wenye afya' },
  checkIsolation: { en: 'Check isolation', sw: 'Angalia utengaji' },
  metricsUnavailable: { en: 'Metrics unavailable', sw: 'Vipimo havipatikani' },
  platformControls: { en: 'Platform controls', sw: 'Vidhibiti vya jukwaa' },
  fourEyeRequired: { en: '4-eye confirm required', sw: 'Uthibitisho wa macho-4 unahitajika' },
  couldNotLoad: {
    en: 'Could not load live control state',
    sw: 'Imeshindwa kupakia hali hai ya udhibiti',
  },
  loadingLive: {
    en: 'Loading live platform state…',
    sw: 'Inapakia hali hai ya jukwaa…',
  },
  on: { en: 'On', sw: 'Imewashwa' },
  off: { en: 'Off', sw: 'Imezimwa' },
  unknown: { en: 'Unknown', sw: 'Haijulikani' },
  auditFootprint: { en: 'Audit footprint', sw: 'Alama ya ukaguzi' },
  auditBody: {
    en: 'Every Control Tower action records to the hash-chained audit trail (append-only, tamper-evident) and emits a SOC2 security event. Toggle attempts include actor, timestamp, control id, blast-radius and the second-eye attestation. High-impact controls only change live platform state after a second operator approves.',
    sw: 'Kila kitendo cha Mnara wa Udhibiti hurekodiwa kwenye njia ya ukaguzi ya mnyororo-heshi (ya kuongeza-tu, inayodhihirisha uchakachuaji) na hutoa tukio la usalama la SOC2. Majaribio ya kubadilisha yanajumuisha mtendaji, muhuri wa muda, kitambulisho cha kidhibiti, eneo-athari na uthibitisho wa jicho-la-pili. Vidhibiti vyenye athari kubwa hubadilisha hali hai ya jukwaa tu baada ya mendeshaji wa pili kuidhinisha.',
  },
  fourEyeTitle: {
    en: '4-eye confirmation required',
    sw: 'Uthibitisho wa macho-4 unahitajika',
  },
  toggle: { en: 'Toggle', sw: 'Badilisha' },
  affectsTenants: {
    en: 'affects every tenant. Type the phrase and capture an operational reason; a second operator must approve high-impact changes before they take effect.',
    sw: 'huathiri kila mteja. Andika kifungu na uweke sababu ya kiutendaji; mendeshaji wa pili lazima aidhinishe mabadiliko yenye athari kubwa kabla hayajaanza kutumika.',
  },
  setting: { en: 'Setting', sw: 'Kuweka' },
  to: { en: 'to', sw: 'kuwa' },
  typeConfirm: { en: 'Type CONFIRM to proceed', sw: 'Andika CONFIRM kuendelea' },
  opReason: {
    en: 'Operational reason (min 8 chars — recorded on the audit trail)',
    sw: 'Sababu ya kiutendaji (herufi 8+ — inarekodiwa kwenye njia ya ukaguzi)',
  },
  cancel: { en: 'Cancel', sw: 'Ghairi' },
  applyChange: { en: 'Apply change', sw: 'Tekeleza mabadiliko' },
} as const;

interface PlatformKpi {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
}

function kpiFallback(locale: Locale): ReadonlyArray<PlatformKpi> {
  const loading = pickByLocale(locale, S.loadingShort);
  return [
    { label: pickByLocale(locale, S.activeTenants), value: '—', sub: loading },
    { label: pickByLocale(locale, S.brainTurns), value: '—', sub: loading },
    { label: pickByLocale(locale, S.errorBudget), value: '—', sub: loading },
    { label: pickByLocale(locale, S.rlsDenies), value: '—', sub: loading },
  ];
}

interface CounterSnapshot {
  readonly name: string;
  readonly value: number;
}

interface GaugeSnapshot {
  readonly name: string;
  readonly value: number;
}

interface MetricsSnapshot {
  readonly uptimeSeconds: number;
  readonly counters: ReadonlyArray<CounterSnapshot>;
  readonly gauges: ReadonlyArray<GaugeSnapshot>;
}

function metricsGatewayUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    const trimmed = configured.replace(/\/$/, '');
    const base = trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
    return `${base}/metrics`;
  }
  return '/api/v1/metrics';
}

function sumCounter(snap: MetricsSnapshot, name: string): number {
  return snap.counters
    .filter((c) => c.name === name)
    .reduce((acc, c) => acc + c.value, 0);
}

function gaugeValue(snap: MetricsSnapshot, name: string): number | null {
  const g = snap.gauges.find((g) => g.name === name);
  return g !== undefined ? g.value : null;
}

async function fetchPlatformKpis(
  locale: Locale,
): Promise<ReadonlyArray<PlatformKpi>> {
  // Source 1: /api/platform/overview — carries activeTenants (real DB count)
  // Source 2: gateway GET /api/v1/metrics (MetricsSnapshot) — carries the
  //   brain turn counters + RLS deny gauge that overview never emits.
  // Both fetches run in parallel; each degrades independently to '—'.
  const [overviewRes, metricsRes] = await Promise.allSettled([
    fetch('/api/platform/overview', { cache: 'no-store' }),
    fetch(metricsGatewayUrl(), {
      cache: 'no-store',
      credentials: 'include',
      headers: (() => {
        const token =
          typeof window !== 'undefined'
            ? window.sessionStorage.getItem('platform_token')
            : null;
        return token ? { Authorization: `Bearer ${token}` } : {};
      })(),
    }),
  ]);

  // --- active tenants from overview ---
  let activeTenants: number | undefined;
  if (overviewRes.status === 'fulfilled' && overviewRes.value.ok) {
    try {
      const body = (await overviewRes.value.json()) as {
        success?: boolean;
        data?: { activeTenants?: number };
      };
      if (body.success && body.data?.activeTenants !== undefined) {
        activeTenants = body.data.activeTenants;
      }
    } catch {
      // degrade gracefully
    }
  }

  // --- brain turns, error budget, RLS denies from MetricsSnapshot ---
  let brainTurnsPerMin: number | undefined;
  let errorBudgetBurnPct: number | undefined;
  let rlsDeniesPerMin: number | undefined;

  if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
    try {
      const body = (await metricsRes.value.json()) as {
        success?: boolean;
        data?: MetricsSnapshot;
      };
      if (body.success && body.data) {
        const snap = body.data;
        // brain.turn.total counter / uptime in seconds → turns per minute
        const totalTurns = sumCounter(snap, 'brain.turn.total');
        if (snap.uptimeSeconds > 0) {
          brainTurnsPerMin =
            Math.round((totalTurns / snap.uptimeSeconds) * 60 * 10) / 10;
        }
        // error budget burn: (error turns / total turns) × 100 if available,
        // else derive from rls.deny gauge as a proxy for isolation pressure.
        const errorTurns = sumCounter(snap, 'brain.turn.error.total');
        if (totalTurns > 0) {
          errorBudgetBurnPct = Math.round((errorTurns / totalTurns) * 100 * 10) / 10;
        }
        // RLS denies per minute — exposed as a gauge 'rls.deny.per_min' or
        // computed from the 'rls.deny.total' counter.
        const rlsDenyGauge = gaugeValue(snap, 'rls.deny.per_min');
        if (rlsDenyGauge !== null) {
          rlsDeniesPerMin = rlsDenyGauge;
        } else {
          const rlsDenyTotal = sumCounter(snap, 'rls.deny.total');
          if (snap.uptimeSeconds > 0) {
            rlsDeniesPerMin =
              Math.round((rlsDenyTotal / snap.uptimeSeconds) * 60 * 10) / 10;
          }
        }
      }
    } catch {
      // degrade gracefully
    }
  }

  return [
    {
      label: pickByLocale(locale, S.activeTenants),
      value: activeTenants !== undefined ? String(activeTenants) : '—',
      sub: pickByLocale(locale, S.acrossPlans),
    },
    {
      label: pickByLocale(locale, S.brainTurns),
      value:
        brainTurnsPerMin !== undefined
          ? brainTurnsPerMin >= 1000
            ? `${(brainTurnsPerMin / 1000).toFixed(1)}k`
            : String(brainTurnsPerMin)
          : '—',
      sub: pickByLocale(locale, S.sinceStart),
    },
    {
      label: pickByLocale(locale, S.errorBudget),
      value:
        errorBudgetBurnPct !== undefined
          ? `${errorBudgetBurnPct.toFixed(1)}%`
          : '—',
      sub: pickByLocale(locale, S.errorRate),
    },
    {
      label: pickByLocale(locale, S.rlsDenies),
      value: rlsDeniesPerMin !== undefined ? String(rlsDeniesPerMin) : '—',
      sub:
        rlsDeniesPerMin === 0
          ? pickByLocale(locale, S.healthyIsolation)
          : rlsDeniesPerMin !== undefined
            ? pickByLocale(locale, S.checkIsolation)
            : pickByLocale(locale, S.metricsUnavailable),
    },
  ];
}

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
  const locale = useLocale();
  const [controls, setControls] = useState<ReadonlyArray<ControlRow>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ControlRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [healthKpis, setHealthKpis] = useState<ReadonlyArray<PlatformKpi>>(() =>
    kpiFallback(locale),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, kpis] = await Promise.all([
        fetchControls(),
        fetchPlatformKpis(locale),
      ]);
      setControls(rows);
      setHealthKpis(kpis);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : pickByLocale(locale, S.loadFailed),
      );
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onApplied = useCallback(
    (result: ToggleResult) => {
      setPending(null);
      if (result.status === 'pending_approval') {
        setNotice(
          pickByLocale(locale, S.pendingApproval) +
            (result.journalId
              ? ` (${pickByLocale(locale, S.ref)} ${result.journalId}).`
              : '.'),
        );
      } else {
        setNotice(pickByLocale(locale, S.applied));
      }
      void refresh();
    },
    [refresh, locale],
  );

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {healthKpis.map((kpi) => (
          <Card key={kpi.label} className="rounded-2xl p-5">
            <p className="text-tiny font-semibold uppercase tracking-eyebrow text-muted-foreground">
              {kpi.label}
            </p>
            <p className="mt-2 font-display text-3xl text-foreground">
              {kpi.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{kpi.sub}</p>
          </Card>
        ))}
      </div>

      <section>
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-tiny font-semibold uppercase tracking-eyebrow text-muted-foreground">
            {pickByLocale(locale, S.platformControls)}
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning-subtle px-2.5 py-0.5 text-tiny font-mono uppercase text-warning">
            <AlertTriangle className="h-3 w-3" />
            {pickByLocale(locale, S.fourEyeRequired)}
          </span>
        </header>

        {notice ? (
          <Alert variant="success" className="mb-3">
            <span className="inline-flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              {notice}
            </span>
          </Alert>
        ) : null}
        {loadError ? (
          <Alert variant="error" className="mb-3">
            {pickByLocale(locale, S.couldNotLoad)}: {loadError}
          </Alert>
        ) : null}

        {loading && controls.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-surface-sunken">
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
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
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
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                    control.state === 'on'
                      ? 'border-success/40 bg-success-subtle text-success hover:bg-success/20'
                      : 'border-border bg-background text-muted-foreground hover:bg-surface-sunken'
                  }`}
                  aria-label={`${pickByLocale(locale, S.toggle)} ${meta.title}`}
                >
                  {control.state === 'on' ? (
                    <>
                      <ToggleRight className="h-3.5 w-3.5" />
                      {pickByLocale(locale, S.on)}
                    </>
                  ) : control.state === 'off' ? (
                    <>
                      <ToggleLeft className="h-3.5 w-3.5" />
                      {pickByLocale(locale, S.off)}
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {pickByLocale(locale, S.unknown)}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        )}
      </section>

      <section className="rounded-2xl border border-info/30 bg-info-subtle p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-info" />
          {pickByLocale(locale, S.auditFootprint)}
        </h3>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {pickByLocale(locale, S.auditBody)}
        </p>
      </section>

      {pending ? (
        <FourEyeModal
          control={pending}
          locale={locale}
          onClose={() => setPending(null)}
          onApplied={onApplied}
        />
      ) : null}
    </div>
  );
}

interface FourEyeModalProps {
  readonly control: ControlRow;
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onApplied: (result: ToggleResult) => void;
}

function FourEyeModal({ control, locale, onClose, onApplied }: FourEyeModalProps) {
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
      setError(
        err instanceof Error ? err.message : pickByLocale(locale, S.toggleFailed),
      );
    } finally {
      setSubmitting(false);
    }
  }, [control.id, desiredState, reason, onApplied, locale]);

  return (
    <Modal
      open
      onClose={onClose}
      title={pickByLocale(locale, S.fourEyeTitle)}
      size="lg"
    >
      <ModalBody className="space-y-4">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
          {pickByLocale(locale, S.setting)}{' '}
          {(meta?.title ?? control.id).toLowerCase()}{' '}
          {pickByLocale(locale, S.to)}{' '}
          <span className="font-mono uppercase text-foreground">
            {desiredState}
          </span>{' '}
          {pickByLocale(locale, S.affectsTenants)}
          </span>
        </p>
        <FormField label={pickByLocale(locale, S.typeConfirm)} name="phrase">
          <Input
            type="text"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value.toUpperCase())}
            placeholder="CONFIRM"
          />
        </FormField>
        <FormField label={pickByLocale(locale, S.opReason)} name="reason">
          <Input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. active incident #4821 — pausing all inference"
          />
        </FormField>
        {error ? (
          <Alert variant="error">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </span>
          </Alert>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          type="button"
          onClick={onClose}
          disabled={submitting}
          variant="outline"
          size="sm"
        >
          {pickByLocale(locale, S.cancel)}
        </Button>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={!canConfirm}
          loading={submitting}
          variant="warning"
          size="sm"
        >
          {pickByLocale(locale, S.applyChange)}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
