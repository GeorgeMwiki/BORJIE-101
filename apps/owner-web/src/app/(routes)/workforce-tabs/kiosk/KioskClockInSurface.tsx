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
  const [siteId, setSiteId] = useState<string>(sites[0]?.id ?? '');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [recent, setRecent] = useState<ReadonlyArray<string>>([]);

  const onClockedIn = useCallback(
    (eventId: string): void => {
      setRecent((prev) => [
        `${new Date().toLocaleTimeString()} · ${employeeId} · ${eventId}`,
        ...prev,
      ].slice(0, 10));
      setEmployeeId('');
    },
    [employeeId],
  );

  return (
    <section className="rounded-md border border-border bg-surface p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="kiosk-site"
            className="block text-xs uppercase tracking-wide text-neutral-500"
          >
            {isSw ? 'Tovuti' : 'Site'}
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
            className="block text-xs uppercase tracking-wide text-neutral-500"
          >
            {isSw ? 'Namba ya mfanyikazi' : 'Employee ID'}
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
            placeholder={isSw ? 'kwa mfano: EMP-001' : 'e.g. EMP-001'}
            className="mt-2 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="mt-6 flex flex-col items-start gap-3">
        {siteId && employeeId.length > 0 ? (
          <WebAuthnClockIn
            employeeId={employeeId}
            siteId={siteId}
            onClockedIn={onClockedIn}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {isSw
              ? 'Chagua tovuti na andika namba ya mfanyikazi kuanza.'
              : 'Select a site and enter the worker badge ID to enable the passkey button.'}
          </p>
        )}
      </div>

      {recent.length > 0 ? (
        <div className="mt-6 border-t border-border pt-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
            {isSw ? 'Imeingia hivi karibuni' : 'Recent check-ins'}
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
