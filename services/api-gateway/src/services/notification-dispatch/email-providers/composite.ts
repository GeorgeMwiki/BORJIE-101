/**
 * Composite email-provider selector.
 *
 * Reads env once at composition time and returns the first configured
 * adapter. Order:
 *   1. SendGrid (cheaper, simpler keys)
 *   2. AWS SES (better deliverability for high-volume)
 *
 * Returns `null` when neither is configured so the caller can fall
 * back to the stub provider. This keeps the env-aware glue out of
 * `email-provider.ts` and makes wiring testable in isolation.
 *
 * Override the order via `SES_PRIMARY=true` to flip SES before SendGrid.
 */
import type { EmailProvider } from '../email-provider';
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
  readonly sendgrid?: SendGridDeps;
  readonly ses?: SesDeps;
};

export function createConfiguredEmailProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  deps: CompositeEnvDeps = {},
): EmailProvider | null {
  const sendgrid = readSendGridConfigFromEnv(env);
  const ses = readSesConfigFromEnv(env);
  const sesPrimary = env.SES_PRIMARY === 'true';

  if (sesPrimary && ses) {
    return createSesEmailProvider(ses, deps.ses);
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
  if (configs.sendgrid) {
    return createSendGridEmailProvider(configs.sendgrid, deps.sendgrid);
  }
  if (configs.ses) {
    return createSesEmailProvider(configs.ses, deps.ses);
  }
  return null;
}
