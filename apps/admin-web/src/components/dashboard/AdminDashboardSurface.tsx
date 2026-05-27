'use client';

import { TenantsOverviewPanel } from './TenantsOverviewPanel';
import { PilotErrorsPanel } from './PilotErrorsPanel';
import { KillSwitchStatusPanel } from './KillSwitchStatusPanel';
import { CorpusQueuePanel } from './CorpusQueuePanel';
import { FeatureFlagRolloutsPanel } from './FeatureFlagRolloutsPanel';
import { AuditChainIntegrityPanel } from './AuditChainIntegrityPanel';

/**
 * Admin dashboard surface — assembles six independent panels.
 *
 * Each panel owns its own react-query hook so an outage in one slot
 * does not blank the rest of the dashboard. The grid is two columns
 * on tablet, three on desktop; the audit chain panel spans full width
 * on small screens for legibility.
 */
export function AdminDashboardSurface(): JSX.Element {
  return (
    <section
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      data-testid="admin-dashboard-surface"
    >
      <TenantsOverviewPanel />
      <PilotErrorsPanel />
      <KillSwitchStatusPanel />
      <CorpusQueuePanel />
      <FeatureFlagRolloutsPanel />
      <AuditChainIntegrityPanel />
    </section>
  );
}
