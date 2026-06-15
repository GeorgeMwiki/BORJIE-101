import type { ReactNode } from 'react';
import type { Locale } from '@/lib/locale-shared';
import { Sidebar } from './admin-shell/Sidebar';
import { TopBar } from './admin-shell/TopBar';
import { StaffIdentityStrip } from './StaffIdentityStrip';
import { AdminSuperpowers } from './superpowers';
import { requirePublicBaseUrl } from '@/lib/env-guard';

/**
 * AdminShell — root chrome for every Borjie internal admin page.
 *
 * Mirrors the LitFin admin/officer shell shape:
 *
 *   ┌──────────┬──────────────────────────────────────────────┐
 *   │          │ [EnvBadge]  [search]      [bell] [persona]   │
 *   │ Sidebar  ├──────────────────────────────────────────────┤
 *   │ (8 nav)  │ <main> children </main>                      │
 *   │          │                                              │
 *   └──────────┴──────────────────────────────────────────────┘
 *
 *   - Left rail: 60-wide on desktop, dense nav with active state.
 *   - Top bar: sticky, env badge + search + alerts + persona.
 *   - Main: `max-w-screen-2xl mx-auto px-6 lg:px-10 py-8` content
 *     frame — admins get wider real estate than owner cockpit.
 *
 * Colors stay strictly on Borjie navy/gold/cream tokens. Pattern only.
 * Bilingual sw/en is enabled in `<Sidebar>`.
 */

interface AdminShellProps {
  readonly children: ReactNode;
  /** Active locale (server-resolved) so the nav renders ONE language. */
  readonly locale?: Locale;
}

/**
 * Cross-portal origins for the suite switcher. Resolved here (server) so
 * the client `TopBar` never reads env directly. `requirePublicBaseUrl`
 * throws in production builds when the origin env var is unset, so a
 * deployed console can never link staff back to localhost.
 */
function resolveSuiteOrigins(): { ownerUrl: string; adminUrl: string } {
  return {
    ownerUrl: requirePublicBaseUrl(
      'NEXT_PUBLIC_OWNER_WEB_ORIGIN',
      'http://localhost:3010',
    ),
    adminUrl: requirePublicBaseUrl(
      'NEXT_PUBLIC_ADMIN_WEB_ORIGIN',
      'http://localhost:3020',
    ),
  };
}

export function AdminShell({
  children,
  locale = 'en',
}: AdminShellProps): JSX.Element {
  const { ownerUrl, adminUrl } = resolveSuiteOrigins();
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar locale={locale} />
      <div className="flex flex-1 min-w-0 flex-col">
        <TopBar
          identity={<StaffIdentityStrip />}
          ownerUrl={ownerUrl}
          adminUrl={adminUrl}
        />
        <main id="main-content" tabIndex={-1} className="flex-1">
          <div className="mx-auto max-w-screen-2xl px-6 py-8 lg:px-10">
            {children}
          </div>
        </main>
      </div>
      {/* Wave SUPERPOWERS — always-on companions: Cmd+Shift+B bulk
          drawer + highlight-bus overlay. The chip renderer is
          mounted by chat surfaces individually (per-turn). */}
      <AdminSuperpowers />
    </div>
  );
}
