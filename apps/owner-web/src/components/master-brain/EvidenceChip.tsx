'use client';

import { FileText } from 'lucide-react';

interface EvidenceChipProps {
  readonly id: string;
  readonly label?: string;
  readonly onClick: (id: string) => void;
}

/**
 * Clickable evidence pill rendered alongside brain replies. Clicking
 * pops the cited chunk into the side panel.
 *
 * Resolved label is supplied by the parent (which holds the evidence
 * map keyed by id from the live chat stream). When unresolved, falls
 * back to the raw id so the pill still renders something tappable.
 */
export function EvidenceChip({ id, label, onClick }: EvidenceChipProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-subtle/10 px-2 py-0.5 text-badge text-warning hover:bg-warning-subtle/30"
    >
      <FileText className="h-3 w-3" />
      {label ?? id}
    </button>
  );
}
