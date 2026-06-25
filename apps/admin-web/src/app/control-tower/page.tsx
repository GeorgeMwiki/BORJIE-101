import { PageHero } from '@/components/admin-shell/PageHero';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { ControlTowerClient } from './ControlTowerClient';

/**
 * Control Tower — cross-tenant ops console.
 *
 * KPI grid at top (active tenants, brain turns/min, error budget,
 * RLS denies) then the dense platform-controls list. Every control
 * toggle opens a four-eye confirmation modal because flipping these
 * affects every tenant simultaneously.
 *
 * SINGLE LANGUAGE PER LOCALE (canon): the hero eyebrow/title/subtitle/
 * action resolve to the active locale via `pickByLocale`. The previous
 * eyebrow hard-rendered "Operations - Mnara" (EN+SW in one string).
 */
export default async function ControlTowerPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <div className="space-y-8">
      <PageHero
        eyebrow={pickByLocale(locale, {
          en: 'Operations',
          sw: 'Uendeshaji',
        })}
        title={pickByLocale(locale, {
          en: 'Control Tower',
          sw: 'Mnara wa Udhibiti',
        })}
        subtitle={pickByLocale(locale, {
          en: 'Cross-tenant operations console. Kill-switches, autonomy flags, rate-limit knobs and platform KPIs. Every action requires a four-eye attestation and lands on the hash-chained audit trail.',
          sw: 'Konsoli ya uendeshaji ya mashirika yote. Swichi za kuzima, bendera za uhuru, vidhibiti vya kikomo cha kasi na vipimo vya jukwaa. Kila kitendo kinahitaji uthibitisho wa macho-manne na kinaingia kwenye njia ya ukaguzi iliyofungamanishwa kwa hashi.',
        })}
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-tiny font-mono uppercase tracking-widest text-warning">
            {pickByLocale(locale, {
              en: 'Blast radius global',
              sw: 'Athari ni ya jukwaa zima',
            })}
          </span>
        }
      />
      <ControlTowerClient initialLocale={locale} />
    </div>
  );
}
