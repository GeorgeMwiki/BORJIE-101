'use client';

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
}

export function DecisionFilters({ value, onChange, tenants, juniors }: DecisionFiltersProps): JSX.Element {
  const update = (patch: Partial<DecisionFiltersState>) => onChange({ ...value, ...patch });

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-lg border border-border bg-surface p-4">
      <label className="text-xs">
        <span className="block uppercase tracking-wider text-neutral-500 mb-1">Tenant</span>
        <select
          value={value.tenantId}
          onChange={(e) => update({ tenantId: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        >
          <option value="">All tenants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="block uppercase tracking-wider text-neutral-500 mb-1">Junior</span>
        <select
          value={value.juniorId}
          onChange={(e) => update({ juniorId: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        >
          <option value="">All juniors</option>
          {juniors.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="block uppercase tracking-wider text-neutral-500 mb-1">From</span>
        <input
          type="date"
          value={value.from}
          onChange={(e) => update({ from: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>
      <label className="text-xs">
        <span className="block uppercase tracking-wider text-neutral-500 mb-1">To</span>
        <input
          type="date"
          value={value.to}
          onChange={(e) => update({ to: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>
    </div>
  );
}
