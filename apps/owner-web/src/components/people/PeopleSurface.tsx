'use client';

import { useMemo } from 'react';
import {
  Activity,
  AlertOctagon,
  Briefcase,
  Fuel,
  HardHat,
  Users,
} from 'lucide-react';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { useHeadcount } from '@/lib/queries/people';
import { useIncidents } from '@/lib/queries/safety';

interface PeopleSurfaceProps {
  readonly locale?: 'sw' | 'en';
}

interface SupervisorRow {
  readonly id: string;
  readonly nameEn: string;
  readonly nameSw: string;
  readonly siteEn: string;
  readonly siteSw: string;
  readonly roleEn: string;
  readonly roleSw: string;
  readonly status: 'on-shift' | 'off-shift' | 'leave';
}

const SUPERVISORS: ReadonlyArray<SupervisorRow> = [
  {
    id: 'sup-001',
    nameEn: 'James Mwakipesile',
    nameSw: 'James Mwakipesile',
    siteEn: 'Nyakabale Reef Block',
    siteSw: 'Nyakabale Reef Block',
    roleEn: 'Underground supervisor',
    roleSw: 'Msimamizi wa chini ya ardhi',
    status: 'on-shift',
  },
  {
    id: 'sup-002',
    nameEn: 'Joyce Ngowi',
    nameSw: 'Joyce Ngowi',
    siteEn: 'Kakola Alluvial Terraces',
    siteSw: 'Kakola Alluvial Terraces',
    roleEn: 'Processing line lead',
    roleSw: 'Mkuu wa mstari wa kuchakata',
    status: 'on-shift',
  },
  {
    id: 'sup-003',
    nameEn: 'Hassan Mfaume',
    nameSw: 'Hassan Mfaume',
    siteEn: 'Mbeya Ridge Pit 2',
    siteSw: 'Mbeya Ridge Pit 2',
    roleEn: 'Equipment supervisor',
    roleSw: 'Msimamizi wa vifaa',
    status: 'off-shift',
  },
  {
    id: 'sup-004',
    nameEn: 'Christina Munisi',
    nameSw: 'Christina Munisi',
    siteEn: 'Nyakabale Reef Block',
    siteSw: 'Nyakabale Reef Block',
    roleEn: 'Geology supervisor',
    roleSw: 'Msimamizi wa jiolojia',
    status: 'on-shift',
  },
];

const FUEL_SPARK = [42, 45, 38, 50, 48, 44, 52]; // litres / day, last 7 days

function statusTone(status: SupervisorRow['status']) {
  if (status === 'on-shift') {
    return {
      pill: 'border-success/40 bg-success/10 text-success',
      label: { en: 'On shift', sw: 'Kazini' },
    };
  }
  if (status === 'leave') {
    return {
      pill: 'border-info/40 bg-info/10 text-info',
      label: { en: 'Leave', sw: 'Likizo' },
    };
  }
  return {
    pill: 'border-border bg-surface text-neutral-300',
    label: { en: 'Off shift', sw: 'Pumzika' },
  };
}

/**
 * People surface for the owner cockpit.
 *
 * Pulls live headcount from `/api/v1/mining/attendance/headcount` and
 * live incidents from `/api/v1/mining/incidents` to render the
 * KPI strip. Below the strip a supervisors list + incident feed +
 * fuel consumption sparkline give the owner the full workforce read.
 */
export function PeopleSurface({ locale = 'en' }: PeopleSurfaceProps): JSX.Element {
  const isSw = locale === 'sw';
  const headcount = useHeadcount();
  const incidents = useIncidents({ limit: 50 });

  const onShift = useMemo(() => {
    const rows = headcount.data?.perSite ?? [];
    return rows.reduce((acc, row) => acc + row.headcount, 0);
  }, [headcount.data]);

  const openIncidents = useMemo(
    () =>
      (incidents.data ?? []).filter((row) => row.status === 'open').length,
    [incidents.data],
  );

  const metrics = useMemo<readonly MetricTile[]>(
    () => [
      {
        label: isSw ? 'Wafanyakazi zamu ya leo' : 'Workforce on shift',
        value: String(onShift),
        sub: isSw ? 'Walioingia kwa GPS' : 'GPS-fenced check-ins',
        icon: Users,
        tone: 'default' as const,
      },
      {
        label: isSw ? 'Wasimamizi kazini' : 'Supervisors on shift',
        value: String(SUPERVISORS.filter((s) => s.status === 'on-shift').length),
        sub: isSw ? 'Wamesalia kwa kushuhudia' : 'Leadership coverage',
        icon: HardHat,
      },
      {
        label: isSw ? 'Matukio wazi' : 'Open incidents',
        value: String(openIncidents),
        sub: isSw ? 'Yanahitaji ufuatiliaji' : 'Need follow-through',
        icon: AlertOctagon,
        tone: openIncidents > 0 ? ('warning' as const) : ('success' as const),
      },
      {
        label: isSw ? 'Mafuta - siku 7' : 'Fuel - 7d avg',
        value: `${Math.round(
          FUEL_SPARK.reduce((a, b) => a + b, 0) / FUEL_SPARK.length,
        )} L`,
        sub: isSw ? 'Mwelekeo wa matumizi' : 'Consumption trend',
        icon: Fuel,
      },
    ],
    [onShift, openIncidents, isSw],
  );

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={4} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40 lg:col-span-2">
          <header className="border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Briefcase className="h-4 w-4 text-signal-500" />
              {isSw ? 'Wasimamizi wakuu' : 'Supervisors'}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              {isSw
                ? 'Kiwango cha juu cha utawala kwa kila mgodi'
                : 'Leadership coverage by site'}
            </p>
          </header>
          <ul className="divide-y divide-border/60">
            {SUPERVISORS.map((sup) => {
              const tone = statusTone(sup.status);
              return (
                <li
                  key={sup.id}
                  className="flex items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {isSw ? sup.nameSw : sup.nameEn}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-400">
                      {isSw ? sup.roleSw : sup.roleEn} -{' '}
                      <span className="text-neutral-300">
                        {isSw ? sup.siteSw : sup.siteEn}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-badge font-medium ${tone.pill}`}
                  >
                    {isSw ? tone.label.sw : tone.label.en}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
            <header className="border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertOctagon className="h-4 w-4 text-warning" />
                {isSw ? 'Foleni ya matukio' : 'Incident feed'}
              </h2>
            </header>
            {incidents.isPending ? (
              <div className="px-5 py-6 text-xs text-neutral-500">
                {isSw ? 'Inapakia...' : 'Loading...'}
              </div>
            ) : (incidents.data ?? []).length === 0 ? (
              <div className="px-5 py-6 text-xs text-neutral-500">
                {isSw ? 'Hakuna tukio.' : 'No recent incidents.'}
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {(incidents.data ?? []).slice(0, 5).map((row) => (
                  <li key={row.id} className="px-5 py-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize text-foreground">
                        {row.kind}
                      </span>
                      <span className="font-mono uppercase text-warning">
                        {row.severity}
                      </span>
                    </div>
                    <div className="mt-1 text-neutral-500">
                      {row.siteId ?? (isSw ? 'Hakitajwa' : 'Unassigned')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
            <header className="border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Activity className="h-4 w-4 text-signal-500" />
                {isSw ? 'Matumizi ya mafuta' : 'Fuel consumption'}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-400">
                {isSw ? 'Lita kwa siku - wiki iliyopita' : 'Litres / day - last week'}
              </p>
            </header>
            <div className="px-5 py-5">
              <FuelSparkline data={FUEL_SPARK} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FuelSparklineProps {
  readonly data: ReadonlyArray<number>;
}

function FuelSparkline({ data }: FuelSparklineProps) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-1.5 h-16">
      {data.map((value, index) => {
        const height = ((value - min) / range) * 100;
        return (
          <div key={index} className="flex-1 flex flex-col items-center gap-1.5">
            <div
              className="w-full rounded-sm bg-signal-500/60"
              style={{ height: `${Math.max(height, 8)}%` }}
            />
            <span className="font-mono text-spark text-neutral-500">
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
