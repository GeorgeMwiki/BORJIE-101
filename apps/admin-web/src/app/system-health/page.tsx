import { PageHero } from '@/components/admin-shell/PageHero';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { SystemHealthClient } from './SystemHealthClient';

/**
 * System health — live operational gauges across the Borjie runtime.
 *
 * Mirrors the reference admin system-health composition: page
 * hero with append-only badge in the actions slot, then the shared
 * live SystemHealthClient (api-gateway p99, brain ladder hit rates,
 * RLS deny counts, error budget burn, last 24h incidents).
 *
 * SINGLE LANGUAGE PER LOCALE (canon): the hero eyebrow + title +
 * subtitle + poll badge resolve to the active locale via `pickByLocale`,
 * seeded from the server-resolved cookie so SSR and the first client
 * paint agree (no EN/SW split-brain frame). The previous eyebrow
 * hard-rendered "Platform - Uangalifu" (EN+SW together).
 */
export default async function SystemHealthPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <div className="space-y-8">
      <PageHero
        eyebrow={pickByLocale(locale, {
          en: 'Platform health',
          sw: 'Afya ya jukwaa',
        })}
        title={pickByLocale(locale, {
          en: 'System health',
          sw: 'Afya ya mfumo',
        })}
        subtitle={pickByLocale(locale, {
          en: 'Live operational gauges across the Borjie runtime — events / second, LLM latency, daily spend, heartbeat and circuit breakers. Polls every 5 seconds.',
          sw: 'Vipimo hai vya uendeshaji katika mfumo wa Borjie — matukio / sekunde, ucheleweshaji wa LLM, matumizi ya kila siku, mapigo ya moyo na vizuizi vya mzunguko. Hupiga kura kila sekunde 5.',
        })}
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-info/50 bg-info/10 px-2.5 py-1 text-tiny font-mono uppercase tracking-widest text-info">
            {pickByLocale(locale, { en: '5s poll', sw: 'Kura ya 5s' })}
          </span>
        }
      />
      <SystemHealthClient initialLocale={locale} />
    </div>
  );
}
