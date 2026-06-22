'use client';

import type { ReactNode } from 'react';

import { Tabs as DSTabs, TabsList, TabsTrigger } from '@borjie/design-system';
import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

export type TabId = 'shift' | 'geology' | 'cost';

interface TabsProps {
  readonly active: TabId;
  readonly onChange: (id: TabId) => void;
  readonly children: ReactNode;
}

interface TabDef {
  readonly id: TabId;
  readonly label: { readonly en: string; readonly sw: string };
}

const TABS: ReadonlyArray<TabDef> = [
  { id: 'shift', label: S.siteTabs.shift },
  { id: 'geology', label: S.siteTabs.geology },
  { id: 'cost', label: S.siteTabs.cost },
];

/**
 * Site-cockpit tab strip — CONVERGED onto the DS `Tabs` primitives so the
 * tab list inherits roving-tabindex, ARIA `role="tablist"`, and keyboard
 * arrow navigation for free. The PARENT keeps ownership of which panel is
 * rendered (it conditionally renders only the active tab's content as
 * `children`), so this wrapper drives the shared `value` and renders the
 * active panel below the list.
 */
export function Tabs({ active, onChange, children }: TabsProps) {
  const locale = useLocale();
  return (
    <DSTabs
      value={active}
      onValueChange={(value) => onChange(value as TabId)}
      className="rounded-lg border border-border bg-surface/40"
    >
      <div className="border-b border-border px-2 pt-2">
        <TabsList variant="underline">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} variant="underline">
              {pickByLocale(locale, t.label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div role="tabpanel" className="px-5 py-5">
        {children}
      </div>
    </DSTabs>
  );
}
