/**
 * Static bilingual copy for the weekly summary email. Pulled out of
 * `weekly-summary.tsx` to keep the template render file under the
 * 200-line ceiling.
 */
import type { BorjieLang } from './_layout';

export interface WeeklySummaryCopy {
  readonly preview: (week: string) => string;
  readonly heading: (name: string) => string;
  readonly sections: {
    readonly cash: string;
    readonly risks: string;
    readonly licences: string;
    readonly marketplace: string;
  };
  readonly cash: {
    readonly runway: (days: number) => string;
    readonly balance: string;
  };
  readonly licences: {
    readonly none: string;
    readonly item: (num: string, on: string, away: number) => string;
  };
  readonly risks: { readonly none: string };
  readonly marketplace: {
    readonly listings: (n: number) => string;
    readonly bids: (n: number) => string;
    readonly trades: (a: string) => string;
  };
  readonly cta: string;
}

export const weeklySummaryCopy: Record<BorjieLang, WeeklySummaryCopy> = {
  sw: {
    preview: (w) => `Muhtasari wako wa wiki — wiki ya ${w}.`,
    heading: (n) => `Habari ${n}, hapa kuna muhtasari wako wa wiki`,
    sections: {
      cash: 'Hali ya fedha',
      risks: 'Hatari kuu 3',
      licences: 'Kalenda ya leseni',
      marketplace: 'Soko la madini',
    },
    cash: {
      runway: (d) =>
        d > 90
          ? `Una siku ${d} za uendeshaji (cash runway). Hali ni nzuri.`
          : d > 30
            ? `Una siku ${d} za uendeshaji. Tafadhali angalia kwa makini.`
            : `Una siku ${d} tu za uendeshaji. Hatua ya haraka inahitajika.`,
      balance: 'Salio la sasa',
    },
    licences: {
      none: 'Hakuna leseni inayoisha katika siku 90 zijazo.',
      item: (n, o, a) => `Leseni #${n} — inaisha ${o} (siku ${a})`,
    },
    risks: {
      none: 'Hakuna hatari kubwa zilizogunduliwa wiki hii. Endelea hivyo.',
    },
    marketplace: {
      listings: (n) => `Matangazo hai: ${n}`,
      bids: (n) => `Zabuni zinazosubiri: ${n}`,
      trades: (a) => `Mauzo yaliyokamilika wiki hii: ${a}`,
    },
    cta: 'Fungua Cockpit',
  },
  en: {
    preview: (w) => `Your weekly summary — week of ${w}.`,
    heading: (n) => `Hi ${n}, here is your weekly summary`,
    sections: {
      cash: 'Cash position',
      risks: 'Top 3 risks',
      licences: 'Licence calendar',
      marketplace: 'Marketplace activity',
    },
    cash: {
      runway: (d) =>
        d > 90
          ? `You have ${d} days of cash runway. Healthy.`
          : d > 30
            ? `You have ${d} days of runway. Watch closely.`
            : `Only ${d} days of runway. Urgent action needed.`,
      balance: 'Current balance',
    },
    licences: {
      none: 'No licences expiring in the next 90 days.',
      item: (n, o, a) => `Licence #${n} — expires ${o} (${a} days away)`,
    },
    risks: {
      none: 'No major risks flagged this week. Steady.',
    },
    marketplace: {
      listings: (n) => `Active listings: ${n}`,
      bids: (n) => `Pending bids: ${n}`,
      trades: (a) => `Trades completed this week: ${a}`,
    },
    cta: 'Open Cockpit',
  },
};

export const severityColor: Record<string, string> = {
  low: '#6B5D4A',
  medium: '#B07A1A',
  high: '#A04020',
  critical: '#7A1A1A',
};

export const fmtTzs = (n: number): string => `TZS ${n.toLocaleString('en-US')}`;
