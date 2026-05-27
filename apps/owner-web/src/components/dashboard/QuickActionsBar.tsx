import Link from 'next/link';

/**
 * Quick actions bar — top-right of the dashboard surface.
 *
 * The brain-first principle stays intact: every quick-action that
 * needs reasoning bounces back to `/` (chat home). The other links
 * jump to the cockpit screens that own the data the dashboard
 * summarises so the operator can drill in without reloading.
 */
export function QuickActionsBar(): JSX.Element {
  return (
    <nav
      aria-label="Dashboard quick actions"
      className="flex items-center gap-2"
      data-testid="dashboard-quick-actions"
    >
      <Link
        href="/"
        className="rounded-full border border-signal-500/40 bg-signal-500/10 px-3 py-1 text-xs font-medium text-signal-500 hover:bg-signal-500/20"
        data-testid="dashboard-quick-ask"
      >
        Ask Borjie
      </Link>
      <Link
        href="/cockpit"
        className="rounded-full border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-surface"
      >
        Open cockpit
      </Link>
      <Link
        href="/treasury"
        className="rounded-full border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-surface"
      >
        Treasury
      </Link>
      <Link
        href="/licences"
        className="rounded-full border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-surface"
      >
        Licences
      </Link>
    </nav>
  );
}
