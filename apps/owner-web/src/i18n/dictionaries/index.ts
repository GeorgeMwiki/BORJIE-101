/**
 * Assembled locale → dictionary map. `en` is the human-authored source;
 * `sw` is the machine-generated mirror (see scripts/i18n-generate-sw.mjs).
 * Both are plain static data, so importing this from a client component
 * ships only JSON-shaped strings (no runtime/network at render).
 */

import type { Locale } from '@/lib/locale-shared';
import { en, type Dictionary } from './en';
import { sw } from './sw';

export type { Dictionary };

export const dictionaries: Readonly<Record<Locale, Record<string, unknown>>> = {
  en,
  sw,
};
