import { Bell } from 'lucide-react';
import { getOwnerSession } from '@/lib/session';
import { SiteSelector } from './SiteSelector';
import { LanguageToggle } from './LanguageToggle';
import { OwnerAvatar } from './OwnerAvatar';

/**
 * Top bar — anchored across every owner screen.
 *
 * Holds the four global controls the owner uses without thinking:
 *   1. Site selector (which mine am I looking at right now?)
 *   2. Language toggle (Swahili / English — Swahili is the spec default)
 *   3. Notifications bell (juniors flagging decisions, regulator alerts)
 *   4. Owner avatar (tenant + identity at a glance)
 *
 * Server Component — reads session on the server, hands children
 * the parts they need. The toggles themselves are tiny client islands.
 */
export async function OwnerTopBar() {
  const session = await getOwnerSession();
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface/30 px-6">
      <SiteSelector
        sites={session.sites}
        activeSiteId={session.activeSiteId}
      />

      <div className="flex items-center gap-4">
        <LanguageToggle initial={session.languagePreference} />
        <button
          type="button"
          aria-label="Notifications"
          className="relative rounded-md p-1.5 text-neutral-300 hover:bg-surface hover:text-foreground"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warning" />
        </button>
        <OwnerAvatar
          fullName={session.fullName}
          tenantName={session.tenant.tradingName}
        />
      </div>
    </header>
  );
}
