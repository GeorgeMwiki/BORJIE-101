import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  SCREEN_GROUPS,
  screensByGroup,
  internalHref,
  INTERNAL_SCREENS,
} from '@/lib/internal/screens';

/**
 * Borjie Console landing — grid of all 20 internal admin screens
 * grouped by Tenants / Intelligence / Quality / Ops per the build
 * plan and UI_SCREEN_CATALOGUE.md §D.
 */
export default function ConsoleHomePage(): JSX.Element {
  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-10">
        <p className="text-caption uppercase tracking-widest text-signal-500 mb-2">
          Internal admin · Section D
        </p>
        <h1 className="text-4xl font-display text-foreground mb-3">
          Borjie Console
        </h1>
        <p className="text-sm text-neutral-400 max-w-2xl">
          Twenty operational surfaces that run the Borjie platform — from
          tenant onboarding through corpus management, prompt promotion,
          compliance review, and emergency killswitch. SSO + IP allow-list
          enforced upstream; every mutation lands in the append-only
          audit log.
        </p>
        <div className="mt-4 flex items-center gap-4 text-xs text-neutral-500">
          <span>{INTERNAL_SCREENS.length} screens</span>
          <span aria-hidden="true">·</span>
          <span>{SCREEN_GROUPS.length} groups</span>
          <span aria-hidden="true">·</span>
          <Link href="/" className="hover:text-foreground transition-colors underline underline-offset-4">
            Back to Platform HQ
          </Link>
        </div>
      </header>

      <div className="space-y-10">
        {SCREEN_GROUPS.map((group) => {
          const screens = screensByGroup(group.id);
          return (
            <section key={group.id} aria-labelledby={`group-${group.id}`}>
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <h2
                    id={`group-${group.id}`}
                    className="text-xl font-display text-foreground"
                  >
                    {group.label}
                  </h2>
                  <p className="text-sm text-neutral-400">{group.blurb}</p>
                </div>
                <span className="text-xs text-neutral-500">
                  {screens.length} screens
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {screens.map((screen) => (
                  <Link
                    key={screen.id}
                    href={internalHref(screen.slug)}
                    className="platform-card hover:border-signal-500/40 transition-colors group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-caption uppercase tracking-widest text-signal-500">
                        {screen.id}
                      </span>
                      <ArrowRight className="w-4 h-4 text-neutral-500 group-hover:text-signal-500 transition-colors" />
                    </div>
                    <h3 className="text-base font-display text-foreground mb-1">
                      {screen.title}
                    </h3>
                    <p className="text-xs text-neutral-400">{screen.intent}</p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
