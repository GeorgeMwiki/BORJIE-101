'use client';

import type { ReactNode } from 'react';

export type TabId = 'shift' | 'geology' | 'cost';

interface TabsProps {
  readonly active: TabId;
  readonly onChange: (id: TabId) => void;
  readonly children: ReactNode;
}

interface Tab {
  readonly id: TabId;
  readonly label: string;
}

const TABS: ReadonlyArray<Tab> = [
  { id: 'shift', label: 'Shift' },
  { id: 'geology', label: 'Geology' },
  { id: 'cost', label: 'Cost' },
];

export function Tabs({ active, onChange, children }: TabsProps) {
  return (
    <div className="rounded-lg border border-border bg-surface/40">
      <div className="flex gap-1 border-b border-border px-2 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={t.id === active}
            className={`rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
              t.id === active
                ? 'border-warning text-warning'
                : 'border-transparent text-neutral-300 hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}
