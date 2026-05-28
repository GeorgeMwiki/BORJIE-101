'use client';

import { type ReactNode } from 'react';

/**
 * OwnerProviders — owner-portal-specific provider stack.
 *
 * Mirrors LitFin's `(borrower)/BorrowerProviders.tsx` pattern: a thin
 * client wrapper that owners can hang Tooltip / Toast / Theme contexts
 * off without re-mounting them on every page transition. Today this is
 * a passthrough because the global `AppProviders` (TanStack Query) is
 * already mounted in `app/layout.tsx`; portal-only providers (e.g.
 * a TooltipProvider that should not run on `/sign-in`) will land here.
 */
export function OwnerProviders({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}
