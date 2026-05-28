/**
 * Daily-brief email template.
 *
 * Owner-cockpit daily brief delivered every morning by the
 * daily-brief-cron worker. Inlined-CSS HTML + plaintext fallback so
 * the same template ships to Gmail, Outlook, Apple Mail, and
 * downgraded text-only clients without an extra render pass.
 *
 * The greeting is time-aware and bilingual sw/en. Per the Borjie hard
 * rule, EN must never start with "Karibu" — we ladder Good morning /
 * Good afternoon / Good evening on the recipient timezone.
 */

export interface DailyBriefActionLink {
  readonly label: string;
  readonly url: string;
}

export interface DailyBriefEmailArgs {
  readonly ownerName: string;
  readonly dateIso: string;
  readonly locale: 'sw' | 'en';
  readonly tenantBrandLogoUrl?: string;
  readonly summary3Sentences: string;
  readonly advisorAction?: string;
  readonly actionLinks?: ReadonlyArray<DailyBriefActionLink>;
  /** IANA timezone, e.g. Africa/Dar_es_Salaam. */
  readonly timezone?: string;
  /** Optional pre-rendered tenant trading name (header). */
  readonly tenantTradingName?: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const SAFE_CHARS = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
} as const;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => SAFE_CHARS[ch as keyof typeof SAFE_CHARS]);
}

function hourInTimezone(dateIso: string, tz: string): number {
  try {
    const d = new Date(dateIso);
    if (Number.isNaN(d.getTime())) return 9;
    const fmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: tz,
    });
    const parts = fmt.formatToParts(d);
    const hourPart = parts.find((p) => p.type === 'hour');
    const hour = Number(hourPart?.value ?? NaN);
    if (Number.isFinite(hour) && hour >= 0 && hour < 24) return hour;
    return 9;
  } catch {
    return 9;
  }
}

function timeAwareGreeting(args: DailyBriefEmailArgs): string {
  const hour = hourInTimezone(
    args.dateIso,
    args.timezone ?? 'Africa/Dar_es_Salaam',
  );
  if (args.locale === 'sw') {
    if (hour < 12) return `Habari za asubuhi, ${args.ownerName}`;
    if (hour < 17) return `Habari za mchana, ${args.ownerName}`;
    return `Habari za jioni, ${args.ownerName}`;
  }
  if (hour < 12) return `Good morning, ${args.ownerName}`;
  if (hour < 17) return `Good afternoon, ${args.ownerName}`;
  return `Good evening, ${args.ownerName}`;
}

function subjectLine(args: DailyBriefEmailArgs): string {
  return args.locale === 'sw'
    ? `Bw. Mwikila — muhtasari wa ${args.dateIso}`
    : `Mr. Mwikila — daily brief for ${args.dateIso}`;
}

function actionsBlockText(
  args: DailyBriefEmailArgs,
): string {
  if (!args.actionLinks || args.actionLinks.length === 0) return '';
  const heading = args.locale === 'sw' ? 'Hatua za leo:' : "Today's actions:";
  const lines = args.actionLinks
    .map((a) => `  - ${a.label}: ${a.url}`)
    .join('\n');
  return `\n\n${heading}\n${lines}`;
}

function actionsBlockHtml(
  args: DailyBriefEmailArgs,
): string {
  if (!args.actionLinks || args.actionLinks.length === 0) return '';
  const heading = args.locale === 'sw' ? "Hatua za leo" : "Today's actions";
  const rows = args.actionLinks
    .map(
      (a) => `
            <tr>
              <td style="padding: 6px 0;">
                <a href="${escapeHtml(a.url)}"
                   style="display: inline-block; padding: 10px 18px; background: #d4af37;
                          color: #1a1a1a; text-decoration: none; font-weight: 600;
                          border-radius: 8px; font-size: 14px;">
                  ${escapeHtml(a.label)}
                </a>
              </td>
            </tr>`,
    )
    .join('');
  return `
        <tr>
          <td style="padding: 24px 32px 8px 32px;">
            <h3 style="margin: 0 0 12px 0; font-size: 14px;
                       font-weight: 600; color: #1a1a1a;
                       text-transform: uppercase; letter-spacing: 0.08em;">
              ${escapeHtml(heading)}
            </h3>
            <table cellpadding="0" cellspacing="0" border="0">
              ${rows}
            </table>
          </td>
        </tr>`;
}

function advisorChip(args: DailyBriefEmailArgs): string {
  if (!args.advisorAction) return '';
  const label = args.locale === 'sw' ? 'Pendekezo' : 'Advisor note';
  return `
        <tr>
          <td style="padding: 8px 32px 24px 32px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background: #fbf6e6; border-left: 4px solid #d4af37;
                          border-radius: 6px;">
              <tr>
                <td style="padding: 14px 18px;">
                  <p style="margin: 0 0 6px 0; font-size: 11px;
                            font-weight: 700; color: #8a6d1f;
                            text-transform: uppercase; letter-spacing: 0.10em;">
                    ${escapeHtml(label)}
                  </p>
                  <p style="margin: 0; font-size: 14px;
                            line-height: 1.5; color: #1a1a1a;">
                    ${escapeHtml(args.advisorAction)}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function headerLogo(args: DailyBriefEmailArgs): string {
  if (!args.tenantBrandLogoUrl) {
    return `
            <p style="margin: 0; font-size: 18px; font-weight: 700;
                      color: #1a1a1a; letter-spacing: 0.02em;">
              ${escapeHtml(args.tenantTradingName ?? 'Borjie')}
            </p>`;
  }
  return `
            <img src="${escapeHtml(args.tenantBrandLogoUrl)}"
                 alt="${escapeHtml(args.tenantTradingName ?? 'Borjie')}"
                 height="40"
                 style="display: block; height: 40px; width: auto;" />`;
}

export function renderDailyBriefHtml(args: DailyBriefEmailArgs): string {
  const greeting = timeAwareGreeting(args);
  const subject = subjectLine(args);
  return `<!DOCTYPE html>
<html lang="${args.locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #f5f5f5;
               font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                            'Helvetica Neue', Arial, sans-serif;
               color: #1a1a1a;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"
           style="background: #f5f5f5;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table cellpadding="0" cellspacing="0" border="0" width="600"
                 style="max-width: 600px; background: #ffffff;
                        border-radius: 12px; overflow: hidden;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
            <tr>
              <td style="padding: 24px 32px; border-bottom: 1px solid #ececec;">
                ${headerLogo(args)}
              </td>
            </tr>
            <tr>
              <td style="padding: 28px 32px 8px 32px;">
                <h1 style="margin: 0 0 16px 0; font-size: 22px;
                           font-weight: 700; color: #1a1a1a;">
                  ${escapeHtml(greeting)}
                </h1>
                <p style="margin: 0; font-size: 15px;
                          line-height: 1.6; color: #404040;">
                  ${escapeHtml(args.summary3Sentences)}
                </p>
              </td>
            </tr>
            ${advisorChip(args)}
            ${actionsBlockHtml(args)}
            <tr>
              <td style="padding: 24px 32px; border-top: 1px solid #ececec;
                         font-size: 12px; color: #707070;">
                <p style="margin: 0 0 4px 0;">
                  ${escapeHtml(args.locale === 'sw'
                    ? 'Imeundwa na Bw. Mwikila kwa kushirikiana na Borjie.'
                    : 'Drafted by Mr. Mwikila with Borjie.')}
                </p>
                <p style="margin: 0;">
                  ${escapeHtml(args.dateIso)} ·
                  ${escapeHtml(args.timezone ?? 'Africa/Dar_es_Salaam')}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderDailyBriefText(args: DailyBriefEmailArgs): string {
  const greeting = timeAwareGreeting(args);
  const subject = subjectLine(args);
  const advisor = args.advisorAction
    ? `\n\n${args.locale === 'sw' ? 'Pendekezo' : 'Advisor note'}: ${args.advisorAction}`
    : '';
  const actions = actionsBlockText(args);
  return [
    subject,
    '',
    greeting,
    '',
    args.summary3Sentences,
    advisor,
    actions,
    '',
    args.locale === 'sw'
      ? 'Imeundwa na Bw. Mwikila kwa kushirikiana na Borjie.'
      : 'Drafted by Mr. Mwikila with Borjie.',
    `${args.dateIso} · ${args.timezone ?? 'Africa/Dar_es_Salaam'}`,
  ].join('\n');
}

export function renderDailyBriefEmail(
  args: DailyBriefEmailArgs,
): RenderedEmail {
  return {
    subject: subjectLine(args),
    html: renderDailyBriefHtml(args),
    text: renderDailyBriefText(args),
  };
}
