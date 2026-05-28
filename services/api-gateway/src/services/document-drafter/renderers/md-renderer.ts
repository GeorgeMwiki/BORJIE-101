/**
 * Markdown renderer — adds a Borjie-branded header/footer to a raw
 * markdown body.
 */

import type { BrandContext } from '../brand.js';
import { brandFooterText, brandHeaderText } from '../brand.js';

export function renderMarkdown(body: string, ctx: BrandContext): string {
  const header = `<!-- ${brandHeaderText(ctx)} -->`;
  const footer = `\n\n---\n_${brandFooterText(ctx)}_\n`;
  return `${header}\n\n${body.trim()}${footer}`;
}
