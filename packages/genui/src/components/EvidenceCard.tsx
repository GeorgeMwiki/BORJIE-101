'use client';

/**
 * 16. evidence-card — document quote with cite-link.
 *
 * Critical for compliance reasoning ("MD says X because page 4 of
 * the lease says Y"). Renders the quote in a styled blockquote with
 * source reference + click-through, plus a confidence chip.
 */

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { EvidenceCardPartSchema } from '../schemas';
import { formatDate } from '../format';

export type EvidenceCardProps = AgUiUiPartByKind<'evidence-card'>;

const CONFIDENCE_CHIP: Record<string, string> = {
  high: 'bg-green-500/15 text-green-700 border-green-500/30',
  medium: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30',
  low: 'bg-red-500/15 text-red-700 border-red-500/30',
};

function safeHref(uri?: string): string | undefined {
  if (!uri) return undefined;
  if (/^(https?:\/\/|\/)/.test(uri)) return uri;
  return undefined;
}

export function EvidenceCard(props: EvidenceCardProps): JSX.Element {
  const parsed = EvidenceCardPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="evidence-card"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }
  const href = safeHref(props.sourceUri);
  return (
    <Frame kind="evidence-card" {...(props.title ? { title: props.title } : {})}>
      <div className="flex items-start justify-between gap-2">
        <blockquote className="flex-1 border-l-4 border-l-blue-500 bg-surface-sunken pl-3 pr-2 py-2 text-sm italic text-foreground">
          "{props.quote}"
        </blockquote>
        {props.confidence ? (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
              CONFIDENCE_CHIP[props.confidence] ?? ''
            }`}
          >
            {props.confidence}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>—</span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-blue-600 underline"
          >
            {props.sourceTitle}
          </a>
        ) : (
          <span className="font-medium text-foreground">{props.sourceTitle}</span>
        )}
        {props.sourcePageOrLocator ? (
          <span className="text-muted-foreground">· {props.sourcePageOrLocator}</span>
        ) : null}
        {props.extractedAt ? (
          <span className="text-muted-foreground">· extracted {formatDate(props.extractedAt)}</span>
        ) : null}
      </div>
    </Frame>
  );
}
