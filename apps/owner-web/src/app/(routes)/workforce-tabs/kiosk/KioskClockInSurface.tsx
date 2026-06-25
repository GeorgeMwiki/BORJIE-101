'use client';

/**
 * KioskClockInSurface — client-island host for `WebAuthnClockIn`.
 *
 * The kiosk pattern: supervisor selects a worker + a site, then the
 * worker authenticates against the platform authenticator and the
 * clock-in event records both identities.
 *
 * Worker selection is intentionally typed (not a dropdown of every
 * employee in the tenant) — kiosks live at the gate; the supervisor
 * just types the worker ID printed on the badge. A scanner upgrade
 * can swap the input for `<EmployeeBadgeScanner />` later without
 * touching this file.
 */

import { useCallback, useState } from 'react';
import { WebAuthnClockIn } from '@/components/workforce/WebAuthnClockIn';
import { fmtTimeForLocale } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import { routesBStrings as S } from '@/i18n/strings/routes-b';

interface SiteOption {
  readonly id: string;
  readonly label: string;
}

interface KioskClockInSurfaceProps {
  readonly sites: ReadonlyArray<SiteOption>;
  readonly isSw: boolean;
}

export function KioskClockInSurface({
  sites,
  isSw,
}: KioskClockInSurfaceProps): JSX.Element {
  // The host already resolved the user's language server-side (the `isSw`
  // prop). Derive the active `Locale` from it so SSR and first client paint
  // agree — threaded into the now-locale-aware `WebAuthnClockIn` child and
  // used for locale-correct time formatting below.
  const locale: Locale = isSw ? 'sw' : 'en';
  const [siteId, setSiteId] = useState<string>(sites[0]?.id ?? '');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [recent, setRecent] = useState<ReadonlyArray<string>>([]);

  const onClockedIn = useCallback(
    (eventId: string): void => {
      const stamp = fmtTimeForLocale(new Date().toISOString(), locale);
      setRecent((prev) => [
        `${stamp} · ${employeeId} · ${eventId}`,
        ...prev,
      ].slice(0, 10));
      setEmployeeId('');
    },
    [employeeId, locale],
  );

  return (
    <section className="rounded-md border border-border bg-surface p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="kiosk-site"
            className="block text-xs uppercase tracking-wide text-muted-foreground"
          >
            {isSw ? S.kioskSurface.site.sw : S.kioskSurface.site.en}
          </label>
          <select
            id="kiosk-site"
            value={siteId}
            onChange={(e): void => setSiteId(e.target.value)}
            className="mt-2 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="kiosk-employee"
            className="block text-xs uppercase tracking-wide text-muted-foreground"
          >
            {isSw ? S.kioskSurface.employeeId.sw : S.kioskSurface.employeeId.en}
          </label>
          <input
            id="kiosk-employee"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={employeeId}
            onChange={(e): void =>
              setEmployeeId(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64))
            }
            placeholder={
              isSw
                ? S.kioskSurface.employeePlaceholder.sw
                : S.kioskSurface.employeePlaceholder.en
            }
            className="mt-2 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="mt-6 flex flex-col items-start gap-3">
        {siteId && employeeId.length > 0 ? (
          <WebAuthnClockIn
            employeeId={employeeId}
            siteId={siteId}
            locale={locale}
            onClockedIn={onClockedIn}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {isSw
              ? S.kioskSurface.selectPrompt.sw
              : S.kioskSurface.selectPrompt.en}
          </p>
        )}
      </div>

      {recent.length > 0 ? (
        <div className="mt-6 border-t border-border pt-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            {isSw ? S.kioskSurface.recentCheckIns.sw : S.kioskSurface.recentCheckIns.en}
          </h2>
          <ul className="space-y-1 font-mono text-xs text-foreground">
            {recent.map((line, idx) => (
              <li key={idx}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
