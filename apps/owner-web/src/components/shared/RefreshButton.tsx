'use client';

import { RefreshCw } from 'lucide-react';

interface RefreshButtonProps {
  readonly onClick: () => void;
  readonly busy?: boolean;
  readonly label?: string;
}

export function RefreshButton({ onClick, busy, label = 'Refresh' }: RefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-neutral-300 hover:text-foreground disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      {label}
    </button>
  );
}
