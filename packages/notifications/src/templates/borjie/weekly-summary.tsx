/**
 * Weekly summary — owner's Monday brief.
 * Cash runway · top 3 risks · licence calendar · marketplace activity.
 */
import { Button, Heading, Section, Text } from '@react-email/components';
import { z } from 'zod';
import {
  BorjieLayout,
  borjieColors,
  borjieStyles,
  pickLang,
  type BorjieLang,
} from './_layout';

export const WeeklySummarySchema = z.object({
  ownerName: z.string().min(1).max(120),
  weekStart: z.string().min(4).max(40),
  cashRunwayDays: z.number().int().min(0).max(3650),
  cashBalanceTzs: z.number().int(),
  topRisks: z
    .array(
      z.object({
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        title: z.string().min(1).max(160),
      })
    )
    .max(3),
  upcomingLicences: z
    .array(
      z.object({
        licenceNumber: z.string().min(1).max(60),
        expiresOn: z.string().min(4).max(40),
        daysAway: z.number().int().min(0).max(365),
      })
    )
    .max(5),
  marketplace: z.object({
    activeListings: z.number().int().min(0),
    pendingBids: z.number().int().min(0),
    completedTradesTzs: z.number().int().min(0),
  }),
  cockpitUrl: z.string().url(),
  lang: z.enum(['sw', 'en']).optional(),
});

export type WeeklySummaryData = z.infer<typeof WeeklySummarySchema>;

const fmtTzs = (n: number): string =>
  `TZS ${n.toLocaleString('en-US')}`;

const severityColor: Record<string, string> = {
  low: '#6B5D4A',
  medium: '#B07A1A',
  high: '#A04020',
  critical: '#7A1A1A',
};

const copy: Record<
  BorjieLang,
  {
    preview: (week: string) => string;
    heading: (name: string) => string;
    sections: {
      cash: string;
      risks: string;
      licences: string;
      marketplace: string;
    };
    cash: {
      runway: (days: number) => string;
      balance: string;
    };
    licences: {
      none: string;
      item: (num: string, on: string, away: number) => string;
    };
    risks: {
      none: string;
    };
    marketplace: {
      listings: (n: number) => string;
      bids: (n: number) => string;
      trades: (a: string) => string;
    };
    cta: string;
  }
> = {
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

function Section_(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Section style={{ margin: '0 0 20px 0' }}>
      <Text
        style={{
          ...borjieStyles.muted,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          margin: '0 0 8px 0',
        }}
      >
        {props.title}
      </Text>
      {props.children}
    </Section>
  );
}

export function WeeklySummaryEmail(props: WeeklySummaryData) {
  const lang = pickLang(props.lang);
  const c = copy[lang];
  return (
    <BorjieLayout preview={c.preview(props.weekStart)} lang={lang}>
      <Heading style={borjieStyles.h1}>{c.heading(props.ownerName)}</Heading>

      <Section_ title={c.sections.cash}>
        <Text style={borjieStyles.p}>{c.cash.runway(props.cashRunwayDays)}</Text>
        <Text style={borjieStyles.muted}>
          {c.cash.balance}: {fmtTzs(props.cashBalanceTzs)}
        </Text>
      </Section_>

      <Section_ title={c.sections.risks}>
        {props.topRisks.length === 0 ? (
          <Text style={borjieStyles.p}>{c.risks.none}</Text>
        ) : (
          props.topRisks.map((r, i) => (
            <Text key={r.title} style={{ ...borjieStyles.p, margin: '0 0 6px 0' }}>
              <span
                style={{
                  color: severityColor[r.severity] ?? borjieColors.muted,
                  fontWeight: 700,
                }}
              >
                [{r.severity.toUpperCase()}]
              </span>{' '}
              {i + 1}. {r.title}
            </Text>
          ))
        )}
      </Section_>

      <Section_ title={c.sections.licences}>
        {props.upcomingLicences.length === 0 ? (
          <Text style={borjieStyles.p}>{c.licences.none}</Text>
        ) : (
          props.upcomingLicences.map((l) => (
            <Text
              key={l.licenceNumber}
              style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}
            >
              {c.licences.item(l.licenceNumber, l.expiresOn, l.daysAway)}
            </Text>
          ))
        )}
      </Section_>

      <Section_ title={c.sections.marketplace}>
        <Text style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}>
          {c.marketplace.listings(props.marketplace.activeListings)}
        </Text>
        <Text style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}>
          {c.marketplace.bids(props.marketplace.pendingBids)}
        </Text>
        <Text style={{ ...borjieStyles.p, margin: '0' }}>
          {c.marketplace.trades(fmtTzs(props.marketplace.completedTradesTzs))}
        </Text>
      </Section_>

      <Section style={{ textAlign: 'center', margin: '20px 0 0 0' }}>
        <Button href={props.cockpitUrl} style={borjieStyles.button}>
          {c.cta}
        </Button>
      </Section>
    </BorjieLayout>
  );
}

export function weeklySummaryText(data: WeeklySummaryData): string {
  const lang = pickLang(data.lang);
  const c = copy[lang];
  const risks = data.topRisks.length === 0
    ? c.risks.none
    : data.topRisks
        .map((r, i) => `[${r.severity.toUpperCase()}] ${i + 1}. ${r.title}`)
        .join('\n');
  const licences = data.upcomingLicences.length === 0
    ? c.licences.none
    : data.upcomingLicences
        .map((l) => c.licences.item(l.licenceNumber, l.expiresOn, l.daysAway))
        .join('\n');
  return [
    c.heading(data.ownerName),
    '',
    c.sections.cash,
    c.cash.runway(data.cashRunwayDays),
    `${c.cash.balance}: ${fmtTzs(data.cashBalanceTzs)}`,
    '',
    c.sections.risks,
    risks,
    '',
    c.sections.licences,
    licences,
    '',
    c.sections.marketplace,
    c.marketplace.listings(data.marketplace.activeListings),
    c.marketplace.bids(data.marketplace.pendingBids),
    c.marketplace.trades(fmtTzs(data.marketplace.completedTradesTzs)),
    '',
    `${c.cta}: ${data.cockpitUrl}`,
  ].join('\n');
}

export const weeklySummarySubject = (data: WeeklySummaryData): string => {
  const lang = pickLang(data.lang);
  return lang === 'sw'
    ? `Muhtasari wa wiki · ${data.weekStart}`
    : `Weekly summary · ${data.weekStart}`;
};

export default WeeklySummaryEmail;
