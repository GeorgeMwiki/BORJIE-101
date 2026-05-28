/**
 * @borjie/email-templates — server-rendered HTML emails.
 *
 * Every template ships in two render modes:
 *   - `renderHtml(args)` → inlined-CSS HTML string suitable for any
 *                          modern MUA (Gmail / Outlook / Apple Mail).
 *   - `renderText(args)` → plaintext fallback (every transactional
 *                          email MUST include one to avoid spam-rank
 *                          penalties + a11y dead-letter for screen
 *                          readers).
 *
 * Templates are deterministic; the same inputs always produce the
 * same bytes. No external network calls at render time.
 */

export {
  renderDailyBriefEmail,
  renderDailyBriefHtml,
  renderDailyBriefText,
  type DailyBriefEmailArgs,
} from './templates/daily-brief.js';
