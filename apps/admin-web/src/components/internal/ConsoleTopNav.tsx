import Link from 'next/link';
import { Logomark } from '@borjie/design-system';
import {
  SCREEN_GROUPS,
  screensByGroup,
  internalHref,
} from '@/lib/internal/screens';

/**
 * Top nav for the Borjie Console (internal admin). Lists the four
 * screen groups defined in UI_SCREEN_CATALOGUE.md §D with their
 * member screens in a flyout-style stack. Server component — pure
 * markup, no interactivity, so it can sit above any sub-page.
 */
export function ConsoleTopNav(): JSX.Element {
  return (
    <header className="border-b border-border bg-surface-sunken">
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center gap-6">
        <Link href="/internal" className="flex items-center gap-3 shrink-0">
          <Logomark size={28} variant="premium" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-display text-foreground">Borjie Console</span>
            <span className="text-[0.62rem] uppercase tracking-widest text-neutral-500">
              Internal admin
            </span>
          </div>
        </Link>

        <nav
          aria-label="Console sections"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 ml-2"
        >
          {SCREEN_GROUPS.map((group) => (
            <details key={group.id} className="group relative">
              <summary
                className="cursor-pointer list-none rounded-md px-3 py-1.5 text-sm text-foreground hover:bg-surface transition-colors marker:hidden"
                aria-label={`${group.label} screens`}
              >
                {group.label}
              </summary>
              <div
                role="group"
                className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border bg-surface shadow-lg p-3 space-y-1"
              >
                <p className="text-xs text-neutral-500 px-2 pb-2 border-b border-border mb-2">
                  {group.blurb}
                </p>
                {screensByGroup(group.id).map((screen) => (
                  <Link
                    key={screen.id}
                    href={internalHref(screen.slug)}
                    className="block rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-surface-sunken transition-colors"
                  >
                    <span className="text-[0.62rem] uppercase tracking-widest text-neutral-500 mr-2">
                      {screen.id}
                    </span>
                    {screen.title}
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 text-xs text-neutral-500">
          <span className="hidden sm:inline">Port 3020 · SSO + IP allow-list</span>
        </div>
      </div>
    </header>
  );
}
