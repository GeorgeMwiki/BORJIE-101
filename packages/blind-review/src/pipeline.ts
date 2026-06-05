/**
 * Blind-review pipeline — orchestrates a Turing-style M5
 * indistinguishability test for marginal mining decisions.
 *
 * Pure TypeScript, no live DB calls. The pipeline accepts a fetcher
 * (production wires a real store; CI wires a synthetic generator) so it
 * runs end-to-end in CI without manual steps.
 *
 * Flow:
 *   1. fetch -> N marginal cases (50 AI + 50 human by default)
 *   2. anonymise -> redact NIDA, names, phone, account, licence numbers
 *   3. shuffle -> mix AI + human, deterministic seed for replay
 *   4. assign -> each reviewer sees all records in a randomised order
 *   5. score (accuracy-scorer) + report (report-generator)
 */

import {
  DEFAULT_SEED,
  type BlindReviewDataset,
  type MarginalDecisionRecord,
  type MiningDecisionOutcome,
  type ReviewerAssignment,
} from './types.js';

export interface FetchMarginalDecisionsInput {
  readonly limit?: number;
  readonly aiRatio?: number;
}

export interface MarginalDecisionFetcher {
  readonly fetchAi: (
    limit: number,
    opts?: FetchMarginalDecisionsInput,
  ) => Promise<ReadonlyArray<MarginalDecisionRecord>>;
  readonly fetchHuman: (
    limit: number,
    opts?: FetchMarginalDecisionsInput,
  ) => Promise<ReadonlyArray<MarginalDecisionRecord>>;
}

// ---------------------------------------------------------------------------
// PII redaction
// ---------------------------------------------------------------------------

const NIDA_REGEX = /\b\d{8}-\d{5}-\d{5}-\d{2}\b/g;
const PHONE_REGEX = /\b(?:\+?255|0)\s*7\d{2}\s*\d{3}\s*\d{3}\b/g;
const ACCOUNT_REGEX = /\b\d{10,16}\b/g;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LICENCE_REGEX = /\bML-\d{4}-\d{3,6}\b/g;
const NAME_PATTERN =
  /\b(Mr|Mrs|Ms|Bw|Bibi|Mama|Baba)\.?\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*/g;

export function anonymiseRationale(rationale: string): string {
  return rationale
    .replace(NIDA_REGEX, '[NIDA]')
    .replace(LICENCE_REGEX, '[LICENCE]')
    .replace(PHONE_REGEX, '[PHONE]')
    .replace(ACCOUNT_REGEX, '[ACCOUNT]')
    .replace(EMAIL_REGEX, '[EMAIL]')
    .replace(NAME_PATTERN, '[NAME]');
}

function stripPiiFromObject(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') {
      out[k] = anonymiseRationale(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === 'string' ? anonymiseRationale(item) : item,
      );
    } else if (v !== null && typeof v === 'object') {
      out[k] = stripPiiFromObject(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function anonymiseRecord(
  record: MarginalDecisionRecord,
): MarginalDecisionRecord {
  return {
    ...record,
    rationale: anonymiseRationale(record.rationale),
    snapshot: stripPiiFromObject(record.snapshot),
  };
}

// ---------------------------------------------------------------------------
// Deterministic shuffle (mulberry32) for replayability
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicShuffle<T>(
  items: ReadonlyArray<T>,
  seed: number,
): ReadonlyArray<T> {
  const rng = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i] as T;
    const b = arr[j] as T;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface BuildDatasetInput {
  readonly fetcher: MarginalDecisionFetcher;
  readonly limit?: number;
  readonly aiRatio?: number;
  readonly seed?: number;
  /** Clock override for deterministic ids/timestamps in tests. */
  readonly now?: () => number;
}

export async function buildBlindReviewDataset(
  input: BuildDatasetInput,
): Promise<BlindReviewDataset> {
  const limit = input.limit ?? 100;
  const aiRatio = input.aiRatio ?? 0.5;
  const seed = input.seed ?? DEFAULT_SEED;
  const nowMs = (input.now ?? Date.now)();
  const aiTarget = Math.round(limit * aiRatio);
  const humanTarget = limit - aiTarget;

  const [ai, human] = await Promise.all([
    input.fetcher.fetchAi(aiTarget),
    input.fetcher.fetchHuman(humanTarget),
  ]);

  const aiAnon = ai.map(anonymiseRecord);
  const humanAnon = human.map(anonymiseRecord);

  return {
    id: `blr_${seed}_${nowMs.toString(36)}`,
    createdAtMs: nowMs,
    aiRecords: aiAnon,
    humanRecords: humanAnon,
    totalSize: aiAnon.length + humanAnon.length,
  };
}

export interface AssignReviewersInput {
  readonly dataset: BlindReviewDataset;
  readonly reviewerIds: ReadonlyArray<string>;
  readonly seed?: number;
}

export function assignReviewers(
  input: AssignReviewersInput,
): ReadonlyArray<ReviewerAssignment> {
  const allRecords = [...input.dataset.aiRecords, ...input.dataset.humanRecords];
  const seed = input.seed ?? DEFAULT_SEED;
  return input.reviewerIds.map((reviewerId, idx) => {
    const order = deterministicShuffle(allRecords, seed + idx);
    return { reviewerId, recordIds: order.map((r) => r.id) };
  });
}

// ---------------------------------------------------------------------------
// Synthetic fetcher for CI / bootstrap
// ---------------------------------------------------------------------------

export interface SyntheticFetcherOptions {
  readonly seed?: number;
  readonly humanArtefacts?: boolean;
  readonly aiArtefacts?: boolean;
}

export function createSyntheticFetcher(
  options: SyntheticFetcherOptions = {},
): MarginalDecisionFetcher {
  const seed = options.seed ?? DEFAULT_SEED;
  const humanArtefacts = options.humanArtefacts ?? true;
  const aiArtefacts = options.aiArtefacts ?? true;
  const mineralBuckets = ['gold', 'copper', 'gemstone', 'industrial'];
  const regionBuckets = ['geita', 'mara', 'mbeya', 'shinyanga', 'arusha'];
  const decisions: ReadonlyArray<MiningDecisionOutcome> = [
    'approve',
    'reject',
    'request_more_info',
  ];

  function pick<T>(arr: ReadonlyArray<T>, rng: () => number): T {
    return arr[Math.floor(rng() * arr.length)] as T;
  }

  function build(
    author: 'ai' | 'human',
    n: number,
  ): MarginalDecisionRecord[] {
    const rng = mulberry32(seed + (author === 'ai' ? 1 : 2));
    const records: MarginalDecisionRecord[] = [];
    for (let i = 0; i < n; i++) {
      const decision = pick(decisions, rng);
      const mineral = pick(mineralBuckets, rng);
      const region = pick(regionBuckets, rng);
      const grade = (1 + rng() * 6).toFixed(2); // g/t
      const royaltyCover = (rng() * 0.45 + 0.4).toFixed(2);
      const rationale =
        author === 'ai' && aiArtefacts
          ? `Decision: ${decision}. Assay: grade ${grade} g/t; Royalty: coverage ${royaltyCover}; Conditions: ${mineral} price cyclicality; Title: licence in good standing; History: 24-month operating record. Indicators show ${decision === 'approve' ? 'borderline acceptable' : 'marginal'} viability.`
          : humanArtefacts
            ? `assay grade around ${grade} g/t, royalty cover ${royaltyCover} -- given the ${mineral} cycle in ${region} im leaning ${decision} but want a peer review.`
            : `grade ${grade}, royalty cover ${royaltyCover}, mineral ${mineral}, region ${region}, decision ${decision}.`;
      records.push({
        id: `${author}-syn-${i}-${Math.floor(rng() * 1e6)}`,
        caseId: `case-${author}-${i}`,
        domain: 'royalty',
        decision,
        rationale,
        snapshot: {
          assay: { gradeGramsPerTonne: Number(grade) },
          royalty: { coverage: Number(royaltyCover) },
          conditions: { mineral, region },
          title: { inGoodStanding: rng() > 0.4 },
          history: { operatingMonths: 12 + Math.floor(rng() * 36) },
        },
        author,
        decidedAtIsoYear: '2025',
        mineralBucket: mineral,
        regionBucket: region,
      });
    }
    return records;
  }

  return {
    async fetchAi(limit: number) {
      return build('ai', limit);
    },
    async fetchHuman(limit: number) {
      return build('human', limit);
    },
  };
}
