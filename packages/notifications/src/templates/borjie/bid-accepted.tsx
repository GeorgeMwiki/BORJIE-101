/**
 * Bid accepted — sent to buyer when their bid is accepted on marketplace.
 */
import { Button, Heading, Section, Text } from '@react-email/components';
import { z } from 'zod';
import {
  BorjieLayout,
  borjieStyles,
  pickLang,
  type BorjieLang,
} from './_layout';

export const BidAcceptedSchema = z.object({
  buyerName: z.string().min(1).max(120),
  listingTitle: z.string().min(1).max(200),
  mineralType: z.string().min(1).max(80),
  quantityKg: z.number().positive(),
  bidAmountTzs: z.number().int().positive(),
  sellerName: z.string().min(1).max(160),
  contractUrl: z.string().url(),
  pickupLocation: z.string().min(1).max(200).optional(),
  lang: z.enum(['sw', 'en']).optional(),
});

export type BidAcceptedData = z.infer<typeof BidAcceptedSchema>;

const fmtTzs = (n: number): string =>
  `TZS ${n.toLocaleString('en-US')}`;
const fmtKg = (n: number): string =>
  `${n.toLocaleString('en-US')} kg`;

const copy: Record<
  BorjieLang,
  {
    preview: string;
    heading: string;
    intro: (listing: string, seller: string) => string;
    detailsLabel: string;
    qtyLabel: string;
    priceLabel: string;
    pickupLabel: string;
    nextSteps: string;
    steps: ReadonlyArray<string>;
    cta: string;
    closing: string;
  }
> = {
  sw: {
    preview: 'Zabuni yako imekubaliwa kwenye Borjie Marketplace.',
    heading: 'Zabuni yako imekubaliwa',
    intro: (l, s) => `Hongera. Zabuni yako kwa "${l}" kutoka kwa ${s} imekubaliwa.`,
    detailsLabel: 'Maelezo ya mauzo',
    qtyLabel: 'Kiasi',
    priceLabel: 'Bei',
    pickupLabel: 'Mahali pa kuchukua',
    nextSteps: 'Hatua zinazofuata',
    steps: [
      'Angalia na saini mkataba kwenye Borjie (link chini).',
      'Lipa kwa M-Pesa au benki — maagizo yapo kwenye mkataba.',
      'Panga usafiri wa kuchukua mzigo na muuzaji.',
      'Pokea cheti cha mauzo baada ya malipo kuthibitishwa.',
    ],
    cta: 'Tazama mkataba',
    closing:
      'Borjie itatuma taarifa ya hali ya malipo na usafirishaji moja kwa moja.',
  },
  en: {
    preview: 'Your bid was accepted on Borjie Marketplace.',
    heading: 'Your bid was accepted',
    intro: (l, s) => `Congratulations. Your bid on "${l}" from ${s} has been accepted.`,
    detailsLabel: 'Trade details',
    qtyLabel: 'Quantity',
    priceLabel: 'Price',
    pickupLabel: 'Pickup location',
    nextSteps: 'Next steps',
    steps: [
      'Review and sign the contract on Borjie (link below).',
      'Pay via M-Pesa or bank — instructions are in the contract.',
      'Arrange collection logistics with the seller.',
      'Receive the sale certificate once payment clears.',
    ],
    cta: 'View contract',
    closing:
      'Borjie will send live updates on payment and shipment status automatically.',
  },
};

export function BidAcceptedEmail(props: BidAcceptedData) {
  const lang = pickLang(props.lang);
  const c = copy[lang];
  return (
    <BorjieLayout preview={c.preview} lang={lang}>
      <Heading style={borjieStyles.h1}>{c.heading}</Heading>
      <Text style={borjieStyles.p}>
        {c.intro(props.listingTitle, props.sellerName)}
      </Text>
      <Section style={borjieStyles.card}>
        <Text style={{ ...borjieStyles.muted, fontWeight: 600, margin: '0 0 8px 0' }}>
          {c.detailsLabel}
        </Text>
        <Text style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}>
          {props.mineralType}
        </Text>
        <Text style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}>
          {c.qtyLabel}: {fmtKg(props.quantityKg)}
        </Text>
        <Text style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}>
          {c.priceLabel}: {fmtTzs(props.bidAmountTzs)}
        </Text>
        {props.pickupLocation && (
          <Text style={{ ...borjieStyles.p, margin: '0' }}>
            {c.pickupLabel}: {props.pickupLocation}
          </Text>
        )}
      </Section>
      <Text style={{ ...borjieStyles.p, fontWeight: 600 }}>{c.nextSteps}</Text>
      <Section>
        {c.steps.map((s, i) => (
          <Text key={s} style={{ ...borjieStyles.p, margin: '0 0 6px 0' }}>
            {i + 1}. {s}
          </Text>
        ))}
      </Section>
      <Section style={{ textAlign: 'center', margin: '24px 0' }}>
        <Button href={props.contractUrl} style={borjieStyles.button}>
          {c.cta}
        </Button>
      </Section>
      <Text style={borjieStyles.muted}>{c.closing}</Text>
    </BorjieLayout>
  );
}

export function bidAcceptedText(data: BidAcceptedData): string {
  const lang = pickLang(data.lang);
  const c = copy[lang];
  const steps = c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    c.heading,
    '',
    c.intro(data.listingTitle, data.sellerName),
    '',
    c.detailsLabel,
    `  ${data.mineralType}`,
    `  ${c.qtyLabel}: ${fmtKg(data.quantityKg)}`,
    `  ${c.priceLabel}: ${fmtTzs(data.bidAmountTzs)}`,
    data.pickupLocation ? `  ${c.pickupLabel}: ${data.pickupLocation}` : '',
    '',
    c.nextSteps,
    steps,
    '',
    `${c.cta}: ${data.contractUrl}`,
    '',
    c.closing,
  ]
    .filter(Boolean)
    .join('\n');
}

export const bidAcceptedSubject = (data: BidAcceptedData): string => {
  const lang = pickLang(data.lang);
  return lang === 'sw'
    ? `Zabuni yako imekubaliwa: ${data.listingTitle}`
    : `Your bid was accepted: ${data.listingTitle}`;
};

export default BidAcceptedEmail;
