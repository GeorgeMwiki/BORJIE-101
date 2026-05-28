import { PageShell } from '@/components/migrated/PageShell';
import { WorkforceTabPoliciesClient } from './WorkforceTabPoliciesClient';

/**
 * Borjie internal admin — workforce tab-policy fleet view.
 *
 * Wave WORKFORCE-FIXED-TABS. Cross-tenant read-only dashboard that
 * shows the distribution of enabled tabs per role across every tenant
 * in the fleet. Helps the Borjie team spot pilot tenants who have not
 * enabled enough tabs for their workers yet and reach out proactively.
 */
export default function WorkforceTabPoliciesPage() {
  return (
    <PageShell
      title="Workforce tab policies"
      subtitle="Cross-tenant distribution of enabled workforce tabs per role."
    >
      <WorkforceTabPoliciesClient />
    </PageShell>
  );
}
