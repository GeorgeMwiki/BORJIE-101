/**
 * Licence expiry warning — sent at T-90, T-30, T-7 days before expiry.
 * Mining-domain content: PML renewal flow, Tumemadini portal link.
 */
import { Button, Heading, Link, Section, Text } from '@react-email/components';
import { z } from 'zod';
import {
  BorjieLayout,
  borjieColors,
  borjieStyles,
  pickLang,
  type BorjieLang,
} from './_layout';

export const LicenceExpiryWarningSchema = z.object({
  ownerName: z.string().min(1).max(120),
  licenceNumber: z.string().min(1).max(60),
  licenceType: z.enum(['PML', 'PL', 'ML', 'SML', 'GML']),
  expiryDate: z.string().min(4).max(40),
  daysRemaining: z.number().int().min(0).max(120),
  siteName: z.string().min(1).max(160).optional(),
  renewUrl: z.string().url(),
  tumemadiniUrl: z.string().url().default('https://portal.madini.go.tz'),
  lang: z.enum(['sw', 'en']).optional(),
});

export type LicenceExpiryWarningData = z.infer<typeof LicenceExpiryWarningSchema>;

const copy: Record<
  BorjieLang,
  {
    preview: (days: number, type: string) => string;
    heading: (days: number) => string;
    body: (type: string, num: string, exp: string) => string;
    steps: ReadonlyArray<string>;
    cta: string;
    portalLink: string;
    closing: string;
  }
> = {
  sw: {
    preview: (d, t) => `Leseni yako ya ${t} inaisha baada ya siku ${d}.`,
    heading: (d) =>
      d === 0
        ? 'Leseni yako imeisha leo'
        : `Leseni yako inaisha baada ya siku ${d}`,
    body: (type, num, exp) =>
      `Leseni yako ya ${type} (namba: ${num}) inaisha tarehe ${exp}. Anza mchakato wa upya sasa ili kuepuka usumbufu wa shughuli za migodi yako.`,
    steps: [
      'Hakikisha umelipa kodi zote za TRA zinazohusiana na leseni.',
      'Andaa ripoti ya mwaka ya uzalishaji (production report).',
      'Wasilisha fomu ya upya kupitia Tumemadini portal (au tutakusaidia).',
      'Hifadhi risiti na cheti kipya kwa rekodi za mgodi.',
    ],
    cta: 'Anza mchakato wa upya',
    portalLink: 'Tumemadini portal',
    closing:
      'Borjie inafuatilia tarehe hii kiotomatiki — tutakukumbusha tena siku 30 na 7 kabla.',
  },
  en: {
    preview: (d, t) => `Your ${t} licence expires in ${d} days.`,
    heading: (d) =>
      d === 0 ? 'Your licence expires today' : `Your licence expires in ${d} days`,
    body: (type, num, exp) =>
      `Your ${type} licence (number: ${num}) expires on ${exp}. Start the renewal process now to avoid interruption to your mining operations.`,
    steps: [
      'Confirm all TRA tax payments tied to the licence are settled.',
      'Prepare the annual production report.',
      'Submit the renewal form via the Tumemadini portal (we can help).',
      'Keep the receipt and new certificate on file for your mine records.',
    ],
    cta: 'Start renewal',
    portalLink: 'Tumemadini portal',
    closing:
      'Borjie tracks this date automatically — we will remind you again at 30 and 7 days.',
  },
};

export function LicenceExpiryWarningEmail(props: LicenceExpiryWarningData) {
  const lang = pickLang(props.lang);
  const c = copy[lang];
  return (
    <BorjieLayout
      preview={c.preview(props.daysRemaining, props.licenceType)}
      lang={lang}
    >
      <Heading style={{ ...borjieStyles.h1, color: borjieColors.gold }}>
        {c.heading(props.daysRemaining)}
      </Heading>
      <Text style={borjieStyles.p}>
        {c.body(props.licenceType, props.licenceNumber, props.expiryDate)}
      </Text>
      {props.siteName && (
        <Text style={borjieStyles.muted}>
          {lang === 'sw' ? 'Tovuti:' : 'Site:'} {props.siteName}
        </Text>
      )}
      <Section style={borjieStyles.card}>
        {c.steps.map((s, i) => (
          <Text key={s} style={{ ...borjieStyles.p, margin: '0 0 8px 0' }}>
            {i + 1}. {s}
          </Text>
        ))}
      </Section>
      <Section style={{ textAlign: 'center', margin: '24px 0' }}>
        <Button href={props.renewUrl} style={borjieStyles.button}>
          {c.cta}
        </Button>
      </Section>
      <Text style={borjieStyles.muted}>
        <Link href={props.tumemadiniUrl} style={{ color: borjieColors.gold }}>
          {c.portalLink}
        </Link>
        {' · '}
        {c.closing}
      </Text>
    </BorjieLayout>
  );
}

export function licenceExpiryWarningText(data: LicenceExpiryWarningData): string {
  const lang = pickLang(data.lang);
  const c = copy[lang];
  const steps = c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    c.heading(data.daysRemaining),
    '',
    c.body(data.licenceType, data.licenceNumber, data.expiryDate),
    data.siteName ? `${lang === 'sw' ? 'Tovuti' : 'Site'}: ${data.siteName}` : '',
    '',
    steps,
    '',
    `${c.cta}: ${data.renewUrl}`,
    `${c.portalLink}: ${data.tumemadiniUrl}`,
    '',
    c.closing,
  ]
    .filter(Boolean)
    .join('\n');
}

export const licenceExpiryWarningSubject = (
  data: LicenceExpiryWarningData
): string => {
  const lang = pickLang(data.lang);
  return lang === 'sw'
    ? `Leseni ${data.licenceType} #${data.licenceNumber} inaisha baada ya siku ${data.daysRemaining}`
    : `Licence ${data.licenceType} #${data.licenceNumber} expires in ${data.daysRemaining} days`;
};

export default LicenceExpiryWarningEmail;
