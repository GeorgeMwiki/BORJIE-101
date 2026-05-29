import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-22 — Settings. Live data path: GET /api/v1/mining/internal/tenants/me
 * (users, plan, autonomy policy). Empty state shown until that wiring
 * lands; mock data has been removed.
 *
 * JA-7 — adds a Jurisdiction sub-page link so the owner can inspect
 * the country / regulators / currency / language / time zone that
 * drive every royalty draft and licence reminder.
 */
export default function SettingsPage() {
  return (
    <>
      <ScreenHeader slug="settings" />
      <div className="px-8 py-6 space-y-6">
        <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/settings/jurisdiction"
            className="group rounded-md border border-border bg-surface p-5 transition hover:border-foreground/30"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg text-foreground">
                Jurisdiction
              </h2>
              <span className="text-xs text-neutral-400 group-hover:text-foreground">
                →
              </span>
            </div>
            <p className="mt-0.5 text-xs italic text-neutral-500">
              Eneo la sheria
            </p>
            <p className="mt-2 text-sm text-neutral-300">
              Country, regulators, currency, language, time zone.
            </p>
          </Link>
          <Link
            href="/settings/connected-agents"
            className="group rounded-md border border-border bg-surface p-5 transition hover:border-foreground/30"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg text-foreground">
                Connected agents
              </h2>
              <span className="text-xs text-neutral-400 group-hover:text-foreground">
                →
              </span>
            </div>
            <p className="mt-0.5 text-xs italic text-neutral-500">
              Wakala walioongezwa
            </p>
            <p className="mt-2 text-sm text-neutral-300">
              External agents with active access to your account.
            </p>
          </Link>
        </nav>
        <EmptyState
          title="Plan + autonomy not yet wired"
          description="Users, plan, and autonomy policy load from the live tenant API."
          hint="GET /api/v1/mining/internal/tenants/me (pending)"
        />
      </div>
    </>
  );
}
