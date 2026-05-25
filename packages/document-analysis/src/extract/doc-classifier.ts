/**
 * Document classifier — assigns a `DocType` label with a confidence score.
 *
 * The classifier is bilingual (English + Swahili) and uses keyword
 * weights tuned against the test fixtures. When an LLM client is
 * provided, the classifier consults it as a tie-breaker for low
 * confidence calls.
 *
 * Append-only label set: see `DocTypeSchema` in ../types.ts.
 */

import type { ILlmClient } from '../ports.js';
import { DocTypeSchema, type DocType, THRESHOLDS } from '../types.js';

/**
 * Per-doc-type keyword bags. Each entry is a weighted keyword; English
 * and Swahili share the bag so a single classifier handles mixed-language
 * documents.
 */
const KEYWORDS: Record<Exclude<DocType, 'unknown'>, ReadonlyArray<readonly [string, number]>> = {
  lease_application: [
    ['lease application', 3],
    ['rental application', 3],
    ['applicant', 1.5],
    ['ombi la kupanga', 3],
    ['naomba kupanga', 3],
    ['proposed rent', 1.5],
    ['requested rent', 1.5],
    ['monthly income', 1],
    ['nida no', 1.5],
    ['employer', 1],
  ],
  lease_contract: [
    ['tenancy agreement', 3],
    ['lease agreement', 3],
    ['mkataba wa upangaji', 3],
    ['mkataba wa kodi', 3],
    ['lessor', 2],
    ['lessee', 2],
    ['monthly rent', 1.5],
    ['kodi ya mwezi', 1.5],
    ['lease start date', 1.5],
    ['lease end date', 1.5],
    ['property reference', 1],
  ],
  payment_receipt: [
    ['payment receipt', 3],
    ['gepg', 3],
    ['risiti ya malipo', 3],
    ['risiti', 2],
    ['receipt no', 2],
    ['amount paid', 1.5],
    ['kiasi kilicholipwa', 1.5],
    ['payer name', 1],
    ['payment date', 1],
    ['m-pesa ref', 2],
    ['transaction id', 1.5],
  ],
  national_id: [
    ['national identification authority', 3],
    ['nida', 2.5],
    ['kitambulisho cha taifa', 3],
    ['identity card', 2],
    ['id number', 2],
    ['namba ya kitambulisho', 2],
    ['date of birth', 1.5],
    ['tarehe ya kuzaliwa', 1.5],
    ['fingerprint', 1],
    ['biometric', 1],
  ],
  condition_survey: [
    ['condition survey', 3],
    ['inspection report', 3],
    ['ripoti ya ukaguzi', 3],
    ['unit condition', 2],
    ['hali ya nyumba', 2],
    ['inspection date', 1.5],
    ['inspected by', 1.5],
    ['repair required', 1],
    ['photos attached', 1],
    ['picha zimeambatishwa', 1],
  ],
  complaint_letter: [
    ['complaint', 2],
    ['malalamiko', 3],
    ['hereby write to complain', 2],
    ['naandika malalamiko', 2],
    ['the noise', 1],
    ['kelele', 1],
    ['kindly resolve', 1],
    ['urgent', 1],
    ['repair', 1],
    ['leakage', 1.5],
    ['uvunjaji', 1.5],
  ],
  renewal_request: [
    ['renewal request', 3],
    ['kuomba upya', 3],
    ['extend my lease', 3],
    ['ongeza muda wa mkataba', 3],
    ['continue tenancy', 2],
    ['renew tenancy', 2],
  ],
  termination_notice: [
    ['termination notice', 3],
    ['notice to vacate', 3],
    ['taarifa ya kuondoka', 3],
    ['vacating', 2],
    ['end of tenancy', 2],
    ['mwisho wa mkataba', 2],
  ],
  vendor_invoice: [
    ['invoice no', 3],
    ['vendor invoice', 3],
    ['ankra', 3],
    ['vat number', 1.5],
    ['tin no', 1.5],
    ['line items', 1],
    ['subtotal', 1],
    ['total payable', 1.5],
  ],
};

/** Lowercased substring count. Each occurrence is weighted. */
function score(text: string, bag: ReadonlyArray<readonly [string, number]>): number {
  const haystack = text.toLowerCase();
  let total = 0;
  for (const [needle, weight] of bag) {
    let from = 0;
    while (true) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      total += weight;
      from = idx + needle.length;
    }
  }
  return total;
}

export interface ClassifyResult {
  readonly docType: DocType;
  readonly confidence: number;
  /** Per-class rolled-up scores for diagnostics. */
  readonly scores: Readonly<Record<string, number>>;
  /** True if an LLM call was used to break ties. */
  readonly llmUsed: boolean;
}

export interface ClassifyOptions {
  readonly llm?: ILlmClient | null;
  readonly minConfidence?: number;
}

/**
 * Classify the document. Pure keyword/weight scoring first; LLM
 * tie-breaker only if confidence is low and an `llm` is supplied.
 */
export async function classifyDocType(
  text: string,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const minConfidence = options.minConfidence ?? THRESHOLDS.DOC_TYPE_CONFIDENT;
  if (!text || text.trim().length === 0) {
    return {
      docType: 'unknown',
      confidence: 0,
      scores: {},
      llmUsed: false,
    };
  }

  const scores: Record<string, number> = {};
  let topType: DocType = 'unknown';
  let topScore = 0;

  for (const [type, bag] of Object.entries(KEYWORDS) as Array<[
    Exclude<DocType, 'unknown'>,
    ReadonlyArray<readonly [string, number]>,
  ]>) {
    const s = score(text, bag);
    scores[type] = s;
    if (s > topScore) {
      topScore = s;
      topType = type;
    }
  }

  // Normalise to [0,1] — a top score of 6+ is high confidence.
  const confidence = Math.min(1, topScore / 6);

  if (confidence >= minConfidence || !options.llm) {
    return { docType: topType, confidence, scores, llmUsed: false };
  }

  // LLM tie-breaker.
  try {
    const llmOut = await options.llm.classify({ text });
    const parsed = DocTypeSchema.safeParse(llmOut.docType);
    if (parsed.success) {
      return {
        docType: parsed.data,
        confidence: Math.max(confidence, llmOut.confidence),
        scores,
        llmUsed: true,
      };
    }
  } catch {
    // Swallow — fall back to heuristic.
  }
  return { docType: topType, confidence, scores, llmUsed: false };
}
