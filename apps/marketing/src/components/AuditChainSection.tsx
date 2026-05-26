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
  const fragment = chainFragment(locale);
  const guarantees = guaranteeCopy(locale);

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
              {locale === 'sw'
                ? 'Chain fragment · thread th_18a · entries 4 za mwisho'
                : 'Chain fragment · thread th_18a · last 4 entries'}
            </p>
            <span className="inline-flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-neutral-400">
              <ShieldCheck className="h-3 w-3 text-signal-500" />
              {locale === 'sw' ? 'Imehakikishwa' : 'Chain verified'}
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
                    <span className={entry.decisionClass}>{entry.decision}</span>
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
              {locale === 'sw'
                ? 'Chain depth: entries 18,429 · last signed 00:04 UTC · Tumemadini-exportable NDJSON bundle'
                : 'Chain depth: 18,429 entries · last signed 00:04 UTC · Tumemadini-exportable NDJSON bundle'}
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

function chainFragment(locale: Locale) {
  const sw = [
    {
      seq: 18426, at: '06:02:11', actor: 'user · owner', decision: 'imependekezwa',
      decisionClass: 'text-signal-500',
      action: 'mine.user_message · hash sha256:7b3a…e91',
      prev: '9f…c2', hash: '3a…e91', sig: 'hmac:4f…22',
    },
    {
      seq: 18427, at: '06:02:12', actor: 'master_brain', decision: 'imependekezwa',
      decisionClass: 'text-signal-500',
      action: 'mine.plan · hatua 3',
      prev: '3a…e91', hash: '8c…d04', sig: 'hmac:1a…9b',
    },
    {
      seq: 18428, at: '06:02:14', actor: 'master_brain', decision: 'imetekelezwa',
      decisionClass: 'text-success',
      action: 'mine.tool.graph_lookup · gold_inventory=184oz',
      prev: '8c…d04', hash: 'b1…7ae', sig: 'hmac:5d…c1',
    },
    {
      seq: 18429, at: '06:02:15', actor: 'master_brain', decision: 'imetekelezwa',
      decisionClass: 'text-success',
      action: 'mine.turn_done · 3.8s · nukuu 3 · artifact 0',
      prev: 'b1…7ae', hash: '2e…440', sig: 'hmac:9e…88',
    },
  ];
  const en = [
    {
      seq: 18426, at: '06:02:11', actor: 'user · owner', decision: 'proposed',
      decisionClass: 'text-signal-500',
      action: 'mine.user_message · hash sha256:7b3a…e91',
      prev: '9f…c2', hash: '3a…e91', sig: 'hmac:4f…22',
    },
    {
      seq: 18427, at: '06:02:12', actor: 'master_brain', decision: 'proposed',
      decisionClass: 'text-signal-500',
      action: 'mine.plan · 3 steps',
      prev: '3a…e91', hash: '8c…d04', sig: 'hmac:1a…9b',
    },
    {
      seq: 18428, at: '06:02:14', actor: 'master_brain', decision: 'executed',
      decisionClass: 'text-success',
      action: 'mine.tool.graph_lookup · gold_inventory=184oz',
      prev: '8c…d04', hash: 'b1…7ae', sig: 'hmac:5d…c1',
    },
    {
      seq: 18429, at: '06:02:15', actor: 'master_brain', decision: 'executed',
      decisionClass: 'text-success',
      action: 'mine.turn_done · 3.8s · 3 citations · 0 artifacts',
      prev: 'b1…7ae', hash: '2e…440', sig: 'hmac:9e…88',
    },
  ];
  return locale === 'sw' ? sw : en;
}

function guaranteeCopy(locale: Locale) {
  if (locale === 'sw') {
    return [
      {
        kicker: 'Inathibitishika',
        title: 'SHA-256 chain · HMAC kwa kila entry',
        body: 'Kila row ina prev-hash pointer pamoja na HMAC signature. Kuchezea entry yoyote kunavunja kila signature baada yake. Export, hakikisha offline.',
      },
      {
        kicker: 'Ufichuzi mdogo',
        title: 'Maudhui ya mtumiaji yamehashika, hayajahifadhiwa',
        body: 'Tumemadini wanaweza kuthibitisha kuwa uliuliza X kwa wakati T bila kufichua X tena. Ujumbe wenyewe upo kwenye memory ya conversation; chain ina provenance peke yake.',
      },
      {
        kicker: 'Imegawanyika',
        title: 'Tenant chain · Platform chain — havichanganyiki',
        body: 'Per-tenant audit chains ni huru kabisa. Platform-scope queries hutua kwenye platform chain iliyotengwa. Cross-scope probes hurudi empty, hazifichui existence.',
      },
    ];
  }
  return [
    {
      kicker: 'Provable, not promised',
      title: 'SHA-256 hash chain · HMAC per entry',
      body: 'Every row carries a prev-hash pointer plus an HMAC signature. Tampering any entry invalidates every signature after it. Export the chain, verify offline.',
    },
    {
      kicker: 'Minimal disclosure',
      title: 'User content is hashed, not stored',
      body: 'A Tumemadini auditor can prove you asked X at time T without re-disclosing X. Raw text lives in the conversation memory (scoped + revocable); the chain carries provenance only.',
    },
    {
      kicker: 'Scope-separated',
      title: 'Tenant chain · Platform chain — never mixed',
      body: 'Per-tenant audit chains are strictly isolated. Platform-scope queries land on a reserved platform chain. Cross-scope probes return empty, never leak existence.',
    },
  ];
}
