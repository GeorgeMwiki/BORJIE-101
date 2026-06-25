'use client';

import { useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { Button } from '@borjie/design-system';
import { useGenerateRenewalPack } from '@/lib/queries/licence';
import { Toast } from '@/components/shared/Toast';
import { useLocale } from '@/lib/locale';
import { pickByLocale } from '@/lib/locale-shared';
import {
  licenceCockpitStrings as S,
  renewalPackItemLabel,
} from '@/i18n/strings/licence-cockpit';

interface RenewalActionsProps {
  readonly licenceId: string;
  readonly completePct: number;
  /**
   * Stable, locale-neutral renewal-pack item KEYS from the backend
   * (`renewalPackMissing`). Localized for display via `renewalPackItemLabel`.
   */
  readonly missing: ReadonlyArray<string>;
}

export function RenewalActions({ licenceId, completePct, missing }: RenewalActionsProps) {
  const locale = useLocale();
  const mutation = useGenerateRenewalPack();
  const [toastUrl, setToastUrl] = useState<string | null>(null);

  const generate = (): void => {
    mutation.mutate(
      { licenceId },
      {
        onSuccess: (data) => setToastUrl(data.url),
      },
    );
  };

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          {pickByLocale(locale, S.renewal.title)}
        </div>
        <div className="text-badge text-neutral-400">
          {pickByLocale(locale, S.renewal.completePct(completePct))}
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full bg-warning"
          style={{ width: `${completePct}%` }}
          role="progressbar"
          aria-valuenow={completePct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <ul className="mt-3 space-y-1 text-xs text-neutral-300">
        {missing.map((item) => (
          <li key={item}>· {renewalPackItemLabel(locale, item)}</li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        onClick={generate}
        loading={mutation.isPending}
        leftIcon={<FileCheck2 className="h-4 w-4" />}
        className="mt-4 border-warning bg-warning-subtle/30 text-warning hover:bg-warning-subtle/50 hover:text-warning"
      >
        {pickByLocale(locale, S.renewal.generate)}
      </Button>
      {toastUrl ? (
        <Toast
          message={pickByLocale(locale, S.renewal.ready)}
          actionLabel={pickByLocale(locale, S.renewal.openPdf)}
          onAction={() => window.open(toastUrl, '_blank')}
          onDismiss={() => setToastUrl(null)}
        />
      ) : null}
    </article>
  );
}
