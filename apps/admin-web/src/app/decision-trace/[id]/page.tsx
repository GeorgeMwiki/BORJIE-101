/**
 * DecisionTrace replay detail view — INV-A / FIRE-2.
 *
 * The previous implementation read a single `decision_traces` row (full
 * CONTENT) via the `SUPABASE_SERVICE_ROLE_KEY` RLS-bypass inside this public
 * Next.js app. That crossed the INV-A wall and held the service-role key in a
 * browser-facing surface.
 *
 * It now renders a thin shell over a client component that fetches:
 *   - metadata header   → GET /mining/internal/decision-trace/:id (always)
 *   - decision content  → GET /mining/internal/decision-trace/:id/content
 *                         (break-glass: deny-by-default until the tenant
 *                         consents to a time-boxed grant; every read audited).
 * No service-role key lives in admin-web anymore.
 */

import { PageShell } from '@/components/migrated/PageShell';
import { DecisionTraceDetailClient } from './DecisionTraceDetailClient';

export const dynamic = 'force-dynamic';

type PageProps = {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ tenant?: string }>;
};

export default async function DecisionTraceDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { tenant } = await searchParams;
  const tenantId = tenant && tenant.trim().length > 0 ? tenant.trim() : null;

  return (
    <PageShell title="Decision Trace Replay" subtitle="Metadata header is always visible; decision content requires tenant-consented break-glass.">
      <DecisionTraceDetailClient traceId={id} tenant={tenantId} />
    </PageShell>
  );
}
