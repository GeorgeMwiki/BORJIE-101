import { getMessages, type Locale } from '@/lib/i18n';

/**
 * TrustStrip — single-row, uppercase, mono-set list of the institutions
 * a Tanzanian mining operator already recognises (BRELA, TRA, Tumemadini,
 * NEMC, LBMA-grade assay labs, mobile-money rails). Stands in for the
 * "regulator + customer logo wall" that LitFin uses to anchor the hero —
 * but with text, not stock logos, because (a) regulator marks need
 * permission, (b) the words themselves are the trust signal.
 *
 * Lives directly under the hero with a single hairline border above and
 * generous vertical breathing room. Reads as one calm declarative line.
 */
export function TrustStrip({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).trust;

  return (
    <section
      className="relative border-y border-border/50 bg-surface-sunken/40"
      aria-labelledby="trust-kicker"
    >
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <p
          id="trust-kicker"
          className="text-center font-mono text-caption uppercase tracking-widest text-neutral-500"
        >
          {t.kicker}
        </p>
        <ul
          className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 sm:gap-x-14"
          aria-label={t.kicker}
        >
          {t.logos.map((logo) => (
            <li
              key={logo}
              className="font-mono text-caption-lg uppercase tracking-widest text-neutral-400 transition-colors duration-fast hover:text-foreground"
            >
              {logo}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
