'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Sparkles } from 'lucide-react';

interface BaseProps {
  readonly locale: 'sw' | 'en';
  readonly icon?: LucideIcon;
  readonly titleEn: string;
  readonly titleSw: string;
}

interface ContractShape extends BaseProps {
  readonly bodyEn: string;
  readonly bodySw: string;
  readonly contractEn: string;
  readonly contractSw: string;
  readonly descriptionEn?: never;
  readonly descriptionSw?: never;
  readonly ctaEn?: never;
  readonly ctaSw?: never;
}

interface CtaShape extends BaseProps {
  readonly descriptionEn: string;
  readonly descriptionSw: string;
  readonly ctaEn?: string;
  readonly ctaSw?: string;
  readonly bodyEn?: never;
  readonly bodySw?: never;
  readonly contractEn?: never;
  readonly contractSw?: never;
}

export type EmptyPanelBodyProps = ContractShape | CtaShape;

/**
 * Empty-state body for panels whose BFF has not landed yet.
 *
 * Two shapes (discriminated by which props are passed):
 *
 *   1. CONTRACT shape — bodyEn / bodySw + contractEn / contractSw.
 *      Renders a 2-sentence body and a monospaced "contract" chip that
 *      names the API the panel will hit once shipped. Used by panels
 *      whose backend is pending (Accounting, Audit, ESG, Geology,
 *      Procurement, Legal, Reports).
 *
 *   2. CTA shape — descriptionEn / descriptionSw + optional ctaEn /
 *      ctaSw. Renders a description and an optional call-to-action
 *      button. Used by estate-domain panels (Subsidiaries, Holdings,
 *      Family Office, Succession, Ancillary, Asset Register) whose
 *      seed flow is owner-driven rather than BFF-driven.
 *
 * Both shapes share the LitFin empty-state rhythm (icon, title, body,
 * affordance) so the visual rhythm stays consistent across the cockpit.
 */
export function EmptyPanelBody(props: EmptyPanelBodyProps): ReactElement {
  const isSw = props.locale === 'sw';
  const Icon = props.icon ?? Sparkles;
  const isContract = 'bodyEn' in props && props.bodyEn !== undefined;
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center"
      data-testid="owner-os-panel-empty"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-warning/30 bg-warning/10 text-warning">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <h3 className="font-display text-base text-foreground">
          {isSw ? props.titleSw : props.titleEn}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
          {isContract
            ? isSw
              ? (props as ContractShape).bodySw
              : (props as ContractShape).bodyEn
            : isSw
              ? (props as CtaShape).descriptionSw
              : (props as CtaShape).descriptionEn}
        </p>
      </div>
      {isContract ? (
        <p className="rounded-md border border-border bg-surface/60 px-3 py-1.5 font-mono text-tiny text-neutral-400">
          {isSw
            ? (props as ContractShape).contractSw
            : (props as ContractShape).contractEn}
        </p>
      ) : (props as CtaShape).ctaEn ? (
        <button
          type="button"
          className="rounded-full border border-warning/40 bg-warning/10 px-4 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20"
        >
          {isSw
            ? ((props as CtaShape).ctaSw ?? (props as CtaShape).ctaEn)
            : (props as CtaShape).ctaEn}
        </button>
      ) : null}
    </div>
  );
}
