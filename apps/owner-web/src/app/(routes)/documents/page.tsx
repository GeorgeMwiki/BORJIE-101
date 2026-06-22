import { ScreenHeader } from '@/components/ScreenHeader';
import { DocumentSurface } from '@/components/documents/DocumentSurface';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

/**
 * O-W-04 — Document chat (full PDF view).
 *
 * Three-column workspace: document list, PDF viewer (react-pdf when a
 * URL is available, synthetic preview with bbox overlays otherwise),
 * and a per-document chat that cites the exact chunk it grounded the
 * answer in. Comparison mode side-by-sides any two PDFs.
 *
 * Resolves the locale ONCE on the server and seeds the client
 * DocumentSurface so the first paint matches the SSR chrome (no
 * EN-under-SW split-brain).
 */
export default async function DocumentsPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return (
    <>
      <ScreenHeader slug="documents" />
      <div className="px-8 py-6">
        <DocumentSurface initialLocale={initialLocale} />
      </div>
    </>
  );
}
