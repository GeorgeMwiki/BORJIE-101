import { ScreenHeader } from '@/components/ScreenHeader';
import { DocumentSurface } from '@/components/documents/DocumentSurface';

/**
 * O-W-04 — Document chat (full PDF view).
 *
 * Three-column workspace: document list, PDF viewer (react-pdf when a
 * URL is available, synthetic preview with bbox overlays otherwise),
 * and a per-document chat that cites the exact chunk it grounded the
 * answer in. Comparison mode side-by-sides any two PDFs.
 */
export default function DocumentsPage() {
  return (
    <>
      <ScreenHeader slug="documents" />
      <div className="px-8 py-6">
        <DocumentSurface />
      </div>
    </>
  );
}
