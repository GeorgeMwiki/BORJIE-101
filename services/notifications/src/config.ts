/**
 * Provider configuration registration
 * Call with tenant ProviderConfig to enable channels
 */

import type { ProviderConfig } from './types/index.js';
import { SendGridProvider } from './providers/email/sendgrid.js';
import { SesProvider } from './providers/email/ses.js';
import { SmtpProvider } from './providers/email/smtp.js';
import { AfricasTalkingSmsProvider } from './providers/sms/africas-talking.js';
import { TwilioSmsProvider } from './providers/sms/twilio.js';
import { FirebasePushProvider } from './providers/push/firebase.js';
import { TwilioWhatsAppProvider } from './providers/whatsapp/twilio.js';

export function registerProviderConfig(config: ProviderConfig): void {
  if (config.sms) {
    const sms = config.sms as Record<string, unknown>;
    const apiKey = sms['apiKey'] as string | undefined;
    const username = sms['username'] as string | undefined;
    const accountSid = sms['accountSid'] as string | undefined;
    const authToken = sms['authToken'] as string | undefined;
    const fromNumber = sms['fromNumber'] as string | undefined;
    const provider = (sms['provider'] as string) ?? 'africastalking';

    if (provider === 'africastalking' && apiKey && username) {
      AfricasTalkingSmsProvider.registerConfig(config.tenantId, { apiKey, username });
    } else if (provider === 'twilio' && accountSid && authToken && fromNumber) {
      TwilioSmsProvider.registerConfig(config.tenantId, {
        accountSid,
        authToken,
        fromNumber,
      });
    } else if (apiKey && username) {
      AfricasTalkingSmsProvider.registerConfig(config.tenantId, { apiKey, username });
    }
  }
  if (config.email) {
    const email = config.email as Record<string, unknown>;
    const provider = (email['provider'] as string) ?? 'sendgrid';
    const fromEmail = email['fromEmail'] as string | undefined;
    const fromName = email['fromName'] as string | undefined;

    if (provider === 'sendgrid' && email['sendgridApiKey']) {
      SendGridProvider.registerConfig(config.tenantId, {
        apiKey: email['sendgridApiKey'] as string,
        fromEmail,
        fromName,
      });
    } else if (provider === 'ses' && email['sesRegion']) {
      SesProvider.registerConfig(config.tenantId, {
        region: email['sesRegion'] as string,
        accessKeyId: email['sesAccessKeyId'] as string | undefined,
        secretAccessKey: email['sesSecretAccessKey'] as string | undefined,
        fromEmail,
        fromName,
      });
    } else if (provider === 'smtp' && email['smtpHost']) {
      SmtpProvider.registerConfig(config.tenantId, {
        host: email['smtpHost'] as string,
        port: email['smtpPort'] as number | undefined,
        user: email['smtpUser'] as string | undefined,
        pass: email['smtpPass'] as string | undefined,
        fromEmail,
        fromName,
      });
    }
  }
  if (config.push) {
    FirebasePushProvider.registerConfig(config.tenantId, {
      projectId: config.push.projectId,
      clientEmail: config.push.clientEmail,
      privateKey: config.push.privateKey,
    });
  }
  if (config.whatsapp) {
    TwilioWhatsAppProvider.registerConfig(config.tenantId, {
      accountSid: config.whatsapp.accountSid,
      authToken: config.whatsapp.authToken,
      whatsappNumber: config.whatsapp.whatsappNumber,
    });
  }
}
