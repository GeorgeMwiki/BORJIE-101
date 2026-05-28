import type { ReactNode } from 'react';
import { Sidebar } from './admin-shell/Sidebar';
import { TopBar } from './admin-shell/TopBar';
import { StaffIdentityStrip } from './StaffIdentityStrip';

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
}

export function AdminShell({ children }: AdminShellProps): JSX.Element {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar bilingual />
      <div className="flex flex-1 min-w-0 flex-col">
        <TopBar identity={<StaffIdentityStrip />} />
        <main id="main-content" tabIndex={-1} className="flex-1">
          <div className="mx-auto max-w-screen-2xl px-6 py-8 lg:px-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
