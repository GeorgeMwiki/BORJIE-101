/**
 * /advisor — index of the eight veteran-expert advisor pages.
 *
 * The list is filtered by persona at render time. Roles come off the
 * `PlatformStaff` claim returned by `/api/platform/me`; unknown roles
 * drop out via `rolesToPersonas()`. An operator with the `admin`
 * persona sees every advisor; everyone else sees the subset their
 * audience covers.
 *
 * Citations for the persona mapping live next to the `ADVISOR_PAGES`
 * catalogue in `./_lib/persona.ts`.
 */

import Link from 'next/link';
import { cookies } from 'next/headers';
import { ArrowRight } from 'lucide-react';
import { PortalShell } from './_lib/PortalShell';
import {
  rolesToPersonas,
  visibleAdvisorPages,
  type AdvisorPersona,
} from './_lib/persona';
import { PLATFORM_SESSION_COOKIE, type PlatformStaff } from '@/lib/session';

async function fetchStaff(cookieHeader: string): Promise<PlatformStaff | null> {
  try {
    const base =
      process.env.NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL ??
      'http://localhost:3020';
    const res = await fetch(`${base}/api/platform/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { staff?: PlatformStaff };
    return data.staff ?? null;
  } catch (error) {
    console.error('AdvisorIndex me fetch failed:', error);
    return null;
  }
}

export default async function AdvisorIndexPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const sessionPresent = Boolean(
    cookieStore.get(PLATFORM_SESSION_COOKIE)?.value,
  );
  const staff = sessionPresent ? await fetchStaff(cookieHeader) : null;
  const personas: ReadonlyArray<AdvisorPersona> = staff
    ? rolesToPersonas(staff.roles)
    : [];
  const visible = visibleAdvisorPages(personas);

  return (
    <PortalShell
      title="Veteran-expert advisors"
      description="Eight domain advisors against the platform graph. Inputs are validated server-side; every output carries citations + a confidence band."
    >
      {!staff ? (
        <div className="platform-card-degraded mb-6 text-sm text-neutral-200">
          Identity service unreachable — showing every advisor unfiltered. Sign
          in to scope the catalogue to your persona.
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="platform-card text-sm text-neutral-400">
          Your roles ({staff?.roles.join(', ') || 'none'}) do not match any
          advisor audience. Ask an administrator to grant one of: estate_manager,
          owner, investor, analyst.
        </div>
      ) : (
        <ul
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
          aria-label="Advisor catalogue"
        >
          {(staff ? visible : [...visible]).map((page) => (
            <li key={page.id}>
              <Link
                href={page.href}
                className="platform-card block hover:border-signal-500/40 transition-colors group"
              >
                <div className="flex items-start justify-between mb-2">
                  <h2 className="text-lg font-display text-foreground">
                    {page.title}
                  </h2>
                  <ArrowRight
                    className="w-4 h-4 text-neutral-500 group-hover:text-signal-500 transition-colors"
                    aria-hidden
                  />
                </div>
                <p className="text-sm text-neutral-400 mb-3">{page.summary}</p>
                <div className="flex flex-wrap gap-1.5">
                  {page.audience.map((aud) => (
                    <span
                      key={aud}
                      className="text-[0.62rem] uppercase tracking-wider rounded-full border border-border px-2 py-0.5 text-neutral-400"
                    >
                      {aud.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
