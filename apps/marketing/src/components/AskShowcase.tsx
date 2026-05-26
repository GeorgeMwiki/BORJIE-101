import { ShieldCheck, MessageSquare } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * AskShowcase — chat-mock with streamed answer + evidence chip.
 *
 * Mining-realistic question ("What's my cash runway?"). The Master
 * Brain's answer pulls TZS bank balances, gold inventory @ live LBMA
 * spot, and trailing burn rate. Evidence chip cites TRA bank feed,
 * LBMA spot, and an off-take reference. Inline CSS cursor blink shows
 * the stream "live" without JS.
 */
export function AskShowcase({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).ask;
  const sc = t.showcase;

  return (
    <section
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="ask-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="ask-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-[58ch] text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <article className="mx-auto mt-14 flex max-w-3xl flex-col gap-5 rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-widest text-signal-500">
              <MessageSquare className="h-3 w-3" />
              {sc.kicker}
            </p>
            <h3 className="mt-2 font-display text-2xl font-medium tracking-tight">
              {sc.title}
            </h3>
            <p className="mt-1 text-sm text-neutral-400">{sc.subtitle}</p>
          </div>
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[0.62rem] text-neutral-400">
            on-chain
          </span>
        </header>

        <div className="rounded-xl border border-border bg-background p-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-widest text-neutral-400">
            {sc.youAsked}
          </p>
          <p className="mt-1 text-[0.95rem] font-medium text-foreground">{t.question}</p>
        </div>

        <div className="rounded-xl border border-signal-500/20 bg-signal-500/[0.04] p-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-widest text-signal-500">
            {sc.plan}
          </p>
          <ol className="mt-2 space-y-1">
            {t.answerPlan.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-[0.8rem] text-foreground">
                <span className="mt-0.5 font-mono text-[0.6rem] text-signal-500 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <p className="font-mono text-[0.62rem] uppercase tracking-widest text-neutral-400">
            {sc.answerLabel}
          </p>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-foreground">
            {t.answer}
            <span className="stream-cursor" aria-hidden="true" />
          </p>

          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-signal-500/30 bg-signal-500/5 px-3 py-1.5">
            <ShieldCheck className="h-3 w-3 text-signal-500" />
            <span className="font-mono text-[0.62rem] uppercase tracking-widest text-signal-500">
              {t.evidence}
            </span>
          </div>
        </div>
      </article>
    </section>
  );
}
