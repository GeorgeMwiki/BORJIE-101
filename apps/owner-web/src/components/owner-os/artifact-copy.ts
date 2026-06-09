/**
 * Bilingual copy for the modality artifact surface (closure Wave 8).
 *
 * Single-language per active locale — never mixed (CLAUDE.md EN/SW purity).
 * Every string resolves through the locale-bound translator so the Swahili
 * lives ONLY in the i18n dictionaries.
 */

import type { TFn } from '@/i18n/resolve';
import type { ArtifactKind } from '@/lib/tab-sse-parser';

/** Strip-friendly tab title per artifact kind, resolved locale-pure via t(). */
export function artifactTitle(kind: ArtifactKind, t: TFn): string {
  return t(`ownerOsShell.artifactTitle.${kind}`);
}
