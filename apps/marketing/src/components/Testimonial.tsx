import { Quote, UserRound } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * Testimonial — three pilot placeholders with Tanzanian names.
 *
 * No real testimonials yet (pilot quotes available Q3 2026 per spec).
 * Each card is clearly badged "Pilot — quote pending" so visitors
 * can't mistake placeholder copy for an actual endorsement. Photo
 * placeholders are initial avatars in amber, not stock headshots.
 */
export function Testimonial({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).testimonial;
  const cards = pilotCards(locale);

  return (
    <section
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="testimonial-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="testimonial-heading"
          className="mt-4 font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-[58ch] text-base leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <ul className="mt-12 grid gap-5 md:grid-cols-3">
        {cards.map((c) => (
          <li
            key={c.name}
            className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-6"
          >
            <div className="flex items-center justify-between">
              <Quote className="h-6 w-6 text-signal-500" aria-hidden="true" />
              <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/30 bg-signal-500/5 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-widest text-signal-500">
                {t.placeholderBadge}
              </span>
            </div>

            <blockquote className="text-sm leading-relaxed text-neutral-400">
              <em>{c.placeholder}</em>
            </blockquote>

            <div className="mt-auto flex items-center gap-3 border-t border-border pt-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-signal-500/30 bg-surface-raised font-display text-sm font-medium text-signal-500">
                {c.initials}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                <p className="font-mono text-[0.65rem] uppercase tracking-widest text-neutral-500">
                  <UserRound className="mr-1 inline h-2.5 w-2.5" />
                  {c.role}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function pilotCards(locale: Locale) {
  const sw = [
    {
      name: 'Joyce Mhagama',
      initials: 'JM',
      role: 'Mmiliki · Geita PML pilot · sites 4',
      placeholder:
        'Quote ya pilot itapatikana baada ya wiki 12 za uendeshaji wa moja kwa moja na Master Brain.',
    },
    {
      name: 'Hamisi Ngao',
      initials: 'HN',
      role: 'Mwenyekiti · Mererani tanzanite co-op · members 18',
      placeholder:
        'Quote ya pilot itapatikana baada ya wiki 12 za uendeshaji wa moja kwa moja na Master Brain.',
    },
    {
      name: 'Asha Mwakajila',
      initials: 'AM',
      role: 'CFO · Songwe trading group · sites 9',
      placeholder:
        'Quote ya pilot itapatikana baada ya wiki 12 za uendeshaji wa moja kwa moja na Master Brain.',
    },
  ];
  const en = [
    {
      name: 'Joyce Mhagama',
      initials: 'JM',
      role: 'Owner · Geita PML pilot · 4 sites',
      placeholder:
        'Pilot quote available after 12 weeks of live Master Brain operation.',
    },
    {
      name: 'Hamisi Ngao',
      initials: 'HN',
      role: 'Chair · Mererani tanzanite co-op · 18 members',
      placeholder:
        'Pilot quote available after 12 weeks of live Master Brain operation.',
    },
    {
      name: 'Asha Mwakajila',
      initials: 'AM',
      role: 'CFO · Songwe trading group · 9 sites',
      placeholder:
        'Pilot quote available after 12 weeks of live Master Brain operation.',
    },
  ];
  return locale === 'sw' ? sw : en;
}
