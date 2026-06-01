'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * AdminShellGate — chooses between the chrome-wrapped AdminShell and a
 * bare layout based on the active path. The sign-in surface, the legacy
 * `/login` redirect, and the error/loading pages render without sidebar
 * + top bar so unauthenticated users never see a broken nav (or a flash
 * of chrome while `/login` redirects to `/sign-in`).
 */

const BARE_ROUTES: ReadonlyArray<string> = ['/sign-in', '/login', '/auth'];

interface AdminShellGateProps {
  readonly shell: ReactNode;
  readonly bare: ReactNode;
}

export function AdminShellGate({ shell, bare }: AdminShellGateProps): JSX.Element {
  const pathname = usePathname() ?? '';
  const isBare = BARE_ROUTES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return <>{isBare ? bare : shell}</>;
}
