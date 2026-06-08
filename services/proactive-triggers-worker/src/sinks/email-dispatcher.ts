/**
 * Email channel dispatcher — the one real, wired notification channel.
 *
 * Implements `@borjie/user-followup`'s `ChannelDispatcher` contract for
 * `channel: 'email'` and delivers through the real Resend transport in
 * `@borjie/notifications` (`sendEmail`). A `FollowupCandidate` carries no
 * contact info, so the recipient address, locale, and display name are
 * captured at construction by the composition root (resolved from the user
 * directory).
 *
 * Template strategy (no fabrication): `@borjie/notifications` exposes only
 * typed, domain-specific templates. The dispatcher renders a proactive
 * nudge through a real template ONLY when the trigger family maps to one
 * whose fields can be populated truthfully from the candidate. For any
 * other family it returns a clean non-delivery (`no_email_template_for_*`)
 * so the sink falls back to logging — it never invents licence numbers,
 * cash figures, or dates to force an unsuitable template.
 *
 * The trigger family is resolved from the candidate's `source` plus the
 * structured fields the composition root threads onto the candidate; the
 * `kind` itself is provided out-of-band via {@link EmailDispatcherDeps} so
 * the dispatcher does not have to parse opaque ids.
 */
import { sendEmail, type BorjieLang } from '@borjie/notifications';
import type {
  ChannelDispatcher,
  DispatchResult,
  FollowupCandidate,
} from '@borjie/user-followup';

/**
 * Structured, truthful template inputs the composition root resolves for
 * a licence/permit-expiry nudge. When absent, the dispatcher declines to
 * send rather than guessing.
 */
export interface LicenceExpiryFacts {
  readonly licenceNumber: string;
  readonly licenceType: 'PML' | 'PL' | 'ML' | 'SML' | 'GML';
  readonly expiryDate: string;
  readonly daysRemaining: number;
  readonly renewUrl: string;
  readonly siteName?: string;
}

export interface EmailDispatcherDeps {
  /** Resolved recipient email address. */
  readonly to: string;
  /** Active locale for this recipient. */
  readonly lang: BorjieLang;
  /** Recipient display name (templates require a salutation). */
  readonly recipientName: string;
  /**
   * Truthful, structured facts for the licence-expiry template, when the
   * fired trigger is a licence/permit-expiry nudge. `null`/absent means
   * "not a licence-expiry trigger" — the dispatcher then declines.
   */
  readonly licenceExpiry?: LicenceExpiryFacts | null;
  /** Seam: defaults to the real `@borjie/notifications` sender. */
  readonly send?: typeof sendEmail;
}

function deliveredNow(): string {
  return new Date().toISOString();
}

/**
 * Build the email {@link ChannelDispatcher}. The composition root creates
 * one per recipient (carrying that recipient's address + locale + facts).
 */
export function createEmailChannelDispatcher(
  deps: EmailDispatcherDeps,
): ChannelDispatcher {
  const send = deps.send ?? sendEmail;

  return {
    channel: 'email',
    async dispatch(candidate: FollowupCandidate): Promise<DispatchResult> {
      const facts = deps.licenceExpiry;
      if (!facts) {
        return {
          delivered: false,
          delivered_at: deliveredNow(),
          error: 'no_email_template_for_trigger',
        };
      }

      try {
        await send({
          template: 'licence-expiry-warning',
          to: deps.to,
          lang: deps.lang,
          // Idempotency: the trigger id flows to the provider so a retried
          // sweep never double-sends the same nudge.
          idempotencyKey: candidate.id,
          data: {
            ownerName: deps.recipientName,
            licenceNumber: facts.licenceNumber,
            licenceType: facts.licenceType,
            expiryDate: facts.expiryDate,
            daysRemaining: facts.daysRemaining,
            renewUrl: facts.renewUrl,
            ...(facts.siteName ? { siteName: facts.siteName } : {}),
          },
        });
        return { delivered: true, delivered_at: deliveredNow() };
      } catch (error) {
        return {
          delivered: false,
          delivered_at: deliveredNow(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
