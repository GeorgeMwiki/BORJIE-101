/**
 * Lead Summariser — builds the structured lead profile from a marketing
 * transcript. Pure, deterministic, testable.
 *
 * What we keep:
 *   - role         (owner | tenant | manager | station_master | unknown)
 *   - portfolioSize
 *   - country
 *   - primaryPain  (a single short phrase extracted by keyword)
 *   - summary      (one-paragraph human-readable recap)
 *   - contact      (if shared — email / phone / whatsapp)
 *
 * What we do NOT keep: the raw transcript. Privacy-preserving by
 * construction — only structured fields land in the `marketing_leads`
 * table.
 */

import { qualifyLead } from '../lead-qualifier.js';

export interface LeadSummary {
  readonly role: 'owner' | 'tenant' | 'manager' | 'station_master' | 'unknown';
  readonly portfolioSize: 'micro' | 'small' | 'mid' | 'large' | 'unknown';
  readonly country: 'KE' | 'TZ' | 'UG' | 'other' | null;
  readonly primaryPain: string | null;
  readonly summary: string;
  readonly turnCount: number;
}

const PAIN_KEYWORDS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\barrears|rent\s+is\s+late|late\s+rent|late\s+payer/i, label: 'arrears management' },
  { re: /\bmaintenance|repair|leak|broken|fix/i, label: 'maintenance coordination' },
  { re: /\bowner\s+reports?|reporting|monthly\s+report/i, label: 'owner reporting' },
  { re: /\bvacancy|vacant|empty\s+units?|fill\s+the\s+units/i, label: 'vacancy management' },
  { re: /\breconcile|m-?pesa|mobile\s+money|payments?\s+tracking/i, label: 'payment reconciliation' },
  { re: /\btax|compliance|vat|tra|kra|ura/i, label: 'compliance and tax' },
  { re: /\bexcel|spreadsheet|manual/i, label: 'manual workflow pain' },
  { re: /\btenant\s+screening|vetting|5p|tenant\s+risk/i, label: 'tenant screening' },
  { re: /\blease\s+drafting|lease\s+template|renewal/i, label: 'lease and renewal drafting' },
  { re: /\bscale|grow|expand/i, label: 'scaling the portfolio' },
];

const COUNTRY_KEYWORDS: ReadonlyArray<{ re: RegExp; country: LeadSummary['country'] }> = [
  { re: /\b(nairobi|mombasa|kisumu|eldoret|kenya|ke\b|m-?pesa|kra)\b/i, country: 'KE' },
  { re: /\b(dar\s+es\s+salaam|dar|dodoma|arusha|mbeya|tanzania|tz\b|tra|azam)\b/i, country: 'TZ' },
  { re: /\b(kampala|jinja|entebbe|uganda|ug\b|ura|mtn\s+momo)\b/i, country: 'UG' },
];

const PORTFOLIO_PATTERNS: ReadonlyArray<{ re: RegExp; size: LeadSummary['portfolioSize'] }> = [
  { re: /\b(\d{3,})\s*(?:units?|doors?|apartments?)\b/i, size: 'large' },
  { re: /\b(?:6\d|7\d|8\d|9\d|1[0-9]{2}|2[0-4]\d)\s*(?:units?|doors?)\b/i, size: 'mid' },
  { re: /\b(1[1-9]|[2-5]\d)\s*(?:units?|doors?)\b/i, size: 'small' },
  { re: /\b([1-9])\s*(?:units?|doors?|apartments?|houses?)\b/i, size: 'micro' },
];

export function summariseLead(
  transcript: readonly { role: 'visitor' | 'assistant'; content: string }[]
): LeadSummary {
  const visitorText = transcript
    .filter((t) => t.role === 'visitor')
    .map((t) => t.content)
    .join('\n');

  const classified = qualifyLead(visitorText);

  const country = detectCountry(visitorText);
  const portfolioSize = detectPortfolioSize(visitorText, classified.portfolioSizeHint);
  const primaryPain = detectPain(visitorText);

  const turnCount = transcript.filter((t) => t.role === 'visitor').length;

  const summary = buildSummary({
    role: classified.role,
    portfolioSize,
    country,
    primaryPain,
    turnCount,
  });

  return {
    role: classified.role,
    portfolioSize,
    country,
    primaryPain,
    summary,
    turnCount,
  };
}

function detectCountry(text: string): LeadSummary['country'] {
  for (const { re, country } of COUNTRY_KEYWORDS) {
    if (re.test(text)) return country;
  }
  return null;
}

function detectPortfolioSize(
  text: string,
  fallback: 'micro' | 'small' | 'mid' | 'large' | 'unknown'
): LeadSummary['portfolioSize'] {
  for (const { re, size } of PORTFOLIO_PATTERNS) {
    if (re.test(text)) return size;
  }
  return fallback;
}

function detectPain(text: string): string | null {
  for (const { re, label } of PAIN_KEYWORDS) {
    if (re.test(text)) return label;
  }
  return null;
}

function buildSummary(opts: {
  readonly role: LeadSummary['role'];
  readonly portfolioSize: LeadSummary['portfolioSize'];
  readonly country: LeadSummary['country'];
  readonly primaryPain: string | null;
  readonly turnCount: number;
}): string {
  const parts: string[] = [];
  parts.push(
    opts.role === 'unknown'
      ? 'Prospect role is undetermined'
      : `Prospect is a ${opts.role.replace('_', ' ')}`
  );
  if (opts.portfolioSize !== 'unknown') {
    parts.push(`portfolio size: ${opts.portfolioSize}`);
  }
  if (opts.country) parts.push(`country: ${opts.country}`);
  if (opts.primaryPain) parts.push(`primary pain: ${opts.primaryPain}`);
  parts.push(`${opts.turnCount} meaningful turns`);
  return parts.join('; ') + '.';
}
