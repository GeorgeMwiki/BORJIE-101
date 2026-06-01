/**
 * Composite email-provider selector.
 *
 * Reads env once at composition time and returns the first configured
 * adapter. Order:
 *   1. Resend   (the configured prod rail; matches the K8s secrets)
 *   2. SendGrid (cheaper, simpler keys)
 *   3. AWS SES  (better deliverability for high-volume)
 *
 * Returns `null` when none is configured so the caller can fall back
 * to the stub provider. This keeps the env-aware glue out of
 * `email-provider.ts` and makes wiring testable in isolation.
 *
 * Override the order via `SES_PRIMARY=true` to flip SES to the front.
 */
import type { EmailProvider } from '../email-provider';
import {
  createResendEmailProvider,
  readResendConfigFromEnv,
  type ResendConfig,
  type ResendDeps,
} from './resend';
import {
  createSendGridEmailProvider,
  readSendGridConfigFromEnv,
  type SendGridConfig,
  type SendGridDeps,
} from './sendgrid';
import {
  createSesEmailProvider,
  readSesConfigFromEnv,
  type SesConfig,
  type SesDeps,
} from './ses';

export type CompositeEnvDeps = {
  readonly resend?: ResendDeps;
  readonly sendgrid?: SendGridDeps;
  readonly ses?: SesDeps;
};

export function createConfiguredEmailProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  deps: CompositeEnvDeps = {},
): EmailProvider | null {
  const resend = readResendConfigFromEnv(env);
  const sendgrid = readSendGridConfigFromEnv(env);
  const ses = readSesConfigFromEnv(env);
  const sesPrimary = env.SES_PRIMARY === 'true';

  if (sesPrimary && ses) {
    return createSesEmailProvider(ses, deps.ses);
  }
  if (resend) {
    return createResendEmailProvider(resend, deps.resend);
  }
  if (sendgrid) {
    return createSendGridEmailProvider(sendgrid, deps.sendgrid);
  }
  if (ses) {
    return createSesEmailProvider(ses, deps.ses);
  }
  return null;
}

export type CompositeConfigs = {
  readonly resend?: ResendConfig;
  readonly sendgrid?: SendGridConfig;
  readonly ses?: SesConfig;
  readonly preferSes?: boolean;
};

/**
 * Pure function variant for when configs come from somewhere other
 * than `process.env` (e.g. a tenant-aware secret manager).
 */
export function createConfiguredEmailProvider(
  configs: CompositeConfigs,
  deps: CompositeEnvDeps = {},
): EmailProvider | null {
  if (configs.preferSes && configs.ses) {
    return createSesEmailProvider(configs.ses, deps.ses);
  }
  if (configs.resend) {
    return createResendEmailProvider(configs.resend, deps.resend);
  }
  if (configs.sendgrid) {
    return createSendGridEmailProvider(configs.sendgrid, deps.sendgrid);
  }
  if (configs.ses) {
    return createSesEmailProvider(configs.ses, deps.ses);
  }
  return null;
}
