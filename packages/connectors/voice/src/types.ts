/**
 * Twilio Voice connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.9.
 *
 * Critical: this connector operates under a DEDICATED Twilio sub-account
 * (TWILIO_VOICE_SUBACCOUNT_SID) so per-second voice TPS, billing, and
 * incident scope are partitioned from the SMS notifier in
 * services/wave-resilience-manager. The root credentials are shared
 * (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) but every call here is
 * scoped to the sub-account.
 */

export type CallDirection = 'inbound' | 'outbound-api' | 'outbound-dial' | 'outbound';

export interface VoiceCallPayload {
  readonly callSid: string;
  readonly direction: CallDirection;
  readonly fromPhoneHashed: string;
  readonly toPhoneHashed: string;
  readonly durationS: number | null;
  readonly status: string;
  readonly recordingUri: string | null;
  readonly transcriptText: string | null;
  readonly startedAt: string;
}

export interface TwilioInstall {
  readonly tenantId: string;
  /** The sub-account SID (TWILIO_VOICE_SUBACCOUNT_SID). */
  readonly account: string;
  /** Auth token for the sub-account. */
  readonly authToken: string;
}

export interface SaltProvider {
  readonly forTenant: (tenantId: string) => Promise<string>;
}

export interface FetcherPort {
  readonly fetch: (
    url: string,
    init: {
      readonly method: 'GET' | 'POST';
      readonly headers: Readonly<Record<string, string>>;
      readonly body?: string;
    },
  ) => Promise<{
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly text: () => Promise<string>;
  }>;
}
