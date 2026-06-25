/**
 * O-W-DOC-INTEL — "Documents as alive entities" cockpit surface.
 *
 * Mounted at /document-intelligence so it lives alongside the existing
 * O-W-04 /documents surface (which is read-only and renders a 3-column
 * doc workspace). The intelligence surface is the upload + chat seat.
 *
 * Thin server page: resolves the active locale from the cookie and seeds the
 * client island so SSR + the first client paint render the SAME language —
 * never an EN title under an SW header for a frame (the zero-mix canon).
 */

import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { DocumentIntelligencePanel } from './document-intelligence-panel';

export const dynamic = 'force-dynamic';

export default async function DocumentIntelligencePage() {
  const locale = await readLocaleFromServerCookies();
  return <DocumentIntelligencePanel initialLocale={locale} />;
}
