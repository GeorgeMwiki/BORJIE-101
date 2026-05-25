'use client';

export type TenantTab = 'overview' | 'users' | 'billing' | 'audit' | 'impersonate';

interface TenantTabsProps {
  readonly active: TenantTab;
  readonly onChange: (tab: TenantTab) => void;
}

const TABS: ReadonlyArray<{ readonly id: TenantTab; readonly label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'billing', label: 'Billing' },
  { id: 'audit', label: 'Audit' },
  { id: 'impersonate', label: 'Impersonate' },
];

export function TenantTabs({ active, onChange }: TenantTabsProps): JSX.Element {
  return (
    <div role="tablist" aria-label="Tenant sections" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab.id === active
              ? 'border-signal-500 text-foreground'
              : 'border-transparent text-neutral-400 hover:text-foreground'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
