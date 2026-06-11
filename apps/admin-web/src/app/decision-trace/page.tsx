/**
 * DecisionTrace list view (admin replay UI) — INV-A / FIRE-2.
 *
 * METADATA-ONLY by construction. The previous implementation read
 * `decision_traces` content directly via the `SUPABASE_SERVICE_ROLE_KEY`
 * (RLS-bypass, for any `?tenant=`, with no break-glass gate) inside this
 * public Next.js app. That crossed the INV-A control-plane wall AND held the
 * service-role key in a browser-facing surface.
 *
 * It now renders a thin shell over a client component that fetches the
 * metadata-only gateway projection
 * (`GET /api/v1/mining/internal/decision-trace`) using the platform-session
 * cookie. No service-role key lives in admin-web anymore. Decision CONTENT is
 * served only on the detail page under a tenant-consented break-glass grant.
 */

import { PageShell } from '@/components/migrated/PageShell';
import { DecisionTraceListClient } from './DecisionTraceListClient';

export const dynamic = 'force-dynamic';

export default function DecisionTraceListPage() {
  return (
    <PageShell
      title="Decision Trace Replay"
      subtitle="Structured audit replay for brain decisions, four-eye approvals, payouts, and tenant resolution. Metadata-only; content requires break-glass consent."
    >
      <DecisionTraceListClient />
    </PageShell>
  );
}
