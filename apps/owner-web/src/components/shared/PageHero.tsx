import type { ReactNode } from 'react';
import { PageHeader } from '@borjie/design-system';
import { getScreenBySlug } from '@/lib/screens';

interface PageHeroProps {
  readonly slug: string;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
}

/**
 * LitFin-rhythm page hero used by every owner-web route (CONVERGED onto
 * the DS `PageHeader`).
 *
 * The headline + intent + actions block is now delegated to `PageHeader`
 * from `@borjie/design-system` — the DS primitive owns the canonical
 * title / description / right-aligned-actions layout and its tokens. This
 * wrapper keeps owner-web's institutional chrome that DS does NOT model,
 * preserving the original composition top-to-bottom:
 *  1. Eyebrow strip — spec ID + persona pill (lowercase, mono).
 *  2. DS PageHeader: display headline (title) + intent body (description)
 *     + actions strip.
 *  3. Swahili gloss in italic, slotted under the headline via DS
 *     `description` is not enough (DS has one description), so the gloss
 *     stays above the DS block as part of our chrome.
 *  4. Optional meta strip (chips / counts / KPIs) below.
 *
 * Public API ({ slug, actions?, meta? }) is UNCHANGED — do not alter the
 * call signature; 20+ route pages import this verbatim.
 */
export function PageHero({ slug, actions, meta }: PageHeroProps) {
  const screen = getScreenBySlug(slug);
  if (!screen) {
    return (
      <header className="border-b border-border pb-6">
        <PageHeader title={`Unknown screen: ${slug}`} className="mb-0" />
      </header>
    );
  }
  return (
    <header className="border-b border-border pb-6">
      <div className="flex flex-wrap items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
        <span>{screen.id}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-muted-foreground">
          {screen.persona}
        </span>
      </div>
      <p className="mt-2 text-sm italic text-muted-foreground">
        {screen.titleSw}
      </p>
      <PageHeader
        title={screen.title}
        description={screen.intent}
        actions={actions}
        className="mt-3 mb-0"
      />
      {meta ? <div className="mt-6">{meta}</div> : null}
    </header>
  );
}
