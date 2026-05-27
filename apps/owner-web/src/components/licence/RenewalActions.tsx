'use client';

import { useState } from 'react';
import { FileCheck2, Loader2 } from 'lucide-react';
import { useGenerateRenewalPack } from '@/lib/queries/licence';
import { Toast } from '@/components/shared/Toast';

interface RenewalActionsProps {
  readonly licenceId: string;
  readonly completePct: number;
  readonly missing: ReadonlyArray<string>;
}

export function RenewalActions({ licenceId, completePct, missing }: RenewalActionsProps) {
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
          Renewal pack
        </div>
        <div className="text-badge text-neutral-400">{completePct}% complete</div>
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
          <li key={item}>· {item}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={generate}
        disabled={mutation.isPending}
        className="mt-4 inline-flex items-center gap-2 rounded-md border border-warning bg-warning-subtle/30 px-3 py-2 text-sm text-warning hover:bg-warning-subtle/50 disabled:opacity-60"
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileCheck2 className="h-4 w-4" />
        )}
        Generate renewal pack
      </button>
      {toastUrl ? (
        <Toast
          message="Renewal pack ready for review."
          actionLabel="Open PDF"
          onAction={() => window.open(toastUrl, '_blank')}
          onDismiss={() => setToastUrl(null)}
        />
      ) : null}
    </article>
  );
}
