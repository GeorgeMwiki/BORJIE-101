/**
 * Mission-eval CoT drill-down page — Phase D / D12.11.
 *
 * Per-scenario surface that lets an admin inspect every CoT sample
 * captured for a particular scenario id, alongside the judge's score
 * + reasoning. Closes the A4 visibility gap: today, when an aggregate
 * mean-judge-score regresses, the admin had no UI path to ask "WHICH
 * scenario regressed and what did the judge say?".
 *
 * Server component shell. The interactive table + drawer is the sibling
 * client component, which fetches:
 *
 *   GET /api/v1/parity/capability/dashboard/scenarios/:scenarioId/samples
 *
 * Admin-gated (SUPER_ADMIN + ADMIN) by the staff layout. CoT text is
 * PII-scrubbed at the persist boundary; raw text is gated behind the
 * `cot:read:raw` sovereign scope (handled by the api-gateway).
 */

import { PageShell } from '@/components/migrated/PageShell';
import { MissionEvalScenarioDrillDown } from './MissionEvalScenarioDrillDown';

export const dynamic = 'force-dynamic';

interface MissionEvalScenarioPageProps {
  readonly params: Promise<{ scenarioId: string }>;
}

export default async function MissionEvalScenarioPage({
  params,
}: MissionEvalScenarioPageProps) {
  const { scenarioId } = await params;
  return (
    <PageShell
      title={`Scenario ${scenarioId}`}
      subtitle="Per-scenario CoT samples with judge score, judge reason, and a re-judge action. CoT is PII-scrubbed at capture."
    >
      <MissionEvalScenarioDrillDown scenarioId={scenarioId} />
    </PageShell>
  );
}
