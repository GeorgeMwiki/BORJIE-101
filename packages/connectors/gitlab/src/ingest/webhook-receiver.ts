/**
 * GitLab webhook verification — `X-Gitlab-Token` SHARED-SECRET match.
 *
 * Reference: GitLab, *Webhooks* —
 * https://docs.gitlab.com/ee/user/project/integrations/webhooks.html
 *
 * GitLab does NOT use HMAC — it sends the configured per-webhook
 * secret token verbatim in `X-Gitlab-Token`. The receiver MUST do a
 * **timing-safe** string compare to avoid leaking the secret length.
 */

import { timingSafeEqual } from 'node:crypto';

export interface WebhookVerifyParams {
  readonly tokenHeader: string;
  readonly secret: string;
}

export type WebhookVerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'mismatch' };

export function verifyGitLabWebhook(params: WebhookVerifyParams): WebhookVerifyOutcome {
  const a = Buffer.from(params.secret);
  const b = Buffer.from(params.tokenHeader);
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
