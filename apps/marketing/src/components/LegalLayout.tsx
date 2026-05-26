/**
 * LegalLayout — shared chrome for /privacy and /terms.
 *
 * Long-form bilingual legal content rendered as plain semantic HTML
 * (no client-side markdown parser — bundle stays slim and the content
 * is searchable). Caller provides title, last-updated date, language,
 * and a flat list of sections.
 */
import type { ReactNode } from 'react';
import type { Locale } from '@/lib/i18n';

type SiteLang = Locale;

export interface LegalSection {
  readonly id: string;
  readonly heading: string;
  readonly body: ReactNode;
}

export interface LegalLayoutProps {
  readonly title: string;
  readonly subtitle: string;
  readonly lastUpdated: string;
  readonly lang: SiteLang;
  readonly sections: ReadonlyArray<LegalSection>;
  readonly toc?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

const microcopy: Record<
  SiteLang,
  { tocHeading: string; lastUpdatedLabel: string; backToTop: string }
> = {
  sw: {
    tocHeading: 'Yaliyomo',
    lastUpdatedLabel: 'Imesasishwa',
    backToTop: 'Rudi juu',
  },
  en: {
    tocHeading: 'Contents',
    lastUpdatedLabel: 'Last updated',
    backToTop: 'Back to top',
  },
};

export function LegalLayout(props: LegalLayoutProps) {
  const m = microcopy[props.lang];
  return (
    <article className="mx-auto max-w-3xl px-6 py-16 text-[15px] leading-relaxed text-stone-800">
      <header className="mb-10 border-b border-stone-200 pb-6">
        <p className="text-xs uppercase tracking-widest text-amber-700">
          Borjie · Legal
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-900">
          {props.title}
        </h1>
        <p className="mt-2 text-stone-600">{props.subtitle}</p>
        <p className="mt-3 text-xs text-stone-500">
          {m.lastUpdatedLabel}: {props.lastUpdated}
        </p>
      </header>

      {props.toc && props.toc.length > 0 && (
        <nav
          aria-label={m.tocHeading}
          className="mb-10 rounded-md border border-stone-200 bg-stone-50 p-5"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-600">
            {m.tocHeading}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-amber-800">
            {props.toc.map((t) => (
              <li key={t.id}>
                <a className="hover:underline" href={`#${t.id}`}>
                  {t.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="space-y-10">
        {props.sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-24">
            <h2 className="mb-3 text-xl font-semibold text-stone-900">
              {s.heading}
            </h2>
            <div className="space-y-3 text-stone-700">{s.body}</div>
            <p className="mt-4 text-xs">
              <a href="#top" className="text-amber-700 hover:underline">
                {m.backToTop}
              </a>
            </p>
          </section>
        ))}
      </div>
    </article>
  );
}

/**
 * LegalParagraph — tiny convenience wrapper that keeps spacing
 * consistent across sections without polluting the main file with
 * inline className strings.
 */
export function LegalParagraph(props: { readonly children: ReactNode }) {
  return <p>{props.children}</p>;
}

export function LegalList(props: { readonly items: ReadonlyArray<ReactNode> }) {
  return (
    <ul className="list-disc space-y-1 pl-6 text-stone-700">
      {props.items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
