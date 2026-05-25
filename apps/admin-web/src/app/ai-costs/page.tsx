import { PageShell } from '@/components/migrated/PageShell';
import { AiCostsClient } from './AiCostsClient';

export default function AiCostsPage() {
  return (
    <PageShell
      title="AI spend"
      subtitle="Monthly LLM cost across every Borjie surface, with monthly cap and per-model breakdown."
    >
      <AiCostsClient />
    </PageShell>
  );
}
