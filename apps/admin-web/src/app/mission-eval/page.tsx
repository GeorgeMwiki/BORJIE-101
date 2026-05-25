/**
 * Mission-eval admin page — Wave-K parity-litfin.
 *
 * Server component shell. The interactive table + drawer lives in the
 * sibling client component, which fetches from
 * `/api/v1/parity/capability/dashboard`.
 *
 * Mirrors LITFIN's `app/(admin)/org-admin/intelligence/mission-eval/
 * page.tsx`. The "Run audit" button is a future affordance — this
 * surface is read-only on first ship.
 */

import { PageShell } from '@/components/migrated/PageShell';
import { MissionEvalClient } from './MissionEvalClient';

export const dynamic = 'force-dynamic';

export default function MissionEvalPage() {
  return (
    <PageShell
      title="Mission-eval"
      subtitle="Eval runs, captured CoT, judge scores, and re-judge actions across the property-management capability surface."
    >
      <MissionEvalClient />
    </PageShell>
  );
}
