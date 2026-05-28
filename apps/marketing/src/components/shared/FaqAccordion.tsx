'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * FaqAccordion , LitFin-parity accordion block.
 *
 * Each row is a button + expandable body. The row shell uses the
 * same `rounded-2xl border bg-card` recipe the rest of the marketing
 * site shares (see `Docs/DESIGN/LITFIN_MEASURED_SPEC.md` Section 2
 * for radii). Animation is a CSS height transition so the bundle does
 * not pull framer-motion just for the legal page.
 *
 * Items are controlled locally; one open at a time. Keyboard support
 * comes from the native `<button>` semantics; the chevron rotates
 * 180 degrees when expanded for a clear affordance.
 */
export interface FaqItem {
  readonly q: string;
  readonly a: string;
}

interface FaqAccordionProps {
  readonly items: readonly FaqItem[];
}

export function FaqAccordion({ items }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={item.q}
            className="overflow-hidden rounded-2xl border border-border bg-card"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-surface-raised/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40"
            >
              <span className="pr-4 text-sm font-semibold text-foreground">
                {item.q}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            <div
              className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="min-h-0">
                <div className="border-t border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
