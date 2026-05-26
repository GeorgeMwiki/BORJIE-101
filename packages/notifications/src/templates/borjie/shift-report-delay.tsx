/**
 * Shift report delay — sent to owner if no shift report logged
 * for an active site in 36 hours.
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

export const ShiftReportDelaySchema = z.object({
  ownerName: z.string().min(1).max(120),
  siteName: z.string().min(1).max(160),
  siteId: z.string().min(1).max(60),
  lastReportAt: z.string().min(4).max(40),
  hoursSinceLast: z.number().int().min(0).max(720),
  supervisorName: z.string().min(1).max(120).optional(),
  supervisorPhone: z.string().min(4).max(40).optional(),
  cockpitUrl: z.string().url(),
  lang: z.enum(['sw', 'en']).optional(),
});

export type ShiftReportDelayData = z.infer<typeof ShiftReportDelaySchema>;

const copy: Record<
  BorjieLang,
  {
    preview: (site: string, h: number) => string;
    heading: string;
    intro: (site: string, h: number) => string;
    lastLabel: string;
    supervisorLabel: string;
    actionTitle: string;
    actions: ReadonlyArray<string>;
    cta: string;
    closing: string;
  }
> = {
  sw: {
    preview: (s, h) => `Hakuna ripoti ya zamu kutoka ${s} kwa saa ${h}.`,
    heading: 'Ripoti ya zamu haijawasilishwa',
    intro: (s, h) =>
      `Tovuti yako "${s}" haijawasilisha ripoti ya zamu kwa saa ${h}. Hii inaweza kuonyesha tatizo la mawasiliano, mtandao, au shughuli za tovuti.`,
    lastLabel: 'Ripoti ya mwisho',
    supervisorLabel: 'Msimamizi',
    actionTitle: 'Hatua zinazopendekezwa',
    actions: [
      'Mpigie msimamizi wa tovuti kuthibitisha hali.',
      'Angalia kwenye Cockpit kama kuna ripoti zilizoshindwa kuwasilishwa.',
      'Hakikisha simu ya msimamizi ina data au WiFi.',
      'Kama hujapata jibu ndani ya saa 4, tuma timu ya msaada.',
    ],
    cta: 'Tazama hali ya tovuti',
    closing:
      'Borjie inafuatilia hali hii kiotomatiki kila saa 36. Ripoti ikiwasilishwa, taarifa hii itasimama.',
  },
  en: {
    preview: (s, h) => `No shift report from ${s} for ${h} hours.`,
    heading: 'Shift report not submitted',
    intro: (s, h) =>
      `Your site "${s}" has not submitted a shift report for ${h} hours. This may indicate a comms issue, network failure, or a site problem.`,
    lastLabel: 'Last report',
    supervisorLabel: 'Supervisor',
    actionTitle: 'Recommended actions',
    actions: [
      'Call the site supervisor to confirm the situation.',
      'Check the Cockpit for any failed-submission reports.',
      'Confirm the supervisor’s phone has data or WiFi.',
      'If no response within 4 hours, dispatch a support visit.',
    ],
    cta: 'View site status',
    closing:
      'Borjie monitors this every 36 hours automatically. Once a report is filed, these alerts stop.',
  },
};

export function ShiftReportDelayEmail(props: ShiftReportDelayData) {
  const lang = pickLang(props.lang);
  const c = copy[lang];
  return (
    <BorjieLayout preview={c.preview(props.siteName, props.hoursSinceLast)} lang={lang}>
      <Heading style={{ ...borjieStyles.h1, color: borjieColors.gold }}>
        {c.heading}
      </Heading>
      <Text style={borjieStyles.p}>
        {c.intro(props.siteName, props.hoursSinceLast)}
      </Text>
      <Section style={borjieStyles.card}>
        <Text style={{ ...borjieStyles.p, margin: '0 0 4px 0' }}>
          {c.lastLabel}: {props.lastReportAt}
        </Text>
        {props.supervisorName && (
          <Text style={{ ...borjieStyles.p, margin: 0 }}>
            {c.supervisorLabel}: {props.supervisorName}
            {props.supervisorPhone ? ` · ${props.supervisorPhone}` : ''}
          </Text>
        )}
      </Section>
      <Text style={{ ...borjieStyles.p, fontWeight: 600 }}>{c.actionTitle}</Text>
      <Section>
        {c.actions.map((a, i) => (
          <Text key={a} style={{ ...borjieStyles.p, margin: '0 0 6px 0' }}>
            {i + 1}. {a}
          </Text>
        ))}
      </Section>
      <Section style={{ textAlign: 'center', margin: '24px 0' }}>
        <Button href={props.cockpitUrl} style={borjieStyles.button}>
          {c.cta}
        </Button>
      </Section>
      <Text style={borjieStyles.muted}>{c.closing}</Text>
    </BorjieLayout>
  );
}

export function shiftReportDelayText(data: ShiftReportDelayData): string {
  const lang = pickLang(data.lang);
  const c = copy[lang];
  const actions = c.actions.map((a, i) => `${i + 1}. ${a}`).join('\n');
  return [
    c.heading,
    '',
    c.intro(data.siteName, data.hoursSinceLast),
    '',
    `${c.lastLabel}: ${data.lastReportAt}`,
    data.supervisorName
      ? `${c.supervisorLabel}: ${data.supervisorName}${data.supervisorPhone ? ` · ${data.supervisorPhone}` : ''}`
      : '',
    '',
    c.actionTitle,
    actions,
    '',
    `${c.cta}: ${data.cockpitUrl}`,
    '',
    c.closing,
  ]
    .filter(Boolean)
    .join('\n');
}

export const shiftReportDelaySubject = (data: ShiftReportDelayData): string => {
  const lang = pickLang(data.lang);
  return lang === 'sw'
    ? `Ripoti ya zamu haijawasilishwa: ${data.siteName} (saa ${data.hoursSinceLast})`
    : `Shift report missing: ${data.siteName} (${data.hoursSinceLast}h)`;
};

export default ShiftReportDelayEmail;
