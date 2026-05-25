/**
 * Composite SMS provider — picks the right rail per channel.
 *
 * Routing rules (deterministic):
 *   - channel === 'whatsapp' -> Twilio (only rail that supports it).
 *     If Twilio not configured, returns failed/`channel_unsupported`.
 *   - channel === 'sms'      -> first configured between Twilio and
 *     Africa's Talking (priority order specified in factory args).
 *
 * Returns `null` from `createCompositeSmsProviderFromEnv` if NO real
 * provider is configured, so the caller can fall back to the stub.
 *
 * The composite is itself an `SmsProvider`, so the dispatcher does
 * not need to know about routing.
 */
import type {
  SmsProvider,
  SmsProviderInput,
  SmsProviderResult,
} from '../sms-provider';
import {
  createTwilioSmsProvider,
  readTwilioConfigFromEnv,
} from './twilio';
import {
  createAfricasTalkingSmsProvider,
  readAfricasTalkingConfigFromEnv,
} from './africastalking';

export type CompositeSmsProviderDeps = {
  readonly twilio: SmsProvider | null;
  readonly africasTalking: SmsProvider | null;
  /**
   * Priority order for SMS routing when both are configured.
   * Default: 'africastalking' first (cheaper for KE/UG/TZ), Twilio fallback.
   */
  readonly smsPriority?: ReadonlyArray<'twilio' | 'africastalking'>;
};

export function createCompositeSmsProvider(
  deps: CompositeSmsProviderDeps
): SmsProvider {
  const priority = deps.smsPriority ?? ['africastalking', 'twilio'];
  const name = composeName(deps);

  return {
    name,
    configured:
      (deps.twilio?.configured ?? false) ||
      (deps.africasTalking?.configured ?? false),
    async send(input: SmsProviderInput): Promise<SmsProviderResult> {
      if (input.channel === 'whatsapp') {
        if (deps.twilio && deps.twilio.configured) {
          return deps.twilio.send(input);
        }
        return {
          status: 'failed',
          errorCode: 'channel_unsupported',
          errorMessage:
            'WhatsApp requires Twilio; no Twilio provider configured.',
          retryable: false,
          provider: name,
        };
      }

      // channel === 'sms'
      for (const candidate of priority) {
        if (candidate === 'twilio' && deps.twilio?.configured) {
          return deps.twilio.send(input);
        }
        if (
          candidate === 'africastalking' &&
          deps.africasTalking?.configured
        ) {
          return deps.africasTalking.send(input);
        }
      }

      return {
        status: 'failed',
        errorCode: 'provider_not_configured',
        errorMessage: 'No SMS provider configured.',
        retryable: true,
        provider: name,
      };
    },
  };
}

function composeName(deps: CompositeSmsProviderDeps): string {
  const parts: string[] = [];
  if (deps.africasTalking?.configured) parts.push('africastalking');
  if (deps.twilio?.configured) parts.push('twilio');
  if (parts.length === 0) return 'composite-sms-empty';
  return `composite-sms[${parts.join('+')}]`;
}

/**
 * Build a composite from environment variables. Returns `null` if
 * neither Twilio nor Africa's Talking is configured — caller should
 * fall back to the stub provider in that case.
 */
export function createCompositeSmsProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): SmsProvider | null {
  const twilioConfig = readTwilioConfigFromEnv(env);
  const atConfig = readAfricasTalkingConfigFromEnv(env);

  if (!twilioConfig && !atConfig) return null;

  const twilio = twilioConfig ? createTwilioSmsProvider(twilioConfig) : null;
  const africasTalking = atConfig
    ? createAfricasTalkingSmsProvider(atConfig)
    : null;

  return createCompositeSmsProvider({ twilio, africasTalking });
}
