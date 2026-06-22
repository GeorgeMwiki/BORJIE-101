import type { ReactNode } from 'react';
import { PageHeader } from '@borjie/design-system';

interface PageHeroProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
}

/**
 * LitFin-rhythm page hero for admin-web — now routed through the
 * design-system `PageHeader` for the title / subtitle / actions row.
 *
 * The public API (`eyebrow, title, subtitle, actions, meta`) is
 * preserved VERBATIM so every authenticated admin page keeps compiling
 * unchanged. The mono uppercase eyebrow and the optional meta slot are
 * admin-shell affordances the DS `PageHeader` does not model, so they
 * stay; the title, description, and actions delegate to the DS
 * primitive. The `border-b` hairline + `pb-6` rhythm is kept on the
 * wrapper (DS `PageHeader` ships only a `mb-6`), so layout is unchanged.
 */
export function PageHero({ eyebrow, title, subtitle, actions, meta }: PageHeroProps) {
  return (
    <header className="border-b border-border pb-6">
      <p className="mb-3 font-mono text-tiny uppercase tracking-eyebrow text-signal-500">
        {eyebrow}
      </p>
      <PageHeader
        title={title}
        {...(subtitle ? { description: subtitle } : {})}
        actions={actions}
        className="mb-0"
      />
      {meta ? <div className="mt-6">{meta}</div> : null}
    </header>
  );
}
