/**
 * Persona-aware visibility for the advisor surface.
 *
 * Every page in `/advisor/*` declares a `PERSONA_AUDIENCE` list and we
 * intersect it with the operator's role claims (read off the
 * `PlatformStaff.roles` array, sourced from the `/api/platform/me`
 * endpoint).
 *
 * Roles are coarse — they map directly onto persona buckets:
 *
 *   - `platform_admin` / `admin`  → sees everything
 *   - `estate_manager`            → ops + dept-health + auto + geo
 *   - `owner`                     → lifecycle + sustainability
 *   - `investor` / `analyst`      → acquisition + expansion + green-angle
 *
 * Anyone else (including unauthenticated visitors during SSR) sees the
 * empty intersection — so the page list shrinks gracefully and we never
 * leak persona-restricted advisors in the index.
 */

export type AdvisorPersona =
  | 'admin'
  | 'estate_manager'
  | 'owner'
  | 'investor'
  | 'analyst';

export type AdvisorPageId =
  | 'acquisition'
  | 'lifecycle'
  | 'sustainability'
  | 'green-angle'
  | 'estate-department'
  | 'expansion'
  | 'estate-auto'
  | 'geo';

export interface AdvisorPageDescriptor {
  readonly id: AdvisorPageId;
  readonly href: string;
  readonly title: string;
  readonly summary: string;
  readonly audience: ReadonlyArray<AdvisorPersona>;
}

export const ADVISOR_PAGES: ReadonlyArray<AdvisorPageDescriptor> = [
  {
    id: 'acquisition',
    href: '/advisor/acquisition',
    title: 'Acquisition advisor',
    summary: 'Triangulated pricing + DD findings + closing checklist for a deal under consideration.',
    audience: ['admin', 'investor', 'analyst'],
  },
  {
    id: 'lifecycle',
    href: '/advisor/lifecycle',
    title: 'Lifecycle advisor',
    summary: 'Next-best-action for an asset by lifecycle stage — pre-dev, lease-up, refi-window, disposition.',
    audience: ['admin', 'owner', 'investor'],
  },
  {
    id: 'sustainability',
    href: '/advisor/sustainability',
    title: 'Sustainability advisor',
    summary: 'GHG Scope 1/2/3, BREEAM/LEED/EDGE predicted rating, BNG units, carbon-credit value.',
    audience: ['admin', 'owner'],
  },
  {
    id: 'green-angle',
    href: '/advisor/green-angle',
    title: 'Green-angle advisor',
    summary: 'Free-text project → ranked opportunities + financing matches + carbon methodologies + SDG alignment.',
    audience: ['admin', 'investor', 'analyst'],
  },
  {
    id: 'estate-department',
    href: '/advisor/estate-department',
    title: 'Estate-department health',
    summary: 'Portfolio + ops + staffing + vendor + risk + regulatory + owner-relations top-N recommendations.',
    audience: ['admin', 'estate_manager'],
  },
  {
    id: 'expansion',
    href: '/advisor/expansion',
    title: 'Expansion advisor',
    summary: 'HBU 4-test, capital-stack visualisation, lease-up curves for a parcel under expansion review.',
    audience: ['admin', 'investor', 'analyst'],
  },
  {
    id: 'estate-auto',
    href: '/advisor/estate-auto',
    title: 'Estate automation',
    summary: 'Predictive-maintenance dashboard, collection cadence, vendor scorecard.',
    audience: ['admin', 'estate_manager'],
  },
  {
    id: 'geo',
    href: '/advisor/geo',
    title: 'Geo advisor',
    summary: 'Live parcel map + area insights (solar, air quality, drive-time).',
    audience: ['admin', 'estate_manager', 'investor', 'analyst'],
  },
];

/**
 * Map raw role strings off the session to advisor-persona buckets.
 * Unknown roles drop out — we never widen accidentally.
 */
export function rolesToPersonas(
  roles: ReadonlyArray<string>,
): ReadonlyArray<AdvisorPersona> {
  const personas = new Set<AdvisorPersona>();
  for (const raw of roles) {
    const r = raw.toLowerCase();
    if (r === 'admin' || r === 'platform_admin' || r === 'platform-admin') {
      personas.add('admin');
    } else if (r === 'estate_manager' || r === 'estate-manager') {
      personas.add('estate_manager');
    } else if (r === 'owner') {
      personas.add('owner');
    } else if (r === 'investor') {
      personas.add('investor');
    } else if (r === 'analyst') {
      personas.add('analyst');
    }
  }
  return Array.from(personas);
}

/**
 * Filter the advisor catalogue to the rows visible to the supplied
 * persona-set. `admin` is a master key — present it and every page is
 * visible.
 */
export function visibleAdvisorPages(
  personas: ReadonlyArray<AdvisorPersona>,
): ReadonlyArray<AdvisorPageDescriptor> {
  if (personas.includes('admin')) return ADVISOR_PAGES;
  const set = new Set(personas);
  return ADVISOR_PAGES.filter((p) =>
    p.audience.some((a) => set.has(a)),
  );
}
