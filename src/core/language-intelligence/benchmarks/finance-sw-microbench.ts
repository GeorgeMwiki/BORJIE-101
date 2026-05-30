/**
 * Finance-Swahili micro-bench.
 *
 * SSA-COMET (Wang et al., EMNLP 2025) is the right metric for
 * under-resourced African MT but requires a learned 1B-parameter
 * scorer to evaluate. As an interim P0 we ship a 50-turn finance-
 * domain EN-SW gold-standard pack and a simplified chrF++ scorer.
 * chrF++ correlates strongly with human judgments at the corpus level
 * and is cheap enough to run nightly inside `brain_sleep_runs`.
 *
 * Algorithm: character-n-gram F-score with word-n-gram backoff
 *   chrF++_β = ( (1+β²) · P · R ) / ( β² · P + R )
 * with β = 2 (recall-weighted) and n-grams up to length 6.
 *
 * The bench is the EN gold + SW gold pairs. Pass any translator
 * (EN→SW) to `runFinanceSwMicrobench(translator)` and you get a
 * corpus-level chrF score plus per-item breakdowns.
 *
 * The translator function shape is intentionally provider-agnostic:
 * the cron-side runner can wire in NLLB, Claude, MADLAD-400, or any
 * future model. The bench has no network calls of its own.
 */

// ────────────────────────────────────────────────────────────────────
// chrF++ scorer (simplified, no Moses tokeniser dependency)
// ────────────────────────────────────────────────────────────────────

/**
 * Lowercase + collapse whitespace. We deliberately do NOT strip
 * punctuation because chrF++ counts character n-grams including
 * punctuation by design.
 */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Extract all character n-grams of length n from a normalised string.
 * Spaces are PART of the n-gram alphabet, which is the chrF++
 * convention (it captures word-boundary effects).
 */
function charNgrams(text: string, n: number): Map<string, number> {
  const counts = new Map<string, number>();
  if (text.length < n) return counts;
  for (let i = 0; i + n <= text.length; i++) {
    const g = text.slice(i, i + n);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
}

/**
 * Extract word n-grams (the "++" half of chrF++).
 */
function wordNgrams(text: string, n: number): Map<string, number> {
  const words = text.split(" ").filter((w) => w.length > 0);
  const counts = new Map<string, number>();
  if (words.length < n) return counts;
  for (let i = 0; i + n <= words.length; i++) {
    const g = words.slice(i, i + n).join(" ");
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
}

interface PRPair {
  readonly precision: number;
  readonly recall: number;
}

/**
 * Multi-set intersection precision + recall for two n-gram maps.
 * Returns (0,0) when both inputs are empty.
 */
function pr(ref: Map<string, number>, cand: Map<string, number>): PRPair {
  if (ref.size === 0 && cand.size === 0) return { precision: 0, recall: 0 };
  let matched = 0;
  for (const [g, c] of cand.entries()) {
    const r = ref.get(g) ?? 0;
    matched += Math.min(c, r);
  }
  let candTotal = 0;
  for (const c of cand.values()) candTotal += c;
  let refTotal = 0;
  for (const r of ref.values()) refTotal += r;
  return {
    precision: candTotal === 0 ? 0 : matched / candTotal,
    recall: refTotal === 0 ? 0 : matched / refTotal,
  };
}

function fScore(p: number, r: number, beta: number): number {
  const b2 = beta * beta;
  const denom = b2 * p + r;
  if (denom === 0) return 0;
  return ((1 + b2) * p * r) / denom;
}

/**
 * Simplified chrF++ between a reference string and a candidate string.
 * Returns a score in [0, 1]. β = 2 (recall-weighted), n=6 char-grams,
 * 2 word-grams (chrF++'s default).
 *
 * Identity translator → 1.0 (perfect match).
 * Empty candidate → 0.0.
 * Degraded candidate → between 0 and the reference's natural overlap.
 */
export function computeChrF(reference: string, candidate: string): number {
  const refN = normalise(reference);
  const candN = normalise(candidate);
  if (refN.length === 0 && candN.length === 0) return 1;
  if (refN === candN) return 1;

  const charNs = [1, 2, 3, 4, 5, 6];
  const wordNs = [1, 2];
  const beta = 2;

  let total = 0;
  let count = 0;

  for (const n of charNs) {
    const refMap = charNgrams(refN, n);
    const candMap = charNgrams(candN, n);
    const { precision, recall } = pr(refMap, candMap);
    total += fScore(precision, recall, beta);
    count += 1;
  }

  for (const n of wordNs) {
    const refMap = wordNgrams(refN, n);
    const candMap = wordNgrams(candN, n);
    const { precision, recall } = pr(refMap, candMap);
    total += fScore(precision, recall, beta);
    count += 1;
  }

  return count === 0 ? 0 : total / count;
}

// ────────────────────────────────────────────────────────────────────
// Finance-SW gold pack (50 turns).
//
// Domain mix: 20 lending, 10 KYC/consent, 8 deposit/payments,
// 7 regulatory/disclosure, 5 microfinance (VICOBA/VSLA).
// Hand-translated; cross-checked against `fintech-glossary*.ts` so
// mandatory terms (riba, mkopo, dhamana, salio, malipo, akiba) appear
// in their canonical form.
//
// EXPANSION: when adding new pairs, keep the EN/SW ratio of finance
// terminology realistic. The pack must not drift into general SW.
// ────────────────────────────────────────────────────────────────────

export interface BenchItem {
  readonly id: string;
  readonly domain:
    | "lending"
    | "kyc"
    | "payments"
    | "regulatory"
    | "microfinance";
  readonly en: string;
  readonly sw: string;
}

export const FINANCE_SW_GOLD: ReadonlyArray<BenchItem> = Object.freeze([
  // ── Lending (20) ───────────────────────────────────────────────────
  {
    id: "L01",
    domain: "lending",
    en: "I need a loan of 5 million shillings.",
    sw: "Ninahitaji mkopo wa shilingi milioni tano.",
  },
  {
    id: "L02",
    domain: "lending",
    en: "The interest rate is 18 percent per year.",
    sw: "Kiwango cha riba ni asilimia kumi na nane kwa mwaka.",
  },
  {
    id: "L03",
    domain: "lending",
    en: "Please submit your loan application.",
    sw: "Tafadhali wasilisha maombi yako ya mkopo.",
  },
  {
    id: "L04",
    domain: "lending",
    en: "The repayment period is 12 months.",
    sw: "Muda wa kulipa ni miezi kumi na miwili.",
  },
  {
    id: "L05",
    domain: "lending",
    en: "Your collateral is required.",
    sw: "Dhamana yako inahitajika.",
  },
  {
    id: "L06",
    domain: "lending",
    en: "Your application has been approved.",
    sw: "Maombi yako yamekubaliwa.",
  },
  {
    id: "L07",
    domain: "lending",
    en: "Monthly installment is two hundred thousand shillings.",
    sw: "Malipo ya kila mwezi ni shilingi laki mbili.",
  },
  {
    id: "L08",
    domain: "lending",
    en: "Please pay the late fee.",
    sw: "Tafadhali lipa ada ya kuchelewa.",
  },
  {
    id: "L09",
    domain: "lending",
    en: "Your loan balance is one million shillings.",
    sw: "Salio lako la mkopo ni shilingi milioni moja.",
  },
  {
    id: "L10",
    domain: "lending",
    en: "The grace period is 30 days.",
    sw: "Muda wa neema ni siku thelathini.",
  },
  {
    id: "L11",
    domain: "lending",
    en: "We will review your business plan.",
    sw: "Tutapitia mpango wako wa biashara.",
  },
  {
    id: "L12",
    domain: "lending",
    en: "Your application has been declined.",
    sw: "Maombi yako yamekataliwa.",
  },
  {
    id: "L13",
    domain: "lending",
    en: "Please provide proof of income.",
    sw: "Tafadhali toa uthibitisho wa kipato.",
  },
  {
    id: "L14",
    domain: "lending",
    en: "We need three months of bank statements.",
    sw: "Tunahitaji taarifa za benki za miezi mitatu.",
  },
  {
    id: "L15",
    domain: "lending",
    en: "The disbursement will happen tomorrow.",
    sw: "Utoaji wa fedha utafanyika kesho.",
  },
  {
    id: "L16",
    domain: "lending",
    en: "Sign here to accept the terms.",
    sw: "Saini hapa kukubali masharti.",
  },
  {
    id: "L17",
    domain: "lending",
    en: "Your credit score is good.",
    sw: "Alama yako ya mkopo ni nzuri.",
  },
  {
    id: "L18",
    domain: "lending",
    en: "We offer flexible repayment plans.",
    sw: "Tunatoa mipango ya kulipa inayoweza kubadilika.",
  },
  {
    id: "L19",
    domain: "lending",
    en: "The processing fee is two percent.",
    sw: "Ada ya usindikaji ni asilimia mbili.",
  },
  {
    id: "L20",
    domain: "lending",
    en: "Your loan officer will contact you soon.",
    sw: "Afisa wako wa mkopo atawasiliana nawe karibuni.",
  },

  // ── KYC / Consent (10) ─────────────────────────────────────────────
  {
    id: "K01",
    domain: "kyc",
    en: "Please confirm your full name.",
    sw: "Tafadhali thibitisha jina lako kamili.",
  },
  {
    id: "K02",
    domain: "kyc",
    en: "Show me your national identity card.",
    sw: "Nionyeshe kitambulisho chako cha taifa.",
  },
  {
    id: "K03",
    domain: "kyc",
    en: "I agree to share my data for credit assessment.",
    sw: "Nakubali kushiriki taarifa zangu kwa tathmini ya mkopo.",
  },
  {
    id: "K04",
    domain: "kyc",
    en: "You may withdraw your consent at any time.",
    sw: "Unaweza kufuta idhini yako wakati wowote.",
  },
  {
    id: "K05",
    domain: "kyc",
    en: "Your information is protected by law.",
    sw: "Taarifa zako zinalindwa na sheria.",
  },
  {
    id: "K06",
    domain: "kyc",
    en: "Please give your date of birth.",
    sw: "Tafadhali toa tarehe yako ya kuzaliwa.",
  },
  {
    id: "K07",
    domain: "kyc",
    en: "What is your residential address?",
    sw: "Anwani yako ya makazi ni ipi?",
  },
  {
    id: "K08",
    domain: "kyc",
    en: "Please confirm your phone number.",
    sw: "Tafadhali thibitisha namba yako ya simu.",
  },
  {
    id: "K09",
    domain: "kyc",
    en: "Do you understand the consent terms?",
    sw: "Je, unaelewa masharti ya idhini?",
  },
  {
    id: "K10",
    domain: "kyc",
    en: "Please record your verbal consent.",
    sw: "Tafadhali rekodi idhini yako ya mdomo.",
  },

  // ── Payments / Deposits (8) ────────────────────────────────────────
  {
    id: "P01",
    domain: "payments",
    en: "Your account balance is two hundred thousand shillings.",
    sw: "Salio la akaunti yako ni shilingi laki mbili.",
  },
  {
    id: "P02",
    domain: "payments",
    en: "I want to deposit money.",
    sw: "Nataka kuweka pesa.",
  },
  {
    id: "P03",
    domain: "payments",
    en: "Please send the payment via mobile money.",
    sw: "Tafadhali tuma malipo kupitia pesa za simu.",
  },
  {
    id: "P04",
    domain: "payments",
    en: "Your payment has been received.",
    sw: "Malipo yako yamepokelewa.",
  },
  {
    id: "P05",
    domain: "payments",
    en: "The transaction failed.",
    sw: "Muamala umeshindikana.",
  },
  {
    id: "P06",
    domain: "payments",
    en: "Please confirm the transfer amount.",
    sw: "Tafadhali thibitisha kiasi cha uhamisho.",
  },
  {
    id: "P07",
    domain: "payments",
    en: "Your savings account is active.",
    sw: "Akaunti yako ya akiba inafanya kazi.",
  },
  {
    id: "P08",
    domain: "payments",
    en: "Withdrawals are limited to one million shillings per day.",
    sw: "Utoaji una kikomo cha shilingi milioni moja kwa siku.",
  },

  // ── Regulatory / Disclosure (7) ────────────────────────────────────
  {
    id: "R01",
    domain: "regulatory",
    en: "The total cost of credit is published bilingually.",
    sw: "Gharama jumla ya mkopo imechapishwa kwa lugha mbili.",
  },
  {
    id: "R02",
    domain: "regulatory",
    en: "All charges are disclosed before signing.",
    sw: "Gharama zote zinawekwa wazi kabla ya kusaini.",
  },
  {
    id: "R03",
    domain: "regulatory",
    en: "You may file a complaint with the Bank of Tanzania.",
    sw: "Unaweza kuwasilisha malalamiko kwa Benki Kuu ya Tanzania.",
  },
  {
    id: "R04",
    domain: "regulatory",
    en: "Our microfinance license is current.",
    sw: "Leseni yetu ya fedha ndogo ni halali.",
  },
  {
    id: "R05",
    domain: "regulatory",
    en: "We comply with the Personal Data Protection Act.",
    sw: "Tunazingatia Sheria ya Ulinzi wa Taarifa Binafsi.",
  },
  {
    id: "R06",
    domain: "regulatory",
    en: "Effective annual interest rate is twenty percent.",
    sw: "Kiwango cha riba kinachotumika kwa mwaka ni asilimia ishirini.",
  },
  {
    id: "R07",
    domain: "regulatory",
    en: "Please read the full disclosure document.",
    sw: "Tafadhali soma waraka wa ufichuaji kamili.",
  },

  // ── Microfinance / VICOBA (5) ──────────────────────────────────────
  {
    id: "M01",
    domain: "microfinance",
    en: "Our savings group meets every week.",
    sw: "Kikundi chetu cha akiba hukutana kila wiki.",
  },
  {
    id: "M02",
    domain: "microfinance",
    en: "Each member contributes ten thousand shillings.",
    sw: "Kila mwanachama anachangia shilingi elfu kumi.",
  },
  {
    id: "M03",
    domain: "microfinance",
    en: "The group has a loan fund.",
    sw: "Kikundi kina mfuko wa mikopo.",
  },
  {
    id: "M04",
    domain: "microfinance",
    en: "We elect new leaders every year.",
    sw: "Tunachagua viongozi wapya kila mwaka.",
  },
  {
    id: "M05",
    domain: "microfinance",
    en: "Members can borrow up to three times their savings.",
    sw: "Wanachama wanaweza kukopa hadi mara tatu ya akiba zao.",
  },
]);

// ────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────

export type Translator = (englishSource: string) => Promise<string> | string;

export interface MicrobenchPerItem {
  readonly id: string;
  readonly domain: BenchItem["domain"];
  readonly reference: string;
  readonly candidate: string;
  readonly chrF: number;
}

export interface MicrobenchResult {
  readonly chrF: number;
  readonly itemCount: number;
  readonly perItem: ReadonlyArray<MicrobenchPerItem>;
  readonly chrFByDomain: Readonly<Record<BenchItem["domain"], number>>;
}

/**
 * Run the finance-SW micro-bench against any translator function.
 *
 * The translator is invoked with the EN source and must return the SW
 * candidate (string or Promise<string>). The runner is provider-
 * agnostic and pure — there are no network calls inside this module.
 */
export async function runFinanceSwMicrobench(
  translator: Translator,
  pack: ReadonlyArray<BenchItem> = FINANCE_SW_GOLD,
): Promise<MicrobenchResult> {
  const perItem: MicrobenchPerItem[] = [];
  for (const item of pack) {
    const raw = await Promise.resolve(translator(item.en));
    const candidate = typeof raw === "string" ? raw : "";
    const chrF = computeChrF(item.sw, candidate);
    perItem.push({
      id: item.id,
      domain: item.domain,
      reference: item.sw,
      candidate,
      chrF,
    });
  }

  const total = perItem.reduce((acc, it) => acc + it.chrF, 0);
  const corpusChrF = perItem.length === 0 ? 0 : total / perItem.length;

  // Per-domain breakdown (helps spot which domain regressed).
  const byDomain: Record<BenchItem["domain"], number[]> = {
    lending: [],
    kyc: [],
    payments: [],
    regulatory: [],
    microfinance: [],
  };
  for (const it of perItem) byDomain[it.domain].push(it.chrF);
  const chrFByDomain: Record<BenchItem["domain"], number> = {
    lending: avg(byDomain.lending),
    kyc: avg(byDomain.kyc),
    payments: avg(byDomain.payments),
    regulatory: avg(byDomain.regulatory),
    microfinance: avg(byDomain.microfinance),
  };

  return {
    chrF: corpusChrF,
    itemCount: perItem.length,
    perItem,
    chrFByDomain,
  };
}

function avg(arr: ReadonlyArray<number>): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}
