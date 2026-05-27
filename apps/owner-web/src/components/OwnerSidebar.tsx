import Link from 'next/link';
import { Logomark } from '@borjie/design-system';
import { OWNER_SCREENS } from '@/lib/screens';
import type { ScreenGroup } from '@/lib/screens';

/**
 * Owner-web sidebar — left navigation grouped by job-to-be-done.
 *
 * Sections mirror the owner's mental model: Overview (brain + map),
 * Field (what is happening on the ground), Operations (the moving
 * parts), Money (cash and the buyer side), Compliance (regulator),
 * Community (village relationships), Settings (admin). Every screen
 * in `screens.ts` shows up here — no orphan pages.
 */

interface GroupConfig {
  readonly id: ScreenGroup;
  readonly heading: string;
  readonly headingSw: string;
}

const GROUPS: ReadonlyArray<GroupConfig> = [
  { id: 'overview', heading: 'Overview', headingSw: 'Muonekano' },
  { id: 'field', heading: 'Field', headingSw: 'Shambani' },
  { id: 'operations', heading: 'Operations', headingSw: 'Uendeshaji' },
  { id: 'money', heading: 'Money', headingSw: 'Fedha' },
  { id: 'compliance', heading: 'Compliance', headingSw: 'Uzingatiaji' },
  { id: 'community', heading: 'Community', headingSw: 'Jamii' },
  { id: 'settings', heading: 'Settings', headingSw: 'Mipangilio' },
];

export function OwnerSidebar() {
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface/40 px-4 py-6">
      <Link href="/" className="mb-8 flex items-center gap-2 px-2">
        <Logomark className="h-7 w-7" />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-foreground">Borjie</div>
          <div className="text-xs text-neutral-400">Owner Cockpit</div>
        </div>
      </Link>

      <nav className="flex flex-col gap-6">
        {GROUPS.map((group) => {
          const items = OWNER_SCREENS.filter((s) => s.group === group.id);
          if (items.length === 0) return null;
          return (
            <div key={group.id}>
              <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {group.heading}
              </div>
              <ul className="flex flex-col gap-0.5">
                {items.map((screen) => (
                  <li key={screen.id}>
                    <Link
                      href={`/${screen.slug}`}
                      className="block rounded-md px-2 py-1.5 text-sm text-neutral-200 hover:bg-surface hover:text-foreground"
                    >
                      <span className="text-neutral-500 mr-2 font-mono text-badge">
                        {screen.id.replace('O-W-', '')}
                      </span>
                      {screen.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
