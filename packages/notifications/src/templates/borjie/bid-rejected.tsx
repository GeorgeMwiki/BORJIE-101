/**
 * Bid rejected — sent when a buyer's bid is rejected.
 * Includes counter-offer if seller submitted one.
 */
import { Button, Heading, Section, Text } from '@react-email/components';
import { z } from 'zod';
import {
  BorjieLayout,
  borjieStyles,
  pickLang,
  type BorjieLang,
} from './_layout';

export const BidRejectedSchema = z.object({
  buyerName: z.string().min(1).max(120),
  listingTitle: z.string().min(1).max(200),
  mineralType: z.string().min(1).max(80),
  bidAmountTzs: z.number().int().positive(),
  rejectionReason: z.string().max(400).optional(),
  counterOffer: z
    .object({
      amountTzs: z.number().int().positive(),
      expiresAt: z.string().min(4).max(40),
    })
    .optional(),
  marketplaceUrl: z.string().url(),
  lang: z.enum(['sw', 'en']).optional(),
});

export type BidRejectedData = z.infer<typeof BidRejectedSchema>;

const fmtTzs = (n: number): string => `TZS ${n.toLocaleString('en-US')}`;

const copy: Record<
  BorjieLang,
  {
    preview: string;
    heading: string;
    intro: (listing: string, bid: string) => string;
    reasonLabel: string;
    counterHeading: string;
    counterBody: (amount: string, expires: string) => string;
    counterCta: string;
    noCounterMsg: string;
    browseCta: string;
    closing: string;
  }
> = {
  sw: {
    preview: 'Zabuni yako haikukubaliwa wakati huu.',
    heading: 'Zabuni yako haikukubaliwa',
    intro: (l, b) =>
      `Zabuni yako ya ${b} kwa "${l}" haikukubaliwa wakati huu. Hii inatokea mara nyingi — bei ya soko inabadilika kila siku.`,
    reasonLabel: 'Sababu ya muuzaji',
    counterHeading: 'Muuzaji amependekeza bei mpya',
    counterBody: (a, e) =>
      `Pendekezo jipya: ${a}. Linafaa hadi ${e}. Unaweza kukubali au kuondoa.`,
    counterCta: 'Tazama pendekezo',
    noCounterMsg:
      'Hakuna pendekezo la bei mpya kutoka kwa muuzaji. Unaweza kutuma zabuni nyingine au kuangalia matangazo mengine.',
    browseCta: 'Angalia matangazo mengine',
    closing:
      'Borjie itakutumia taarifa mara kunapokuwa na madini mapya yanayolingana na unayoangalia.',
  },
  en: {
    preview: 'Your bid was not accepted this time.',
    heading: 'Your bid was not accepted',
    intro: (l, b) =>
      `Your ${b} bid on "${l}" was not accepted this time. This is common — market prices shift daily.`,
    reasonLabel: 'Seller note',
    counterHeading: 'The seller proposed a counter-offer',
    counterBody: (a, e) =>
      `New offer: ${a}. Valid until ${e}. You can accept or pass.`,
    counterCta: 'View counter-offer',
    noCounterMsg:
      'No counter-offer was provided. You can submit a new bid or browse other active listings.',
    browseCta: 'Browse other listings',
    closing:
      'Borjie will alert you the moment new listings match what you are looking for.',
  },
};

export function BidRejectedEmail(props: BidRejectedData) {
  const lang = pickLang(props.lang);
  const c = copy[lang];
  const hasCounter = props.counterOffer !== undefined;
  return (
    <BorjieLayout preview={c.preview} lang={lang}>
      <Heading style={borjieStyles.h1}>{c.heading}</Heading>
      <Text style={borjieStyles.p}>
        {c.intro(props.listingTitle, fmtTzs(props.bidAmountTzs))}
      </Text>
      {props.rejectionReason && (
        <Section style={borjieStyles.card}>
          <Text style={{ ...borjieStyles.muted, fontWeight: 600, margin: '0 0 6px 0' }}>
            {c.reasonLabel}
          </Text>
          <Text style={{ ...borjieStyles.p, margin: 0 }}>{props.rejectionReason}</Text>
        </Section>
      )}
      {hasCounter && props.counterOffer && (
        <Section style={borjieStyles.card}>
          <Text style={{ ...borjieStyles.p, fontWeight: 600, margin: '0 0 8px 0' }}>
            {c.counterHeading}
          </Text>
          <Text style={{ ...borjieStyles.p, margin: '0 0 12px 0' }}>
            {c.counterBody(
              fmtTzs(props.counterOffer.amountTzs),
              props.counterOffer.expiresAt
            )}
          </Text>
          <Button href={props.marketplaceUrl} style={borjieStyles.button}>
            {c.counterCta}
          </Button>
        </Section>
      )}
      {!hasCounter && (
        <>
          <Text style={borjieStyles.p}>{c.noCounterMsg}</Text>
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button href={props.marketplaceUrl} style={borjieStyles.button}>
              {c.browseCta}
            </Button>
          </Section>
        </>
      )}
      <Text style={borjieStyles.muted}>{c.closing}</Text>
    </BorjieLayout>
  );
}

export function bidRejectedText(data: BidRejectedData): string {
  const lang = pickLang(data.lang);
  const c = copy[lang];
  const reason = data.rejectionReason
    ? `\n${c.reasonLabel}: ${data.rejectionReason}\n`
    : '';
  const counter = data.counterOffer
    ? `\n${c.counterHeading}\n${c.counterBody(fmtTzs(data.counterOffer.amountTzs), data.counterOffer.expiresAt)}\n${c.counterCta}: ${data.marketplaceUrl}\n`
    : `\n${c.noCounterMsg}\n${c.browseCta}: ${data.marketplaceUrl}\n`;
  return [
    c.heading,
    '',
    c.intro(data.listingTitle, fmtTzs(data.bidAmountTzs)),
    reason,
    counter,
    '',
    c.closing,
  ].join('\n');
}

export const bidRejectedSubject = (data: BidRejectedData): string => {
  const lang = pickLang(data.lang);
  if (data.counterOffer) {
    return lang === 'sw'
      ? `Pendekezo jipya kwa "${data.listingTitle}"`
      : `Counter-offer on "${data.listingTitle}"`;
  }
  return lang === 'sw'
    ? `Zabuni yako kwa "${data.listingTitle}" haikukubaliwa`
    : `Your bid on "${data.listingTitle}" was not accepted`;
};

export default BidRejectedEmail;
