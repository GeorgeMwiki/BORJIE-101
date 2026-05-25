/**
 * Format registry. Built-in 17 handlers + a `register()` API for
 * custom formats. Mime → handler routing answers "which engines
 * should I try for this byte stream?"
 *
 * Custom handlers override built-ins for the same format key so a
 * tenant can plug in a tighter chain (e.g. force `typst` for all
 * PDFs in their tenant) without forking the package.
 */

import type { FormatHandler, SupportedFormat } from '../types.js';
import { BUILT_IN_HANDLERS } from './handlers.js';

export interface FormatRegistry {
  register(handler: FormatHandler): void;
  byFormat(format: SupportedFormat): FormatHandler | undefined;
  byMime(mime: string): FormatHandler | undefined;
  list(): ReadonlyArray<FormatHandler>;
}

export function createFormatRegistry(
  initial: ReadonlyArray<FormatHandler> = BUILT_IN_HANDLERS,
): FormatRegistry {
  const byFormat = new Map<SupportedFormat, FormatHandler>();
  const byMime = new Map<string, FormatHandler>();

  function registerLocal(h: FormatHandler): void {
    byFormat.set(h.format, h);
    for (const mime of h.mimeTypes) {
      byMime.set(mime.toLowerCase(), h);
    }
  }

  for (const h of initial) registerLocal(h);

  return {
    register: registerLocal,
    byFormat: (format) => byFormat.get(format),
    byMime: (mime) => byMime.get(mime.toLowerCase()),
    list: () => Object.freeze(Array.from(byFormat.values())),
  };
}

export { BUILT_IN_HANDLERS } from './handlers.js';
