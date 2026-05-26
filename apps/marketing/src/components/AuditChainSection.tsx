import { Fingerprint, Link2, ShieldCheck } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * AuditChainSection — hash-chained audit log explainer.
 *
 * Renders a mocked chain fragment (4 entries) so visitors see what an
 * actual audit row looks like — actor, decision, action, prev-hash,
 * this-hash, HMAC sig. Three guarantee cards on the right cover the
 * regulator-grade properties: SHA-256 chain, minimal disclosure,
 * tenant/platform scope separation.
 */
export function AuditChainSection({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).chain;
  const fragment = t.fragment;
  const guarantees = t.guarantees;

  return (
    <section
      className="relative mx-auto max-w-7xl px-6 pb-24 pt-4 lg:px-8"
      aria-labelledby="chain-heading"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h2
          id="chain-heading"
          className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl"
        >
          {t.heading}
        </h2>
        <p className="mx-auto mt-5 max-w-[60ch] text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <p className="font-mono text-[0.62rem] uppercase tracking-widest text-signal-500">
              {t.fragmentHeader}
            </p>
            <span className="inline-flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-neutral-400">
              <ShieldCheck className="h-3 w-3 text-signal-500" />
              {t.verifiedLabel}
            </span>
          </header>
          <ol className="divide-y divide-border">
            {fragment.map((entry) => (
              <li key={entry.seq} className="grid grid-cols-[auto_1fr] gap-4 px-5 py-3">
                <div className="flex flex-col items-center gap-1 pt-0.5">
                  <span className="font-mono text-[0.58rem] uppercase tracking-widest text-neutral-400">
                    #{entry.seq}
                  </span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-md border border-signal-500/30 bg-signal-500/5 text-signal-500">
                    <Link2 className="h-3 w-3" />
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2 font-mono text-[0.6rem] uppercase tracking-widest text-neutral-400">
                    <span>{entry.at}</span>
                    <span>·</span>
                    <span className="text-foreground">{entry.actor}</span>
                    <span>·</span>
                    <span className={decisionToneClass(entry.decisionTone)}>{entry.decision}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">{entry.action}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.62rem] text-neutral-400">
                    <span>
                      prev <span className="text-foreground">{entry.prev}</span>
                    </span>
                    <span>
                      this <span className="text-signal-500">{entry.hash}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Fingerprint className="h-2.5 w-2.5 text-signal-500" />
                      sig <span className="text-foreground">{entry.sig}</span>
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <footer className="border-t border-border px-5 py-3">
            <p className="font-mono text-[0.58rem] uppercase tracking-widest text-neutral-400">
              {t.depthFooter}
            </p>
          </footer>
        </div>

        <ul className="flex flex-col gap-5">
          {guarantees.map((g) => (
            <li
              key={g.title}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <p className="font-mono text-[0.62rem] uppercase tracking-widest text-signal-500">
                {g.kicker}
              </p>
              <h3 className="mt-2 font-display text-lg font-medium tracking-tight">
                {g.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{g.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function decisionToneClass(tone: string): string {
  if (tone === 'success') return 'text-success';
  return 'text-signal-500';
}
