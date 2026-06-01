'use client';

/**
 * FileRequestCardBlock — inline upload prompt that REALLY uploads.
 *
 * Schema source: `packages/owner-os-tabs/src/inline-blocks.ts` →
 * `fileRequestCardSchema`. Renders the ask + an inline picker.
 *
 * On pick the card streams the attached file(s) to the gateway document-
 * intelligence pipeline via `uploadChatDocuments` (which forwards the
 * Supabase bearer and unwraps the envelope), showing live per-file
 * progress while the promise is in flight. When it settles it fires
 * `onAction({action:'upload', payload:{whatFor, results}})` so the host
 * (HomeChatTeach) can reflect each outcome back into the transcript —
 * "Uploaded <name> — extracted N fields" on success, a graceful note on
 * failure. The card owns the network + progress; the host owns the chat
 * reflection. This replaces the old text-only `File[]` event that was
 * never JSON-serializable.
 *
 * `jumpToTabType` still spawns the full docs tab via
 * `onAction({action:'spawn_tab'})`.
 */

import { useRef, useState, type ReactElement } from 'react';
import { Upload, ExternalLink } from 'lucide-react';
import { dataBStrings as S } from '@/i18n/strings/data-b';
import { fillDocUpload } from '@/i18n/strings/doc-upload';
import {
  uploadChatDocuments,
  type DocUploadOutcome,
} from '@/lib/queries/doc-upload';

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
      | {
          readonly whatFor: string;
          readonly results: ReadonlyArray<DocUploadOutcome>;
        }
      | { readonly tabType: string };
  }) => void;
}

/** Live upload progress while files stream to the gateway. */
type UploadState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'busy';
      readonly total: number;
      readonly done: number;
      readonly firstName: string;
    };

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
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' });

  const handlePick = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0 || upload.phase === 'busy') return;
    const list = Array.from(files);
    setSelected(list.map((f) => f.name));
    setUpload({
      phase: 'busy',
      total: list.length,
      done: 0,
      firstName: list[0]?.name ?? '',
    });

    const results = await uploadChatDocuments(list, (done, total) =>
      setUpload({ phase: 'busy', total, done, firstName: list[0]?.name ?? '' }),
    );

    setUpload({ phase: 'idle' });
    onAction?.({ action: 'upload', payload: { whatFor, results } });
  };

  const busy = upload.phase === 'busy';

  return (
    <div
      data-testid="inline-block-file-request-card"
      className="rounded-xl border border-info/40 bg-info/[0.05] px-3 py-3"
    >
      <p className="text-tiny font-medium uppercase tracking-wide text-info">
        {locale === 'sw' ? S.fileReqEyebrow.sw : S.fileReqEyebrow.en}
      </p>
      {whatFor ? (
        <p className="mt-1 text-sm text-foreground">{whatFor}</p>
      ) : null}
      <p className="mt-1 text-tiny text-foreground/60">
        {locale === 'sw'
          ? `${S.fileReqAcceptedLabel.sw}: ${acceptedKinds.join(', ') || S.fileReqAcceptedFallback.sw} · ${S.fileReqMax.sw} ${maxSizeMb}MB`
          : `${S.fileReqAcceptedLabel.en}: ${acceptedKinds.join(', ') || S.fileReqAcceptedFallback.en} · ${S.fileReqMax.en} ${maxSizeMb}MB`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedKinds.join(',') || undefined}
          onChange={(e) => void handlePick(e.target.files)}
          disabled={busy}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-busy={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-info/40 bg-info/[0.08] px-3 py-1.5 text-sm font-semibold text-info transition-colors hover:bg-info/[0.15] disabled:opacity-60"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {locale === 'sw' ? S.fileReqUpload.sw : S.fileReqUpload.en}
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
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-tiny font-semibold text-foreground/80 transition-colors hover:bg-surface/80 disabled:opacity-60"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {locale === 'sw' ? S.fileReqOpenDocs.sw : S.fileReqOpenDocs.en}
          </button>
        ) : null}
      </div>
      {busy ? (
        <p
          className="mt-2 animate-pulse text-tiny text-info"
          data-testid="file-request-card-uploading"
        >
          {upload.total === 1
            ? fillDocUpload('uploading', locale, { name: upload.firstName })
            : fillDocUpload('uploadingProgress', locale, {
                done: upload.done,
                total: upload.total,
              })}
        </p>
      ) : selected.length > 0 ? (
        <p className="mt-2 text-tiny text-foreground/70">
          {locale === 'sw' ? S.fileReqSelected.sw : S.fileReqSelected.en}{' '}
          {selected.join(', ')}
        </p>
      ) : null}
    </div>
  );
}
