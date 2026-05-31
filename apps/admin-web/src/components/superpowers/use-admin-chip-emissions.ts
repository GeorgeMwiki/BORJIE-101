'use client';

/**
 * Wave SUPERPOWERS (admin-web) — chip emission hook.
 *
 * Surface for chat components: subscribe to a window `borjie:admin:chip-emit`
 * event that publishes one validated chip at a time. The hook accumulates
 * the chips for the current assistant turn (`turnKey`) so the renderer
 * (`AdminSuperpowerChips`) can mount them under the matching bubble.
 *
 * Why a bus: the admin envelope endpoint (`/brain/turn`) returns a single
 * JSON response today, but the upcoming SSE migration will emit
 * incremental chip frames. This bus is the contract for both: a callsite
 * can publish chips either from a one-shot envelope mapper or from an
 * SSE frame handler with no API surface change.
 */

import { useEffect, useState } from 'react';
import { z } from 'zod';

import {
  uiNavigateChipSchema,
  uiPrefillChipSchema,
  uiHighlightChipSchema,
  uiShareChipSchema,
  uiBulkChipSchema,
  uiBookmarkChipSchema,
  type UiNavigateChip,
  type UiPrefillChip,
  type UiHighlightChip,
  type UiShareChip,
  type UiBulkChip,
  type UiBookmarkChip,
} from './chip-schemas';

export const ADMIN_CHIP_EMIT_EVENT_NAME = 'borjie:admin:chip-emit';

const chipFamilyEnum = z.enum([
  'ui_navigate',
  'ui_prefill',
  'ui_highlight',
  'ui_share',
  'ui_bulk',
  'ui_bookmark',
]);

const emitSchema = z.object({
  turnKey: z.string().min(1).max(120),
  family: chipFamilyEnum,
  chip: z.unknown(),
});

export interface ChipEmitEvent {
  readonly turnKey: string;
  readonly family: z.infer<typeof chipFamilyEnum>;
  readonly chip: unknown;
}

export function emitAdminChip(detail: ChipEmitEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(ADMIN_CHIP_EMIT_EVENT_NAME, { detail }),
  );
}

export interface ChipBuckets {
  readonly navigates: ReadonlyArray<UiNavigateChip>;
  readonly prefills: ReadonlyArray<UiPrefillChip>;
  readonly highlights: ReadonlyArray<UiHighlightChip>;
  readonly shares: ReadonlyArray<UiShareChip>;
  readonly bulks: ReadonlyArray<UiBulkChip>;
  readonly bookmarks: ReadonlyArray<UiBookmarkChip>;
}

const EMPTY: ChipBuckets = {
  navigates: [],
  prefills: [],
  highlights: [],
  shares: [],
  bulks: [],
  bookmarks: [],
};

export function useAdminChipEmissions(turnKey: string | null): ChipBuckets {
  const [buckets, setBuckets] = useState<ChipBuckets>(EMPTY);

  useEffect(() => {
    if (!turnKey || typeof window === 'undefined') return undefined;
    setBuckets(EMPTY);
    const onEmit = (e: Event): void => {
      const detail = (e as CustomEvent<unknown>).detail;
      const parsed = emitSchema.safeParse(detail);
      if (!parsed.success) return;
      if (parsed.data.turnKey !== turnKey) return;
      setBuckets((prev) => {
        switch (parsed.data.family) {
          case 'ui_navigate': {
            const chip = uiNavigateChipSchema.safeParse(parsed.data.chip);
            if (!chip.success) return prev;
            return {
              ...prev,
              navigates: [...prev.navigates, chip.data].slice(0, 3),
            };
          }
          case 'ui_prefill': {
            const chip = uiPrefillChipSchema.safeParse(parsed.data.chip);
            if (!chip.success) return prev;
            return {
              ...prev,
              prefills: [...prev.prefills, chip.data].slice(0, 3),
            };
          }
          case 'ui_highlight': {
            const chip = uiHighlightChipSchema.safeParse(parsed.data.chip);
            if (!chip.success) return prev;
            return {
              ...prev,
              highlights: [...prev.highlights, chip.data].slice(0, 3),
            };
          }
          case 'ui_share': {
            const chip = uiShareChipSchema.safeParse(parsed.data.chip);
            if (!chip.success) return prev;
            return {
              ...prev,
              shares: [...prev.shares, chip.data].slice(0, 3),
            };
          }
          case 'ui_bulk': {
            const chip = uiBulkChipSchema.safeParse(parsed.data.chip);
            if (!chip.success) return prev;
            return {
              ...prev,
              bulks: [...prev.bulks, chip.data].slice(0, 3),
            };
          }
          case 'ui_bookmark': {
            const chip = uiBookmarkChipSchema.safeParse(parsed.data.chip);
            if (!chip.success) return prev;
            return {
              ...prev,
              bookmarks: [...prev.bookmarks, chip.data].slice(0, 3),
            };
          }
          default: {
            const exhaustive: never = parsed.data.family;
            void exhaustive;
            return prev;
          }
        }
      });
    };
    window.addEventListener(ADMIN_CHIP_EMIT_EVENT_NAME, onEmit);
    return () =>
      window.removeEventListener(ADMIN_CHIP_EMIT_EVENT_NAME, onEmit);
  }, [turnKey]);

  return buckets;
}
