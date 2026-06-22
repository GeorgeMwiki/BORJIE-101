'use client';

import { Input } from '@borjie/design-system';
import { pickByLocale, type Locale } from '@/lib/locale';

export interface DecisionFiltersState {
  readonly tenantId: string;
  readonly juniorId: string;
  readonly from: string;
  readonly to: string;
}

interface DecisionFiltersProps {
  readonly value: DecisionFiltersState;
  readonly onChange: (next: DecisionFiltersState) => void;
  readonly tenants: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly juniors: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly locale: Locale;
}

const SELECT_CLASS =
  'w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground';

const S = {
  tenant: { en: 'Tenant', sw: 'Mteja' },
  junior: { en: 'Junior', sw: 'Mdogo' },
  from: { en: 'From', sw: 'Kuanzia' },
  to: { en: 'To', sw: 'Hadi' },
  allTenants: { en: 'All tenants', sw: 'Wateja wote' },
  allJuniors: { en: 'All juniors', sw: 'Wadogo wote' },
} as const;

export function DecisionFilters({
  value,
  onChange,
  tenants,
  juniors,
  locale,
}: DecisionFiltersProps): JSX.Element {
  const update = (patch: Partial<DecisionFiltersState>) => onChange({ ...value, ...patch });

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-lg border border-border bg-surface p-4">
      <label className="text-xs">
        <span className="block uppercase tracking-wider text-muted-foreground mb-1">
          {pickByLocale(locale, S.tenant)}
        </span>
        <select
          value={value.tenantId}
          onChange={(e) => update({ tenantId: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">{pickByLocale(locale, S.allTenants)}</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="block uppercase tracking-wider text-muted-foreground mb-1">
          {pickByLocale(locale, S.junior)}
        </span>
        <select
          value={value.juniorId}
          onChange={(e) => update({ juniorId: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">{pickByLocale(locale, S.allJuniors)}</option>
          {juniors.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="block uppercase tracking-wider text-muted-foreground mb-1">
          {pickByLocale(locale, S.from)}
        </span>
        <Input
          type="date"
          value={value.from}
          onChange={(e) => update({ from: e.target.value })}
        />
      </label>
      <label className="text-xs">
        <span className="block uppercase tracking-wider text-muted-foreground mb-1">
          {pickByLocale(locale, S.to)}
        </span>
        <Input
          type="date"
          value={value.to}
          onChange={(e) => update({ to: e.target.value })}
        />
      </label>
    </div>
  );
}
