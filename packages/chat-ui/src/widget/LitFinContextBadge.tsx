'use client';

/**
 * Context Badge — carbon copy of LitFin's ContextBadge, Borjie-skinned.
 *
 * Shows a small "Aware of X" indicator in the widget header so users
 * see what page-context the AI has loaded. Builds trust by being
 * transparent about what the AI "sees".
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/ContextBadge.tsx
 */

import type { JSX } from 'react';

export interface LitFinContextBadgeProps {
  readonly currentRoute: string;
  readonly portalId: string;
  readonly language?: 'en' | 'sw';
}

export function LitFinContextBadge({
  currentRoute,
  portalId,
  language = 'en',
}: LitFinContextBadgeProps): JSX.Element {
  const pageName = getPageName(currentRoute, portalId);
  const label = language === 'sw' ? 'Anaona' : 'Aware of';
  return (
    <span className="text-[10px] text-primary-foreground/60">
      {label} {pageName}
    </span>
  );
}

function getPageName(route: string, portalId: string): string {
  const segments = route.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return portalId;
  if (last === 'dashboard' || last === portalId) return `${portalId} dashboard`;
  if (last === 'leases') return 'lease ledger';
  if (last === 'tenants') return 'tenant roster';
  if (last === 'maintenance') return 'maintenance queue';
  if (last === 'pricing') return 'pricing';
  if (last === 'for-bank') return 'banking solution';
  if (last === 'for-tenant') return 'tenant portal';
  if (/^[0-9a-f-]{20,}$/i.test(last)) {
    const parent = segments[segments.length - 2];
    return parent ? `${parent} detail` : 'detail page';
  }
  return last.replace(/-/g, ' ');
}
