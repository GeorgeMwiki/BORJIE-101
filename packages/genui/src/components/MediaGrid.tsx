'use client';

/**
 * 26. media-grid — property-photo / inspection-album gallery.
 *
 * CSS grid with a lightweight lightbox overlay. No heavy deps — uses
 * <img> + a click-to-zoom modal. Captions and "taken at" timestamps
 * render below each thumbnail.
 */

import { useState } from 'react';

import type { AgUiUiPartByKind, MediaGridItem } from '../types';
import { Frame, GenUiError } from './Frame';
import { MediaGridPartSchema } from '../schemas';
import { formatDate } from '../format';

export type MediaGridProps = AgUiUiPartByKind<'media-grid'>;

export function MediaGrid(props: MediaGridProps): JSX.Element {
  const parsed = MediaGridPartSchema.safeParse(props);
  const [active, setActive] = useState<MediaGridItem | null>(null);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="media-grid"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }

  const cols = props.columns ?? 3;
  return (
    <Frame kind="media-grid" {...(props.title ? { title: props.title } : {})}>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {props.items.map((item) => (
          <figure key={item.id} className="m-0 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setActive(item)}
              className="block overflow-hidden rounded border border-border bg-surface-sunken"
              aria-label={item.caption ?? item.id}
            >
              <img
                src={item.thumbUrl ?? item.url}
                alt={item.caption ?? item.id}
                loading="lazy"
                className="block aspect-[4/3] w-full object-cover"
              />
            </button>
            {(item.caption || item.takenAt) && (
              <figcaption className="text-[10px] text-muted-foreground">
                {item.caption ? <span>{item.caption}</span> : null}
                {item.caption && item.takenAt ? ' · ' : ''}
                {item.takenAt ? <span>{formatDate(item.takenAt)}</span> : null}
              </figcaption>
            )}
          </figure>
        ))}
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setActive(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] overflow-auto rounded border border-border bg-surface p-2"
          >
            <img
              src={active.url}
              alt={active.caption ?? active.id}
              className="max-h-[80vh] max-w-[85vw] object-contain"
            />
            <div className="mt-2 flex items-center justify-between text-xs">
              <span>{active.caption}</span>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="rounded border border-border bg-surface px-2 py-0.5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Frame>
  );
}
