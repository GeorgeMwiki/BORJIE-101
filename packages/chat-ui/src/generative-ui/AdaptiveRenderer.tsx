import { Component } from 'react';
import type { ReactNode } from 'react';
import type {
  AdaptiveMessageMetadata,
  UIBlock,
  RoyaltyAffordabilityCalculatorBlock,
  OutstandingRoyaltyProjectionChartBlock,
  AssetComparisonTableBlock,
  OfftakeTimelineDiagramBlock,
  MaintenanceCaseFlowDiagramBlock,
  FivePsRiskWheelBlock,
  ConceptCardBlock,
  QuizBlock,
  ActionButtonsBlock,
  QuickRepliesBlock,
  InsightCardBlock,
  DynamicVisualBlock,
} from './types';
import type { Language, Translator } from '../chat-modes/types';
import { RoyaltyAffordabilityCalculator } from './blocks/royalty-affordability-calculator';
import { OutstandingRoyaltyProjectionChart } from './blocks/outstanding-royalty-projection-chart';
import { AssetComparisonTable } from './blocks/asset-comparison-table';
import { OfftakeTimelineDiagram } from './blocks/offtake-timeline-diagram';
import { MaintenanceCaseFlowDiagram } from './blocks/maintenance-case-flow-diagram';
import { FivePsOperatorRiskWheel } from './blocks/5ps-operator-risk-wheel';
import { logger } from '../logger.js';
import { toSafeSvg } from './sanitize-svg';

interface AdaptiveRendererProps {
  readonly metadata?: AdaptiveMessageMetadata | undefined;
  readonly language: Language;
  readonly t?: Translator | undefined;
  readonly onSendMessage?: ((msg: string) => void) | undefined;
  readonly onQuizAnswer?: ((blockId: string, optionId: string, correct: boolean) => void) | undefined;
}

class BlockErrorBoundary extends Component<
  { readonly children: ReactNode; readonly blockId: string },
  { readonly hasError: boolean }
> {
  constructor(props: { readonly children: ReactNode; readonly blockId: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error) {
    logger.error(`[chat-ui] block error (${this.props.blockId})`, { error: error });
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div data-testid={`block-error-${this.props.blockId}`} style={{ fontSize: 12, color: '#94a3b8' }}>
          Content unavailable
        </div>
      );
    }
    return this.props.children;
  }
}

function renderBlock(
  block: UIBlock,
  language: Language,
  t: Translator | undefined,
  handlers: {
    readonly onSendMessage?: ((msg: string) => void) | undefined;
    readonly onQuizAnswer?: ((blockId: string, optionId: string, correct: boolean) => void) | undefined;
  },
): ReactNode {
  switch (block.type) {
    case 'royalty_affordability_calculator':
      return (
        <RoyaltyAffordabilityCalculator
          key={block.id}
          block={block as RoyaltyAffordabilityCalculatorBlock}
          language={language}
          t={t}
        />
      );
    case 'outstanding_royalty_projection_chart':
      return (
        <OutstandingRoyaltyProjectionChart
          key={block.id}
          block={block as OutstandingRoyaltyProjectionChartBlock}
          language={language}
          t={t}
        />
      );
    case 'asset_comparison_table':
      return (
        <AssetComparisonTable
          key={block.id}
          block={block as AssetComparisonTableBlock}
          language={language}
          t={t}
        />
      );
    case 'offtake_timeline_diagram':
      return (
        <OfftakeTimelineDiagram
          key={block.id}
          block={block as OfftakeTimelineDiagramBlock}
          language={language}
          t={t}
        />
      );
    case 'maintenance_case_flow_diagram':
      return (
        <MaintenanceCaseFlowDiagram
          key={block.id}
          block={block as MaintenanceCaseFlowDiagramBlock}
          language={language}
          t={t}
        />
      );
    case 'five_ps_operator_risk_wheel':
      return (
        <FivePsOperatorRiskWheel
          key={block.id}
          block={block as FivePsRiskWheelBlock}
          language={language}
          t={t}
        />
      );
    case 'concept_card':
      return <ConceptCardRenderer key={block.id} block={block as ConceptCardBlock} />;
    case 'quiz':
      return (
        <QuizRenderer
          key={block.id}
          block={block as QuizBlock}
          onAnswer={handlers.onQuizAnswer}
        />
      );
    case 'action_buttons':
      return (
        <ActionButtonsRenderer
          key={block.id}
          block={block as ActionButtonsBlock}
          onSend={handlers.onSendMessage}
        />
      );
    case 'quick_replies':
      return (
        <QuickRepliesRenderer
          key={block.id}
          block={block as QuickRepliesBlock}
          onSend={handlers.onSendMessage}
        />
      );
    case 'insight_card':
      return <InsightCardRenderer key={block.id} block={block as InsightCardBlock} onSend={handlers.onSendMessage} />;
    case 'dynamic_visual':
      return <DynamicVisualRenderer key={block.id} block={block as DynamicVisualBlock} />;
    default:
      return (
        <div
          key={(block as UIBlock).id}
          data-testid="unknown-block"
          style={{ fontSize: 11, color: '#94a3b8' }}
        >
          Unknown block
        </div>
      );
  }
}

export function AdaptiveRenderer({
  metadata,
  language,
  t,
  onSendMessage,
  onQuizAnswer,
}: AdaptiveRendererProps) {
  const blocks = metadata?.uiBlocks ?? [];
  if (blocks.length === 0) return null;
  const inline = blocks.filter((b) => b.position === 'inline');
  const below = blocks.filter((b) => b.position === 'below' || !b.position);

  return (
    <div data-testid="adaptive-renderer" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {inline.map((b) => (
        <BlockErrorBoundary key={`eb-${b.id}`} blockId={b.id}>
          {renderBlock(b, language, t, { onSendMessage, onQuizAnswer })}
        </BlockErrorBoundary>
      ))}
      {below.map((b) => (
        <BlockErrorBoundary key={`eb-${b.id}`} blockId={b.id}>
          {renderBlock(b, language, t, { onSendMessage, onQuizAnswer })}
        </BlockErrorBoundary>
      ))}
    </div>
  );
}

// ============================================================================
// Inline renderers for simple blocks (kept local, non-exported)
// ============================================================================

function ConceptCardRenderer({ block }: { readonly block: ConceptCardBlock }) {
  return (
    <div
      data-testid="concept-card"
      style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{block.title}</div>
      {block.description && <div style={{ fontSize: 12, color: '#475569' }}>{block.description}</div>}
      {block.keyPoints.length > 0 && (
        <ul style={{ margin: '6px 0 0 0', paddingLeft: 18, fontSize: 12, color: '#334155' }}>
          {block.keyPoints.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuizRenderer({
  block,
  onAnswer,
}: {
  readonly block: QuizBlock;
  readonly onAnswer?: ((blockId: string, optionId: string, correct: boolean) => void) | undefined;
}) {
  return (
    <div
      data-testid="quiz-block"
      style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>{block.question}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {block.options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onAnswer?.(block.id, o.id, o.isCorrect)}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              fontSize: 13,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionButtonsRenderer({
  block,
  onSend,
}: {
  readonly block: ActionButtonsBlock;
  readonly onSend?: ((msg: string) => void) | undefined;
}) {
  return (
    <div
      data-testid="action-buttons"
      style={{ display: 'flex', flexDirection: block.layout === 'vertical' ? 'column' : 'row', gap: 6, flexWrap: 'wrap' }}
    >
      {block.buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onSend?.(b.action)}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid #cbd5e1',
            background: b.variant === 'primary' ? '#3b82f6' : '#fff',
            color: b.variant === 'primary' ? '#fff' : '#0f172a',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

function QuickRepliesRenderer({
  block,
  onSend,
}: {
  readonly block: QuickRepliesBlock;
  readonly onSend?: ((msg: string) => void) | undefined;
}) {
  return (
    <div data-testid="quick-replies" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {block.replies.map((r, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSend?.(r.prompt)}
          style={{
            padding: '4px 12px',
            borderRadius: 999,
            border: '1px solid #cbd5e1',
            background: '#f8fafc',
            fontSize: 12,
            color: '#334155',
            cursor: 'pointer',
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function InsightCardRenderer({
  block,
  onSend,
}: {
  readonly block: InsightCardBlock;
  readonly onSend?: ((msg: string) => void) | undefined;
}) {
  const colors: Record<InsightCardBlock['insightType'], string> = {
    tip: '#3b82f6',
    warning: '#f59e0b',
    success: '#16a34a',
    info: '#64748b',
  };
  return (
    <div
      data-testid="insight-card"
      style={{
        background: `${colors[block.insightType]}15`,
        borderLeft: `3px solid ${colors[block.insightType]}`,
        padding: 12,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{block.title}</div>
      <div style={{ fontSize: 12, color: '#475569' }}>{block.message}</div>
      {block.actionLabel && block.actionPrompt && (
        <button
          type="button"
          onClick={() => onSend?.(block.actionPrompt ?? '')}
          style={{
            marginTop: 6,
            fontSize: 12,
            color: colors[block.insightType],
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          {block.actionLabel} →
        </button>
      )}
    </div>
  );
}

function DynamicVisualRenderer({ block }: { readonly block: DynamicVisualBlock }) {
  return (
    <div
      data-testid="dynamic-visual"
      style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}
    >
      {block.title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{block.title}</div>
      )}
      <div
        role="img"
        aria-label={block.alt ?? block.title ?? 'Visual'}
        // `block.svg` is LLM-composed (svg-primitives) → untrusted. DOMPurify
        // (SVG profile) strips <script>/onload=/javascript: before injection.
        // CLAUDE.md: "No raw HTML interpolation. DOMPurify wraps required."
        dangerouslySetInnerHTML={{ __html: toSafeSvg(block.svg) }}
      />
      {block.caption && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{block.caption}</div>}
    </div>
  );
}
