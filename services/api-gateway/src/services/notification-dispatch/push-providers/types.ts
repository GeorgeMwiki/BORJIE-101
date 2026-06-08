/**
 * Push-provider port types.
 *
 * Mirrors the email / SMS provider seams (`email-provider.ts`,
 * `sms-provider.ts`) exactly so the notification dispatcher sees one
 * stable shape across every channel. The `app_push` message channel
 * (see `packages/database/src/schemas/communications.schema.ts`) fans
 * out through a `PushProvider`.
 *
 * `PushProviderResult` is the SAME discriminated union the email and
 * SMS rails return:
 *   - { status: 'sent', provider, providerRef }
 *   - { status: 'failed', provider, errorCode, errorMessage, retryable }
 *
 * Device push tokens are stored in `device_push_tokens`
 * (migration 0139); the dispatcher resolves a user's active
 * `expo_push_token` rows and hands each one to `send()`.
 */

export type PushProviderInput = {
  readonly tenantId: string;
  /**
   * The recipient device token — an Expo push token of the form
   * `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. Sourced from the
   * `device_push_tokens.expo_push_token` column.
   */
  readonly pushToken: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string | null;
};

export type PushProviderResult =
  | {
      readonly status: 'sent';
      readonly providerRef: string;
      readonly provider: string;
    }
  | {
      readonly status: 'failed';
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly retryable: boolean;
      readonly provider: string;
    };

export type PushProvider = {
  readonly name: string;
  readonly configured: boolean;
  send(input: PushProviderInput): Promise<PushProviderResult>;
};
