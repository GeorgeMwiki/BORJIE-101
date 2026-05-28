'use client';

import { useMemo, useState } from 'react';
import { Building2, Search, ShieldCheck, X } from 'lucide-react';
import {
  useCounterparties,
  useEngagements,
  type CounterpartyRow,
} from '@/lib/queries/ops';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';

const PARTY_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly labelEn: string;
}> = [
  { value: '', labelEn: 'All' },
  { value: 'licensing_office', labelEn: 'Licensing office' },
  { value: 'survey_firm', labelEn: 'Survey firm' },
  { value: 'transport_co', labelEn: 'Transport' },
  { value: 'processor', labelEn: 'Processor' },
  { value: 'smelter', labelEn: 'Smelter' },
  { value: 'refiner', labelEn: 'Refiner' },
  { value: 'assayer', labelEn: 'Assayer' },
  { value: 'exporter', labelEn: 'Exporter' },
  { value: 'bank', labelEn: 'Bank' },
  { value: 'regulator', labelEn: 'Regulator' },
  { value: 'off_taker', labelEn: 'Off-taker' },
  { value: 'logistics_co', labelEn: 'Logistics' },
  { value: 'csr_community', labelEn: 'CSR community' },
  { value: 'env_monitor', labelEn: 'Env monitor' },
  { value: 'gov_liaison', labelEn: 'Gov liaison' },
  { value: 'legal_counsel', labelEn: 'Legal counsel' },
  { value: 'insurance', labelEn: 'Insurance' },
  { value: 'security_firm', labelEn: 'Security' },
];

export function CounterpartiesShell() {
  const [partyType, setPartyType] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [drawerPartyId, setDrawerPartyId] = useState<string | null>(null);

  const list = useCounterparties({
    partyType: partyType || undefined,
    search: search || undefined,
  });
  const parties = list.data?.data?.parties ?? [];

  const tiles: ReadonlyArray<MetricTile> = useMemo(() => {
    const total = parties.length;
    const downstream = parties.filter((p) =>
      ['processor', 'smelter', 'refiner', 'exporter'].includes(p.partyType),
    ).length;
    const regulators = parties.filter((p) =>
      ['regulator', 'env_monitor', 'gov_liaison'].includes(p.partyType),
    ).length;
    const adjacent = parties.filter((p) =>
      [
        'transport_co',
        'logistics_co',
        'csr_community',
        'legal_counsel',
        'insurance',
        'security_firm',
      ].includes(p.partyType),
    ).length;
    return [
      { label: 'Counterparties', value: String(total), icon: Building2 },
      { label: 'Downstream', value: String(downstream) },
      { label: 'Regulators', value: String(regulators) },
      { label: 'Adjacent', value: String(adjacent) },
    ];
  }, [parties]);

  return (
    <section className="flex flex-col gap-6">
      <MetricStrip tiles={tiles} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            className="w-full rounded-xl border border-border bg-surface/40 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-neutral-500"
          />
        </div>
        <select
          value={partyType}
          onChange={(e) => setPartyType(e.target.value)}
          className="rounded-xl border border-border bg-surface/40 px-3 py-2 text-sm text-foreground"
        >
          {PARTY_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.labelEn}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
        <table className="w-full text-sm">
          <thead className="bg-surface/60 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Country</th>
              <th className="px-4 py-3 text-left">Scorecard</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                  Loading
                </td>
              </tr>
            ) : parties.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                  No counterparties yet. Use the brain to add one.
                </td>
              </tr>
            ) : (
              parties.map((p) => (
                <CounterpartyRowItem
                  key={p.id}
                  party={p}
                  onOpen={() => setDrawerPartyId(p.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {drawerPartyId ? (
        <CounterpartyDrawer
          partyId={drawerPartyId}
          party={parties.find((p) => p.id === drawerPartyId) ?? null}
          onClose={() => setDrawerPartyId(null)}
        />
      ) : null}
    </section>
  );
}

function CounterpartyRowItem({
  party,
  onOpen,
}: {
  readonly party: CounterpartyRow;
  readonly onOpen: () => void;
}) {
  const score = Number(party.scorecardScore);
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-border/60 hover:bg-surface"
    >
      <td className="px-4 py-3 font-medium text-foreground">{party.name}</td>
      <td className="px-4 py-3 text-neutral-300">
        {party.partyType.replace(/_/g, ' ')}
      </td>
      <td className="px-4 py-3 text-neutral-300">{party.country}</td>
      <td className="px-4 py-3 text-neutral-300">
        <span
          className={
            score >= 75
              ? 'text-success'
              : score >= 40
                ? 'text-warning'
                : 'text-destructive'
          }
        >
          {score.toFixed(1)}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-neutral-500">Open</td>
    </tr>
  );
}

function CounterpartyDrawer({
  partyId,
  party,
  onClose,
}: {
  readonly partyId: string;
  readonly party: CounterpartyRow | null;
  readonly onClose: () => void;
}) {
  const engagements = useEngagements({ partyId });
  const items = engagements.data?.data?.engagements ?? [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close drawer"
        className="flex-1"
        onClick={onClose}
      />
      <aside className="flex w-full max-w-md flex-col gap-5 border-l border-border bg-surface px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-signal-500">
              <ShieldCheck className="h-3 w-3" />
              Counterparty
            </div>
            <h2 className="mt-1 font-display text-xl text-foreground">
              {party?.name ?? partyId}
            </h2>
            <p className="text-xs text-neutral-400">
              {party?.partyType.replace(/_/g, ' ')} · {party?.country}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-neutral-400 hover:bg-surface/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <h3 className="mb-3 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            Engagement timeline
          </h3>
          {engagements.isLoading ? (
            <p className="text-sm text-neutral-500">Loading</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No engagements logged yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {items.map((e) => (
                <li
                  key={e.id}
                  className="rounded-xl border border-border/60 bg-surface/40 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-[0.12em] text-signal-500">
                      {e.kind.replace(/_/g, ' ')}
                    </span>
                    <span
                      className={
                        e.status === 'completed'
                          ? 'text-xs text-success'
                          : e.status === 'cancelled'
                            ? 'text-xs text-neutral-500'
                            : 'text-xs text-warning'
                      }
                    >
                      {e.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{e.summary}</p>
                  <p className="mt-1 text-[10px] text-neutral-500">
                    {new Date(e.openedAt).toLocaleString()}
                    {e.auditHashId
                      ? ` · audit ${e.auditHashId.slice(0, 8)}`
                      : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
