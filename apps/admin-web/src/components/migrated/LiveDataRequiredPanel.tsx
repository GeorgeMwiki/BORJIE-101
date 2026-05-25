import { AlertTriangle } from 'lucide-react';

interface LiveDataRequiredPanelProps {
  readonly feature: string;
  readonly description?: string;
}

/**
 * Honest "this surface needs live data" placeholder used for migrated
 * pages whose backend wiring isn't ready yet. Mirrors the
 * LiveDataRequiredPage component the legacy admin-portal had — no mock
 * data is rendered in its place.
 */
export function LiveDataRequiredPanel({
  feature,
  description,
}: LiveDataRequiredPanelProps) {
  const fallback = `${feature} renders only from live aggregates. Re-check once the upstream service is online.`;
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-warning">
            {feature} unavailable
          </h2>
          <p className="text-sm text-neutral-300">{description ?? fallback}</p>
        </div>
      </div>
    </div>
  );
}
