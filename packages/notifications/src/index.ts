/**
 * @borjie/notifications — public surface.
 *
 * Borjie-domain transactional email templates and Resend sender.
 * Existing Supabase Auth flows handle login/recovery — this package
 * is for everything else (welcome, licence expiry, marketplace,
 * weekly summary, ops alerts, pilot lifecycle).
 */
export {
  borjieTemplates,
  getBorjieTemplate,
  BORJIE_TEMPLATE_NAMES,
  type BorjieTemplateName,
  type BorjieTemplateDataMap,
  type BorjieTemplateEntry,
  type WelcomeData,
  type LicenceExpiryWarningData,
  type BidAcceptedData,
  type BidRejectedData,
  type WeeklySummaryData,
  type ShiftReportDelayData,
  type PilotApplicationReceivedData,
  type PilotApplicationApprovedData,
} from './templates/borjie';

export {
  sendEmail,
  type SendEmailParams,
  type SendEmailResult,
  type BorjieLang,
} from './borjie-sender';
