'use client';

import { FileText } from 'lucide-react';
import { MOCK_EVIDENCE_LIBRARY } from '@/lib/mocks/chat';

interface EvidenceChipProps {
  readonly id: string;
  readonly onClick: (id: string) => void;
}

/**
 * Clickable evidence pill rendered alongside brain replies. Clicking
 * pops the cited chunk into the side panel.
 */
export function EvidenceChip({ id, onClick }: EvidenceChipProps) {
  const evidence = MOCK_EVIDENCE_LIBRARY.find((e) => e.id === id);
  const label = evidence?.label ?? id;
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-subtle/10 px-2 py-0.5 text-[11px] text-warning hover:bg-warning-subtle/30"
    >
      <FileText className="h-3 w-3" />
      {label}
    </button>
  );
}
