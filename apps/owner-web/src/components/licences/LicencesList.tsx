'use client';

import Link from 'next/link';
import { SectionCard } from '@/components/shared/SectionCard';
import { useLicencesList } from '@/lib/queries/licence';

interface RawLicence {
  readonly id?: string;
  readonly number?: string;
  readonly kind?: string;
  readonly mineral?: string;
  readonly status?: string;
  readonly expiryDate?: string;
  readonly dormancyScore?: number;
}

/**
 * Light-touch licences index. Live endpoint:
 * `/api/v1/mining/licences`. Falls back to an empty list with a
 * "No licences returned." message when the live response is empty.
 */
export function LicencesList(): JSX.Element {
  const query = useLicencesList();
  const rows = (query.data ?? []) as ReadonlyArray<RawLicence>;

  if (query.isPending) {
    return (
      <SectionCard title="Licences">
        <div className="h-24 animate-pulse rounded-md bg-surface/50" />
      </SectionCard>
    );
  }
  if (query.isError) {
    return (
      <SectionCard title="Licences">
        <p className="text-sm text-destructive">Failed to load licences.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={`Licences (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500">No licences returned.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((licence) => {
            const id = licence.id ?? licence.number ?? 'unknown';
            return (
              <li
                key={id}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
              >
                <div>
                  <div className="text-foreground">
                    {licence.kind ?? 'Licence'} {licence.number ?? id}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {[
                      licence.mineral,
                      licence.status,
                      licence.expiryDate ? `exp ${licence.expiryDate}` : null,
                    ]
                      .filter(Boolean)
                      .join(' - ')}
                  </div>
                </div>
                <Link
                  href={`/licence?id=${encodeURIComponent(id)}`}
                  className="text-xs text-signal-500 hover:underline"
                >
                  Open cockpit
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
