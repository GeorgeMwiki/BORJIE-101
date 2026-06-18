'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@borjie/design-system';

interface RefreshButtonProps {
  readonly onClick: () => void;
  readonly busy?: boolean;
  readonly label?: string;
}

export function RefreshButton({ onClick, busy, label = 'Refresh' }: RefreshButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      loading={busy ?? false}
      leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
      className="gap-1.5 text-neutral-300 hover:text-foreground"
    >
      {label}
    </Button>
  );
}
