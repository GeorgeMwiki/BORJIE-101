/**
 * Borjie email template dispatcher.
 *
 * Maps a stable template name → { render component, text fallback,
 * subject builder, Zod schema }. Callers (sender service, queue
 * workers, dev preview) look up by name so we never import individual
 * templates at the boundary.
 */
import type { ReactElement } from 'react';
import type { z } from 'zod';

import {
  WelcomeEmail,
  WelcomeSchema,
  welcomeSubject,
  welcomeText,
  type WelcomeData,
} from './welcome';
import {
  LicenceExpiryWarningEmail,
  LicenceExpiryWarningSchema,
  licenceExpiryWarningSubject,
  licenceExpiryWarningText,
  type LicenceExpiryWarningData,
} from './licence-expiry-warning';
import {
  BidAcceptedEmail,
  BidAcceptedSchema,
  bidAcceptedSubject,
  bidAcceptedText,
  type BidAcceptedData,
} from './bid-accepted';
import {
  BidRejectedEmail,
  BidRejectedSchema,
  bidRejectedSubject,
  bidRejectedText,
  type BidRejectedData,
} from './bid-rejected';
import {
  WeeklySummaryEmail,
  WeeklySummarySchema,
  weeklySummarySubject,
  weeklySummaryText,
  type WeeklySummaryData,
} from './weekly-summary';
import {
  ShiftReportDelayEmail,
  ShiftReportDelaySchema,
  shiftReportDelaySubject,
  shiftReportDelayText,
  type ShiftReportDelayData,
} from './shift-report-delay';
import {
  PilotApplicationReceivedEmail,
  PilotApplicationReceivedSchema,
  pilotApplicationReceivedSubject,
  pilotApplicationReceivedText,
  type PilotApplicationReceivedData,
} from './pilot-application-received';
import {
  PilotApplicationApprovedEmail,
  PilotApplicationApprovedSchema,
  pilotApplicationApprovedSubject,
  pilotApplicationApprovedText,
  type PilotApplicationApprovedData,
} from './pilot-application-approved';

export type BorjieTemplateName =
  | 'welcome'
  | 'licence-expiry-warning'
  | 'bid-accepted'
  | 'bid-rejected'
  | 'weekly-summary'
  | 'shift-report-delay'
  | 'pilot-application-received'
  | 'pilot-application-approved';

export interface BorjieTemplateEntry<TData> {
  readonly schema: z.ZodType<TData>;
  readonly render: (data: TData) => ReactElement;
  readonly text: (data: TData) => string;
  readonly subject: (data: TData) => string;
}

// Per-template-name → strongly-typed data map. Lets callers do
// `renderBorjieTemplate('welcome', data)` and have `data` checked
// against the welcome schema.
export interface BorjieTemplateDataMap {
  welcome: WelcomeData;
  'licence-expiry-warning': LicenceExpiryWarningData;
  'bid-accepted': BidAcceptedData;
  'bid-rejected': BidRejectedData;
  'weekly-summary': WeeklySummaryData;
  'shift-report-delay': ShiftReportDelayData;
  'pilot-application-received': PilotApplicationReceivedData;
  'pilot-application-approved': PilotApplicationApprovedData;
}

export const borjieTemplates: {
  readonly [K in BorjieTemplateName]: BorjieTemplateEntry<BorjieTemplateDataMap[K]>;
} = {
  welcome: {
    schema: WelcomeSchema,
    render: WelcomeEmail,
    text: welcomeText,
    subject: welcomeSubject,
  },
  'licence-expiry-warning': {
    schema: LicenceExpiryWarningSchema as unknown as z.ZodType<LicenceExpiryWarningData>,
    render: LicenceExpiryWarningEmail,
    text: licenceExpiryWarningText,
    subject: licenceExpiryWarningSubject,
  },
  'bid-accepted': {
    schema: BidAcceptedSchema,
    render: BidAcceptedEmail,
    text: bidAcceptedText,
    subject: bidAcceptedSubject,
  },
  'bid-rejected': {
    schema: BidRejectedSchema,
    render: BidRejectedEmail,
    text: bidRejectedText,
    subject: bidRejectedSubject,
  },
  'weekly-summary': {
    schema: WeeklySummarySchema,
    render: WeeklySummaryEmail,
    text: weeklySummaryText,
    subject: weeklySummarySubject,
  },
  'shift-report-delay': {
    schema: ShiftReportDelaySchema,
    render: ShiftReportDelayEmail,
    text: shiftReportDelayText,
    subject: shiftReportDelaySubject,
  },
  'pilot-application-received': {
    schema: PilotApplicationReceivedSchema as unknown as z.ZodType<PilotApplicationReceivedData>,
    render: PilotApplicationReceivedEmail,
    text: pilotApplicationReceivedText,
    subject: pilotApplicationReceivedSubject,
  },
  'pilot-application-approved': {
    schema: PilotApplicationApprovedSchema as unknown as z.ZodType<PilotApplicationApprovedData>,
    render: PilotApplicationApprovedEmail,
    text: pilotApplicationApprovedText,
    subject: pilotApplicationApprovedSubject,
  },
};

export function getBorjieTemplate<K extends BorjieTemplateName>(
  name: K
): BorjieTemplateEntry<BorjieTemplateDataMap[K]> {
  const entry = borjieTemplates[name];
  if (!entry) {
    throw new Error(`Unknown Borjie email template: ${String(name)}`);
  }
  return entry;
}

export const BORJIE_TEMPLATE_NAMES: ReadonlyArray<BorjieTemplateName> = [
  'welcome',
  'licence-expiry-warning',
  'bid-accepted',
  'bid-rejected',
  'weekly-summary',
  'shift-report-delay',
  'pilot-application-received',
  'pilot-application-approved',
];

export type {
  WelcomeData,
  LicenceExpiryWarningData,
  BidAcceptedData,
  BidRejectedData,
  WeeklySummaryData,
  ShiftReportDelayData,
  PilotApplicationReceivedData,
  PilotApplicationApprovedData,
};
