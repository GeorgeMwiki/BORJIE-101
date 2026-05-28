'use client';

/**
 * FileRequestCardBlock — inline upload prompt.
 *
 * Schema source: `packages/owner-os-tabs/src/inline-blocks.ts` →
 * `fileRequestCardSchema`. Renders the ask + an inline picker. On
 * pick the dispatcher fires `onAction` with `{action: 'upload',
 * payload: {whatFor, files: File[]}}`. The optional `jumpToTabType`
 * lets the owner spawn the full docs tab if they prefer.
 */

import { useRef, useState, type ReactElement } from 'react';
import { Upload, ExternalLink } from 'lucide-react';

export interface FileRequestCardBlock {
  readonly type: 'file_request_card';
  readonly whatFor?: string;
  readonly acceptedKinds?: ReadonlyArray<string>;
  readonly maxSizeMb?: number;
  readonly jumpToTabType?: string;
  readonly [extra: string]: unknown;
}

export interface FileRequestCardBlockProps {
  readonly block: FileRequestCardBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: 'upload' | 'spawn_tab';
    readonly payload:
      | { readonly whatFor: string; readonly files: ReadonlyArray<File> }
      | { readonly tabType: string };
  }) => void;
}

export function FileRequestCardBlock({
  block,
  locale,
  onAction,
}: FileRequestCardBlockProps): ReactElement {
  const whatFor = typeof block.whatFor === 'string' ? block.whatFor : '';
  const acceptedKinds = Array.isArray(block.acceptedKinds)
    ? block.acceptedKinds.filter((k): k is string => typeof k === 'string')
    : [];
  const maxSizeMb =
    typeof block.maxSizeMb === 'number' && block.maxSizeMb > 0
      ? block.maxSizeMb
      : 10;
  const jumpToTab =
    typeof block.jumpToTabType === 'string' && block.jumpToTabType.length > 0
      ? block.jumpToTabType
      : null;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);

  const handlePick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const names = list.map((f) => f.name);
    setSelected(names);
    onAction?.({
      action: 'upload',
      payload: { whatFor, files: list },
    });
  };

  return (
    <div
      data-testid="inline-block-file-request-card"
      className="rounded-xl border border-info/40 bg-info/[0.05] px-3 py-3"
    >
      <p className="text-tiny font-medium uppercase tracking-wide text-info">
        {locale === 'sw' ? 'Hati inahitajika' : 'Document needed'}
      </p>
      {whatFor ? (
        <p className="mt-1 text-sm text-foreground">{whatFor}</p>
      ) : null}
      <p className="mt-1 text-tiny text-foreground/60">
        {locale === 'sw'
          ? `Aina: ${acceptedKinds.join(', ') || 'PDF / picha'} · upeo ${maxSizeMb}MB`
          : `Accepted: ${acceptedKinds.join(', ') || 'PDF / image'} · max ${maxSizeMb}MB`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedKinds.join(',') || undefined}
          onChange={(e) => handlePick(e.target.files)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-info/40 bg-info/[0.08] px-3 py-1.5 text-sm font-semibold text-info transition-colors hover:bg-info/[0.15]"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {locale === 'sw' ? 'Pakia hati' : 'Upload document'}
        </button>
        {jumpToTab ? (
          <button
            type="button"
            onClick={() =>
              onAction?.({
                action: 'spawn_tab',
                payload: { tabType: jumpToTab },
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-tiny font-semibold text-foreground/80 transition-colors hover:bg-surface/80"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {locale === 'sw' ? 'Fungua docs' : 'Open docs tab'}
          </button>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <p className="mt-2 text-tiny text-foreground/70">
          {locale === 'sw' ? 'Imechaguliwa:' : 'Selected:'}{' '}
          {selected.join(', ')}
        </p>
      ) : null}
    </div>
  );
}
