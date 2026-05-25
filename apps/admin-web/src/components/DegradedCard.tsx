import { AlertTriangle } from 'lucide-react';

export interface DegradedCardProps {
  readonly title: string;
  readonly reason: string;
}

/**
 * Honest degraded-state card. Shown when an upstream API is offline
 * or returns a 5xx. No mock data — the operator sees exactly why a
 * surface isn't rendering live numbers.
 */
export function DegradedCard({ title, reason }: DegradedCardProps) {
  return (
    <div className="platform-card-degraded">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-warning" />
        <span className="text-sm font-medium text-warning">{title}</span>
      </div>
      <p className="text-xs text-neutral-400">{reason}</p>
    </div>
  );
}
