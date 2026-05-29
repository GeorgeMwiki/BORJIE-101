import { PageHero } from '@/components/admin-shell/PageHero';
import { ControlTowerClient } from './ControlTowerClient';

/**
 * Control Tower — cross-tenant ops console.
 *
 * KPI grid at top (active tenants, brain turns/min, error budget,
 * RLS denies) then the dense platform-controls list. Every control
 * toggle opens a four-eye confirmation modal because flipping these
 * affects every tenant simultaneously.
 */
export default function ControlTowerPage(): JSX.Element {
  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Operations - Mnara"
        title="Control Tower"
        subtitle="Cross-tenant operations console. Kill-switches, autonomy flags, rate-limit knobs and platform KPIs. Every action requires a four-eye attestation and lands on the hash-chained audit trail."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-tiny font-mono uppercase tracking-widest text-warning">
            Blast radius global
          </span>
        }
      />
      <ControlTowerClient />
    </div>
  );
}
