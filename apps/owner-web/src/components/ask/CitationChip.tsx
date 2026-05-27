'use client';

import { FileText } from 'lucide-react';
import type { BrainCitation } from '@/lib/brain-api';

interface CitationChipProps {
  readonly citation: BrainCitation;
  readonly onClick?: (citation: BrainCitation) => void;
}

/**
 * Corpus-chunk citation chip rendered alongside Brain replies on the
 * ask-Borjie surface. Mirrors the EvidenceChip used by the
 * master-brain page — but typed against the strongly-shaped
 * `BrainCitation` so the surface always shows
 * `mineral_code · section (score)` when the gateway includes that data.
 *
 * When the chip is clicked the host may open a side-panel with the
 * cited chunk — for now the surface only exposes the chip itself.
 */
export function CitationChip({ citation, onClick }: CitationChipProps) {
  const labelParts: string[] = [];
  if (citation.mineralCode) labelParts.push(citation.mineralCode);
  if (citation.section) labelParts.push(citation.section);
  const label = labelParts.length > 0 ? labelParts.join(' · ') : citation.id;
  const score =
    typeof citation.score === 'number' ? citation.score.toFixed(2) : null;
  const handle = () => {
    if (onClick) onClick(citation);
  };
  return (
    <button
      type="button"
      data-testid="brain-citation-chip"
      data-citation-id={citation.id}
      onClick={handle}
      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-subtle/10 px-2 py-0.5 text-badge text-warning hover:bg-warning-subtle/30"
      title={citation.sourceFile ?? citation.id}
    >
      <FileText className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
      {score ? (
        <span className="ml-1 font-mono text-tiny text-neutral-500">
          {score}
        </span>
      ) : null}
    </button>
  );
}
