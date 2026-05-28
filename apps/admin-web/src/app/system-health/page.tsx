import { PageHero } from '@/components/admin-shell/PageHero';
import { SystemHealthClient } from './SystemHealthClient';

/**
 * System health — live operational gauges across the Borjie runtime.
 *
 * Mirrors LitFin's `/litfin-admin/system-health` composition: page
 * hero with append-only badge in the actions slot, then the shared
 * live SystemHealthClient (api-gateway p99, brain ladder hit rates,
 * RLS deny counts, error budget burn, last 24h incidents).
 */
export default function SystemHealthPage(): JSX.Element {
  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Platform - Uangalifu"
        title="System health"
        subtitle="Live operational gauges across the Borjie runtime — events / second, LLM latency, daily spend, heartbeat and circuit breakers. Polls every 5 seconds."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-info/50 bg-info/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest text-info">
            5s poll
          </span>
        }
      />
      <SystemHealthClient />
    </div>
  );
}
