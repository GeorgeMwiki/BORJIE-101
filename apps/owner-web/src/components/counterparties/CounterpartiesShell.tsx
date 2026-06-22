'use client';

import { useMemo, useState } from 'react';
import { Building2, ShieldCheck } from 'lucide-react';
import {
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  StatusBadge,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
} from '@borjie/design-system';
import {
  useCounterparties,
  useEngagements,
  type CounterpartyRow,
} from '@/lib/queries/ops';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { counterpartiesStrings as S } from '@/i18n/strings/counterparties';

const PARTY_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly labelEn: string;
  readonly labelSw: string;
}> = [
  { value: 'all', labelEn: 'All', labelSw: 'Zote' },
  { value: 'licensing_office', labelEn: 'Licensing office', labelSw: 'Ofisi ya leseni' },
  { value: 'survey_firm', labelEn: 'Survey firm', labelSw: 'Kampuni ya upimaji' },
  { value: 'transport_co', labelEn: 'Transport', labelSw: 'Usafirishaji' },
  { value: 'processor', labelEn: 'Processor', labelSw: 'Msindikaji' },
  { value: 'smelter', labelEn: 'Smelter', labelSw: 'Kiyeyushaji' },
  { value: 'refiner', labelEn: 'Refiner', labelSw: 'Kisafishaji' },
  { value: 'assayer', labelEn: 'Assayer', labelSw: 'Mpima madini' },
  { value: 'exporter', labelEn: 'Exporter', labelSw: 'Msafirishaji nje' },
  { value: 'bank', labelEn: 'Bank', labelSw: 'Benki' },
  { value: 'regulator', labelEn: 'Regulator', labelSw: 'Mdhibiti' },
  { value: 'off_taker', labelEn: 'Off-taker', labelSw: 'Mnunuzi wa jumla' },
  { value: 'logistics_co', labelEn: 'Logistics', labelSw: 'Usambazaji' },
  { value: 'csr_community', labelEn: 'CSR community', labelSw: 'Jamii ya CSR' },
  { value: 'env_monitor', labelEn: 'Env monitor', labelSw: 'Mfuatiliaji mazingira' },
  { value: 'gov_liaison', labelEn: 'Gov liaison', labelSw: 'Mwakilishi wa serikali' },
  { value: 'legal_counsel', labelEn: 'Legal counsel', labelSw: 'Mshauri wa sheria' },
  { value: 'insurance', labelEn: 'Insurance', labelSw: 'Bima' },
  { value: 'security_firm', labelEn: 'Security', labelSw: 'Usalama' },
];

export function CounterpartiesShell() {
  const locale = useLocale();
  const [partyType, setPartyType] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [drawerPartyId, setDrawerPartyId] = useState<string | null>(null);

  const list = useCounterparties({
    ...(partyType && partyType !== 'all' ? { partyType } : {}),
    ...(search ? { search } : {}),
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
      { label: pickByLocale(locale, S.tileCounterparties), value: String(total), icon: Building2 },
      { label: pickByLocale(locale, S.tileDownstream), value: String(downstream) },
      { label: pickByLocale(locale, S.tileRegulators), value: String(regulators) },
      { label: pickByLocale(locale, S.tileAdjacent), value: String(adjacent) },
    ];
  }, [parties, locale]);

  return (
    <section className="flex flex-col gap-6">
      <MetricStrip tiles={tiles} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-column-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={pickByLocale(locale, S.searchPlaceholder)}
          />
        </div>
        <Select value={partyType} onValueChange={setPartyType}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARTY_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {locale === 'sw' ? opt.labelSw : opt.labelEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {list.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-xl border border-border" />
          ))}
        </div>
      ) : parties.length === 0 ? (
        <ScreenEmptyState
          icon={<Building2 className="h-6 w-6" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pickByLocale(locale, S.colName)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colType)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colCountry)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colScorecard)}</TableHead>
              <TableHead className="text-right" aria-label={pickByLocale(locale, S.open)} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {parties.map((p) => (
              <CounterpartyRowItem
                key={p.id}
                party={p}
                locale={locale}
                onOpen={() => setDrawerPartyId(p.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}

      <Drawer
        open={drawerPartyId !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerPartyId(null);
        }}
      >
        {drawerPartyId ? (
          <CounterpartyDrawer
            partyId={drawerPartyId}
            party={parties.find((p) => p.id === drawerPartyId) ?? null}
            locale={locale}
          />
        ) : null}
      </Drawer>
    </section>
  );
}

function scoreTone(score: number): 'success' | 'warning' | 'error' {
  if (score >= 75) return 'success';
  if (score >= 40) return 'warning';
  return 'error';
}

function CounterpartyRowItem({
  party,
  locale,
  onOpen,
}: {
  readonly party: CounterpartyRow;
  readonly locale: Locale;
  readonly onOpen: () => void;
}) {
  const score = Number(party.scorecardScore);
  const tone = scoreTone(score);
  return (
    <TableRow
      onClick={onOpen}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TableCell className="font-medium text-foreground">{party.name}</TableCell>
      <TableCell className="text-muted-foreground">
        {party.partyType.replace(/_/g, ' ')}
      </TableCell>
      <TableCell className="text-muted-foreground">{party.country}</TableCell>
      <TableCell>
        <StatusBadge status={tone}>{score.toFixed(1)}</StatusBadge>
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {pickByLocale(locale, S.open)}
      </TableCell>
    </TableRow>
  );
}

function CounterpartyDrawer({
  partyId,
  party,
  locale,
}: {
  readonly partyId: string;
  readonly party: CounterpartyRow | null;
  readonly locale: Locale;
}) {
  const engagements = useEngagements({ partyId });
  const items = engagements.data?.data?.engagements ?? [];
  return (
    <DrawerContent side="right" size="md" className="flex flex-col">
      <DrawerHeader>
        <div className="flex items-center gap-2 text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <ShieldCheck className="h-3 w-3" />
          {pickByLocale(locale, S.drawerEyebrow)}
        </div>
        <DrawerTitle>{party?.name ?? partyId}</DrawerTitle>
        <DrawerDescription>
          {party ? `${party.partyType.replace(/_/g, ' ')} · ${party.country}` : null}
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody>
        <h3 className="mb-3 text-tiny uppercase tracking-eyebrow-wide text-muted-foreground">
          {pickByLocale(locale, S.timeline)}
        </h3>
        {engagements.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl border border-border" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pickByLocale(locale, S.timelineEmpty)}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {items.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-border/60 bg-surface/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-eyebrow text-signal-500">
                    {e.kind.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={
                      e.status === 'completed'
                        ? 'text-xs text-success'
                        : e.status === 'cancelled'
                          ? 'text-xs text-muted-foreground'
                          : 'text-xs text-warning'
                    }
                  >
                    {e.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground">{e.summary}</p>
                <p className="mt-1 text-tiny text-muted-foreground">
                  {new Date(e.openedAt).toLocaleString()}
                  {e.auditHashId
                    ? ` · ${pickByLocale(locale, S.audit)} ${e.auditHashId.slice(0, 8)}`
                    : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DrawerBody>
    </DrawerContent>
  );
}
