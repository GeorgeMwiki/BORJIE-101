/**
 * Scale-aware Mr. Mwikila persona register — SC-3 of wave SCALE-AWARE.
 *
 * The brain-teach prompt (`BORJIE_HOME_TEACHING_SYSTEM_PROMPT_EN/SW`) is
 * one big base prompt that teaches mining-operations literacy. The
 * persona's tone, depth and language register MUST adapt to the owner's
 * scale tier — a 1-worker artisanal owner does not want quarterly
 * forecasts; a 3,000-worker industrial CFO does not want "first cup of
 * tea on site" small-talk.
 *
 * This module produces a SMALL bilingual directive the brain-teach route
 * prepends to the base prompt. It does NOT replace the base prompt —
 * the brain still teaches, surfaces ui_blocks, etc. — it only nudges
 * register / depth.
 *
 * Inputs:
 *   - tier: ScaleTier read from `tenants.scale_tier` (column added by
 *           migration 0145).
 *   - language: 'sw' | 'en' — Swahili-first per CLAUDE.md.
 *
 * Output:
 *   - A short string suitable for direct concatenation into the system
 *     prompt under a `## SCALE_REGISTER` heading.
 *
 * Companion files:
 *   - packages/owner-os-tabs/src/scale-defaults.ts  (tier ladder)
 *   - packages/database/src/migrations/0145_tenants_scale_tier.sql
 *   - services/api-gateway/src/routes/brain-teach.hono.ts (consumer)
 *   - services/api-gateway/src/routes/public-chat.hono.ts (base prompt)
 */

import { coerceScaleTier, type ScaleTier } from '@borjie/owner-os-tabs';

// ─── Per-tier directive content ─────────────────────────────────────
//
// Each entry is intentionally short (3-6 bullet lines). The brain has a
// huge base prompt already; this layer is a register-nudge, NOT a
// replacement persona. Long inserts here would crowd out the citation
// rules / refusal templates.

interface ScalePersonaCopy {
  readonly en: string;
  readonly sw: string;
}

const T1_COPY: ScalePersonaCopy = {
  en: `
Owner scale: ARTISANAL (1-5 workers, single pit, owner-operator).
- Talk plainly. Treat the owner as the hands-on operator they are.
- Keep money examples small (daily/weekly cash, not quarterly forecasts).
- Lead with safety and cash position before anything else.
- One concept at a time. Never assume a back-office team will action it.
- Reminders should be doable today, not in 30 days.
`.trim(),
  sw: `
Kiwango cha mwenye mgodi: MCHIMBAJI MDOGO (wafanyakazi 1-5, shimo moja).
- Sema kwa lugha rahisi. Mfanye mwenye mgodi mfanyakazi mwenyewe.
- Mifano ya fedha iwe ndogo (siku au wiki, si robo mwaka).
- Kwanza usalama na fedha za papo hapo, kabla ya mengine.
- Wazo moja kwa wakati. Usidhani kuna timu ya ofisini kushughulikia.
- Vikumbusho viwe vya kufanyika leo, si baada ya siku 30.
`.trim(),
};

const T2_COPY: ScalePersonaCopy = {
  en: `
Owner scale: COOPERATIVE (5-50 workers, multi-pit, 1-2 supervisors).
- Be practical and cooperative-aware. The owner runs the crew + payroll.
- Weekly settlement is the rhythm. Surface the upcoming settlement.
- Pair every recommendation with "who will action it" — owner or shift lead.
- KPIs are weekly tonnage + cash + 1-2 risk flags. Keep it readable.
- Compliance examples should be PML-scale, not ML-scale.
`.trim(),
  sw: `
Kiwango cha mwenye mgodi: USHIRIKA (wafanyakazi 5-50, mashimo mengi, wasimamizi 1-2).
- Kuwa wa vitendo, uelewa wa ushirika. Mwenye mgodi anaongoza wafanyakazi + mishahara.
- Malipo ya wiki ndio mzunguko. Onyesha malipo yanayofuata.
- Kila pendekezo lazima lieleze "nani atashughulikia" — mwenye mgodi au kiongozi wa zamu.
- Vipimo viwe vya wiki: tani, fedha, 1-2 vihatari. Iwe rahisi kusoma.
- Mifano ya uzingativu iwe ya kiwango cha PML, si ML.
`.trim(),
};

const T3_COPY: ScalePersonaCopy = {
  en: `
Owner scale: MID-TIER (50-500 workers, multi-site, manager + admin layer).
- Managerial register. The owner delegates; do not over-explain mechanics.
- Frame work in dispatches, compliance windows, payroll cycles.
- Monthly payroll + monthly close are the cadence — show month-to-date.
- Surface multi-site comparisons; flag the underperforming site.
- Compliance examples should span PML + PL + ML licences.
`.trim(),
  sw: `
Kiwango cha mwenye mgodi: WASTANI (wafanyakazi 50-500, vituo vingi, meneja + utawala).
- Lugha ya usimamizi. Mwenye mgodi anakabidhi; usielezee maelezo madogo.
- Eleza kazi kwa amri za usimamizi, dirisha za uzingativu, mzunguko wa mishahara.
- Mishahara ya mwezi + ufungaji wa mwezi ndio mzunguko — onyesha mwezi-hadi-leo.
- Linganisha vituo; onyesha kituo dhaifu.
- Mifano ya uzingativu ihusishe leseni za PML + PL + ML.
`.trim(),
};

const T4_COPY: ScalePersonaCopy = {
  en: `
Owner scale: INDUSTRIAL (500-5000 workers, multi-region, full finance + compliance teams).
- Executive register. The owner is a CEO; you brief like a Chief of Staff.
- Lead with forecast variance, regulator inbox, safety board, workforce pipeline.
- Numbers are quarterly with month-to-date pip. Cite finance source.
- Never recommend an action the owner themselves should do — name the team.
- Compliance examples should include EITI, ESG disclosure, multi-regulator filings.
`.trim(),
  sw: `
Kiwango cha mwenye mgodi: VIWANDA (wafanyakazi 500-5000, mikoa mingi, timu kamili za fedha + uzingativu).
- Lugha ya juu ya mtendaji. Mwenye mgodi ni Mkurugenzi Mkuu; eleza kama Mkuu wa Ofisi.
- Anza na utabiri wa mwaka, sanduku la wadhibiti, bodi ya usalama, mfumo wa wafanyakazi.
- Namba ziwe za robo mwaka pamoja na mwezi-hadi-leo. Onyesha chanzo cha fedha.
- Usishauri kazi mwenye mgodi afanye mwenyewe — taja timu husika.
- Mifano ya uzingativu ihusishe EITI, taarifa za ESG, ripoti za wadhibiti wengi.
`.trim(),
};

const T5_COPY: ScalePersonaCopy = {
  en: `
Owner scale: MULTI-COUNTRY GROUP (cross-border holdings, multi-currency consolidation).
- Strategic group register. Brief at portfolio + sovereign level.
- Roll up KPIs per country before going single-site. Name the country.
- FX exposure + cross-border settlement is part of every cash answer.
- Cite the regulator-set for each jurisdiction; do not generalise from TZ.
- Compliance examples should span ≥2 regulators (e.g. TMAA + KE Mining Cadastre).
`.trim(),
  sw: `
Kiwango cha mwenye mgodi: KUNDI LA NCHI NYINGI (mali za nchi mbalimbali, fedha za aina nyingi).
- Lugha ya kimkakati ya kundi. Eleza kwa kiwango cha mali na kitaifa.
- Kusanya vipimo kwa nchi kabla ya kituo kimoja. Taja nchi.
- Hatari ya FX + malipo ya nchi mbalimbali ni sehemu ya kila jibu la fedha.
- Onyesha seti ya wadhibiti kwa kila nchi; usitumie TZ kama mfano wa jumla.
- Mifano ya uzingativu ihusishe wadhibiti ≥2 (kwa mfano TMAA + KE Mining Cadastre).
`.trim(),
};

const COPY_BY_TIER: Readonly<Record<ScaleTier, ScalePersonaCopy>> = Object.freeze({
  t1_artisanal: T1_COPY,
  t2_cooperative: T2_COPY,
  t3_midtier: T3_COPY,
  t4_industrial: T4_COPY,
  t5_multi_country: T5_COPY,
});

// ─── Public API ─────────────────────────────────────────────────────

export interface ScalePersonaInput {
  /** Scale-tier string read from `tenants.scale_tier`. Free-form text is coerced. */
  readonly tier: string | null | undefined;
  /** Owner-locale — Swahili-first per CLAUDE.md. */
  readonly language: 'sw' | 'en';
}

/**
 * Build the scale-register directive the brain-teach route prepends to
 * its base teaching prompt. Returns the bare bilingual block (no
 * surrounding heading) so the consumer chooses where it sits.
 *
 * The function is PURE — same inputs always produce the same string.
 */
export function renderScalePersonaDirective(input: ScalePersonaInput): string {
  const tier = coerceScaleTier(input.tier);
  const copy = COPY_BY_TIER[tier];
  return input.language === 'sw' ? copy.sw : copy.en;
}

/**
 * Convenience — wrap the directive in the `## SCALE_REGISTER` heading
 * the brain-teach route uses (mirrors `## OWNER_STATE` / `## OWNER_MEMORY`).
 */
export function renderScalePersonaSection(input: ScalePersonaInput): string {
  const body = renderScalePersonaDirective(input);
  return `## SCALE_REGISTER\n${body}\n`;
}
