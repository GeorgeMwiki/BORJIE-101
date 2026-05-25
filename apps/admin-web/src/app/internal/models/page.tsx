import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('models')!;

interface ModelRow {
  readonly id: string;
  readonly junior: string;
  readonly model: string;
  readonly provider: string;
  readonly p50ms: number;
  readonly monthCostUsd: number;
}

const MODELS: ReadonlyArray<ModelRow> = [
  { id: 'm_master', junior: 'Master Brain', model: 'claude-sonnet-4-5', provider: 'Anthropic', p50ms: 820, monthCostUsd: 482.10 },
  { id: 'm_geo', junior: 'Geology', model: 'claude-sonnet-4-5', provider: 'Anthropic', p50ms: 910, monthCostUsd: 244.55 },
  { id: 'm_comp', junior: 'Compliance', model: 'claude-opus-4-7', provider: 'Anthropic', p50ms: 1740, monthCostUsd: 612.80 },
  { id: 'm_sales', junior: 'Sales', model: 'claude-haiku-4-5', provider: 'Anthropic', p50ms: 280, monthCostUsd: 98.40 },
  { id: 'm_voice', junior: 'Voice transcribe', model: 'whisper-large-v3', provider: 'OpenAI', p50ms: 410, monthCostUsd: 36.20 },
  { id: 'm_embed', junior: 'Embeddings', model: 'embed-multilingual-v3', provider: 'Cohere', p50ms: 120, monthCostUsd: 28.10 },
];

export default function ModelsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Junior</th>
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium text-right">p50 latency</th>
              <th className="px-4 py-3 font-medium text-right">Spend (mo)</th>
            </tr>
          </thead>
          <tbody>
            {MODELS.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{row.junior}</td>
                <td className="px-4 py-3 text-neutral-300 font-mono text-xs">{row.model}</td>
                <td className="px-4 py-3">
                  <StubBadge tone="neutral">{row.provider}</StubBadge>
                </td>
                <td className="px-4 py-3 text-right text-neutral-300 tabular-nums">
                  {row.p50ms} ms
                </td>
                <td className="px-4 py-3 text-right text-neutral-300 tabular-nums">
                  ${row.monthCostUsd.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScreenShell>
  );
}
