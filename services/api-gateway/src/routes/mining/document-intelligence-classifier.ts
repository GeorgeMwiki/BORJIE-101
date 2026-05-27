/**
 * Lightweight keyword-based classifier for uploaded documents.
 *
 * Maps a filename + (optionally) the first 4 KB of text to one of the
 * five canonical Borjie document kinds: contract | rfp | letter |
 * report | other.
 *
 * Why keyword-only? This is the first-pass classifier that runs
 * synchronously at upload time so the UI badge is correct immediately.
 * A stronger LLM classifier ships in the consolidation-worker job and
 * may update the row asynchronously.
 *
 * Bilingual (sw/en). Returns 'other' on no match so the caller never
 * has to handle null.
 */

export type DocumentKind = 'contract' | 'rfp' | 'letter' | 'report' | 'other';

interface KindKeywords {
  readonly kind: DocumentKind;
  /** Keywords (lower-cased, ASCII) — match if ANY appears in name + sample. */
  readonly keywords: ReadonlyArray<string>;
}

const KIND_TABLE: ReadonlyArray<KindKeywords> = [
  {
    kind: 'contract',
    keywords: [
      'contract',
      'agreement',
      'mou',
      'offtake',
      'off-take',
      'mkataba',
      'makubaliano',
      'nda',
      'license agreement',
      'leseni',
    ],
  },
  {
    kind: 'rfp',
    keywords: [
      'rfp',
      'request for proposal',
      'tender',
      'rfq',
      'request for quotation',
      'zabuni',
      'mwito wa pendekezo',
    ],
  },
  {
    kind: 'letter',
    keywords: [
      'letter',
      'cover letter',
      'memo',
      'memorandum',
      'barua',
      'taarifa',
      're:',
      'dear sir',
      'dear madam',
    ],
  },
  {
    kind: 'report',
    keywords: [
      'report',
      'ripoti',
      'assay report',
      'survey report',
      'audit',
      'monthly report',
      'quarterly',
      'annual report',
      'shift report',
      'incident report',
    ],
  },
];

/** Lower-case + strip non-ASCII for stable keyword matching. */
function normalise(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9 :\-]/g, ' ');
}

/**
 * Classify a document by filename and (optional) text sample.
 *
 * Order matters: the first keyword table entry whose keywords match
 * wins. Contract beats letter (the word "letter" sometimes appears in
 * cover letters attached to contracts).
 */
export function classifyDocument(input: {
  readonly fileName: string;
  readonly textSample?: string;
}): DocumentKind {
  const haystack = normalise(
    `${input.fileName} ${input.textSample ?? ''}`.slice(0, 4096),
  );
  for (const entry of KIND_TABLE) {
    for (const keyword of entry.keywords) {
      if (haystack.includes(keyword)) {
        return entry.kind;
      }
    }
  }
  return 'other';
}
