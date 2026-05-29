'use client';

/**
 * DraftPreviewBlock — surfaces a Universal Drafter draft inline in the
 * home chat bubble.
 *
 * Schema source: `packages/owner-os-tabs/src/draft-preview-block.ts` →
 * `draftPreviewBlockSchema`. Shows the draft title, inferred kind, the
 * opening paragraph, citation count, revision number, and the available
 * action chips (render, send, revise, open_full, revert). On click each
 * chip dispatches through the standard `onAction` callback the inline
 * block renderer threads down; the host owns the dispatch contract.
 *
 * Wave UNIVERSAL-DOC-DRAFTER companion. Sibling renderer to
 * `DraftEditBlock` which handles the editable-revision flow.
 */

import type { ReactElement } from 'react';
import type { DraftPreviewBlock as DraftPreviewBlockShape } from '@borjie/owner-os-tabs';

export interface DraftPreviewBlockProps {
  readonly block: DraftPreviewBlockShape & Record<string, unknown>;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: string;
    readonly payload: Record<string, unknown>;
  }) => void;
}

interface NormalisedAction {
  readonly kind: string;
  readonly label: string;
  readonly payload: Record<string, unknown>;
}

function normaliseActions(
  raw: DraftPreviewBlockShape['actions'],
): ReadonlyArray<NormalisedAction> {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const kind =
      typeof entry?.kind === 'string' && entry.kind.length > 0
        ? entry.kind
        : 'noop';
    const label =
      typeof entry?.label === 'string' && entry.label.length > 0
        ? entry.label
        : kind;
    const payload =
      entry?.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
        ? (entry.payload as Record<string, unknown>)
        : {};
    return { kind, label, payload };
  });
}

function fallbackTitle(locale: 'sw' | 'en'): string {
  return locale === 'sw' ? 'Rasimu' : 'Draft';
}

export function DraftPreviewBlock({
  block,
  locale,
  onAction,
}: DraftPreviewBlockProps): ReactElement {
  const title =
    typeof block.title === 'string' && block.title.length > 0
      ? block.title
      : fallbackTitle(locale);
  const inferredKind =
    typeof block.inferredKind === 'string' ? block.inferredKind : '';
  const firstParagraph =
    typeof block.firstParagraph === 'string' ? block.firstParagraph : '';
  const citationsCount =
    typeof block.citationsCount === 'number' && Number.isFinite(block.citationsCount)
      ? Math.max(0, Math.trunc(block.citationsCount))
      : 0;
  const revisionNo =
    typeof block.revisionNo === 'number' && Number.isFinite(block.revisionNo)
      ? Math.max(1, Math.trunc(block.revisionNo))
      : 1;
  const auditHashTail =
    typeof block.auditHashTail === 'string' ? block.auditHashTail : '';
  const draftId = typeof block.draftId === 'string' ? block.draftId : '';
  const formats = Array.isArray(block.availableFormats)
    ? (block.availableFormats as ReadonlyArray<string>).filter(
        (f) => typeof f === 'string',
      )
    : [];
  const actions = normaliseActions(block.actions);

  const citationsLabel =
    locale === 'sw'
      ? `${citationsCount} marejeo`
      : citationsCount === 1
      ? '1 citation'
      : `${citationsCount} citations`;
  const revisionLabel =
    locale === 'sw' ? `Toleo #${revisionNo}` : `Rev #${revisionNo}`;

  return (
    <div
      data-testid="inline-block-draft-preview"
      className="rounded-xl border border-foreground/15 bg-surface/40 p-3 text-sm text-foreground"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold leading-tight text-foreground">
            {title}
          </div>
          {inferredKind.length > 0 ? (
            <div className="mt-0.5 truncate text-tiny uppercase tracking-wide text-foreground/55">
              {inferredKind}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right text-tiny text-foreground/55">
          <div>{revisionLabel}</div>
          <div>{citationsLabel}</div>
          {auditHashTail.length > 0 ? (
            <div className="font-mono">…{auditHashTail}</div>
          ) : null}
        </div>
      </div>
      {firstParagraph.length > 0 ? (
        <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-snug text-foreground/85">
          {firstParagraph}
        </p>
      ) : null}
      {formats.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {formats.map((f) => (
            <span
              key={f}
              className="rounded-full border border-foreground/15 bg-surface px-2 py-0.5 text-tiny uppercase tracking-wide text-foreground/65"
            >
              {f}
            </span>
          ))}
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a, idx) => (
            <button
              key={`${a.kind}-${idx}`}
              type="button"
              onClick={() => {
                if (!onAction) return;
                onAction({
                  action: `draft_preview.${a.kind}`,
                  payload: { draftId, revisionNo, ...a.payload },
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 bg-surface px-2.5 py-1 text-tiny font-medium text-foreground transition-colors hover:bg-surface/80"
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
