import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-04 — Document chat (full PDF view).
 *
 * Split surface: left = PDF viewer with bounding-box highlights from
 * the Document agent's extractions, right = a chat that grounds every
 * answer in the bbox citations. Comparison mode diffs two revisions
 * side-by-side.
 */
export default function DocumentsPage() {
  return (
    <>
      <ScreenHeader slug="documents" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 lg:grid-cols-3">
        <PlaceholderCard title="PDF viewer">
          react-pdf canvas with bbox overlays from the Document agent. Click a
          highlight to anchor the chat to that paragraph.
        </PlaceholderCard>
        <PlaceholderCard title="Document chat">
          Per-doc chat thread. Every answer cites the bbox(es) that grounded
          it. Refuses to answer outside the document corpus.
        </PlaceholderCard>
        <PlaceholderCard title="Comparison view">
          Side-by-side diff: 2024 EPP vs 2025 EPP, prior vs current PML
          renewal pack. Material changes flagged.
        </PlaceholderCard>
      </div>
    </>
  );
}
