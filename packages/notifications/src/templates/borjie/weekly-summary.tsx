/**
 * Weekly summary — owner's Monday brief.
 * Cash runway · top 3 risks · licence calendar · marketplace activity.
 *
 * Copy and helpers live in `weekly-summary.copy.ts` to keep this file
 * under the per-template line ceiling.
 */
import { Button, Heading, Section, Text } from '@react-email/components';
import { z } from 'zod';
import {
  BorjieLayout,
  borjieColors,
  borjieStyles,
  pickLang,
} from './_layout';
import {
  fmtTzs,
  severityColor,
  weeklySummaryCopy,
} from './weekly-summary.copy';

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

function Block(props: {
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
  const c = weeklySummaryCopy[lang];
  return (
    <BorjieLayout preview={c.preview(props.weekStart)} lang={lang}>
      <Heading style={borjieStyles.h1}>{c.heading(props.ownerName)}</Heading>

      <Block title={c.sections.cash}>
        <Text style={borjieStyles.p}>{c.cash.runway(props.cashRunwayDays)}</Text>
        <Text style={borjieStyles.muted}>
          {c.cash.balance}: {fmtTzs(props.cashBalanceTzs)}
        </Text>
      </Block>

      <Block title={c.sections.risks}>
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
      </Block>

      <Block title={c.sections.licences}>
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
      </Block>

      <Block title={c.sections.marketplace}>
        <Text style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}>
          {c.marketplace.listings(props.marketplace.activeListings)}
        </Text>
        <Text style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}>
          {c.marketplace.bids(props.marketplace.pendingBids)}
        </Text>
        <Text style={{ ...borjieStyles.p, margin: '0' }}>
          {c.marketplace.trades(fmtTzs(props.marketplace.completedTradesTzs))}
        </Text>
      </Block>

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
  const c = weeklySummaryCopy[lang];
  const risks =
    data.topRisks.length === 0
      ? c.risks.none
      : data.topRisks
          .map((r, i) => `[${r.severity.toUpperCase()}] ${i + 1}. ${r.title}`)
          .join('\n');
  const licences =
    data.upcomingLicences.length === 0
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
