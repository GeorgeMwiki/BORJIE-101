/**
 * doc-upload — guard-exempt bilingual strings for the in-chat document
 * upload flow (file_request_card → real gateway upload + extraction).
 *
 * Lives under `i18n/` so the locale-purity scanner skips it; this is the
 * sanctioned home for the Swahili+English literals the upload flow needs,
 * keeping ZERO Swahili tokens in `doc-upload.ts` (the query lib),
 * `FileRequestCardBlock.tsx`, and `HomeChatTeach.tsx`.
 *
 * Each entry is a `{ sw, en }` pair; callers pick the side with their own
 * `locale`/`isSw` flag. Templates use `{name}` / `{count}` tokens resolved
 * by `fillDocUpload()` so the interpolation never reintroduces a Swahili
 * literal into component or lib source.
 *
 * Convention mirrors `i18n/strings/data-b.ts`:
 *   import { docUploadStrings as S } from '@/i18n/strings/doc-upload';
 *   {locale === 'sw' ? S.someKey.sw : S.someKey.en}
 */

type DocUploadLocale = 'sw' | 'en';

interface BilingualString {
  readonly sw: string;
  readonly en: string;
}

const docUploadStrings = {
  /** Live status while the bytes register with the gateway. */
  uploading: { sw: 'Inapakia {name}…', en: 'Uploading {name}…' },
  /** Multi-file progress counter shown under the card. */
  uploadingProgress: {
    sw: 'Inapakia hati {done}/{total}…',
    en: 'Uploading document {done}/{total}…',
  },
  /** Single-file byte progress shown while the binary streams to storage. */
  uploadingPercent: {
    sw: 'Inapakia {name}… {percent}%',
    en: 'Uploading {name}… {percent}%',
  },
  /** Assistant note on success WITH a returned extraction summary. */
  uploadedWithFields: {
    sw: 'Imepakiwa {name} — sehemu {count} zimesomwa',
    en: 'Uploaded {name} — extracted {count} fields',
  },
  /**
   * Assistant note on success without a synchronous extraction summary —
   * i.e. a binary file whose OCR is deferred to the async worker. Reads as
   * "processing" because the structured fields are still being extracted.
   */
  uploadedPlain: {
    sw: 'Imepakiwa {name} — inachakatwa',
    en: 'Uploaded {name} — processing',
  },
  /** Assistant note summarising a multi-file batch. */
  uploadedBatch: {
    sw: 'Imepakia hati {count}',
    en: 'Uploaded {count} documents',
  },
  /** Graceful failure note (network / 4xx / 5xx / parse drift). */
  uploadFailed: {
    sw: 'Imeshindwa kupakia {name}: {reason}',
    en: 'Could not upload {name}: {reason}',
  },
  /** Client-side reject — the picked file fails the validator. */
  rejectedFile: {
    sw: 'Imeshindwa kupakia {name}: {reason}',
    en: 'Skipped {name}: {reason}',
  },
  /** Validator messages — kept locale-pure (the validator returns codes). */
  reasonMimeNotAllowed: {
    sw: 'aina ya faili hairuhusiwi (PDF, DOCX, JPEG, PNG, WEBP)',
    en: 'file type not allowed (PDF, DOCX, JPEG, PNG, WEBP)',
  },
  reasonTooLarge: {
    sw: 'faili ni kubwa kupita kiwango (upeo 25MB)',
    en: 'file is over the limit (max 25 MB)',
  },
  reasonEmpty: { sw: 'faili haina maudhui', en: 'the file is empty' },
  reasonNameRequired: {
    sw: 'jina la faili linahitajika',
    en: 'a file name is required',
  },
  /** Binary path — storage isn't wired so the bytes can't be saved. */
  reasonStorageUnavailable: {
    sw: 'hifadhi ya faili haipatikani kwa sasa',
    en: 'file storage is unavailable right now',
  },
  /** Binary path — the direct-to-storage upload of the bytes failed. */
  reasonStoragePutFailed: {
    sw: 'kupakia faili kwenye hifadhi kumeshindikana',
    en: 'uploading the file to storage failed',
  },
  /** Binary path — bytes saved but the "ready" trigger failed. */
  reasonReadyFailed: {
    sw: 'faili limehifadhiwa lakini kuanzisha uchakataji kumeshindikana',
    en: 'the file was saved but processing could not be started',
  },
  /** Generic fallback reason when the gateway error carries no message. */
  reasonUnknown: { sw: 'jaribu tena', en: 'please try again' },
} as const satisfies Record<string, BilingualString>;

export type DocUploadKey = keyof typeof docUploadStrings;

/**
 * Resolve a doc-upload string for `locale` and fill `{token}` slots from
 * `vars`. Centralising interpolation here means callers never embed a
 * Swahili template literal — they pass numbers/names as vars instead.
 */
export function fillDocUpload(
  key: DocUploadKey,
  locale: DocUploadLocale,
  vars: Readonly<Record<string, string | number>> = {},
): string {
  const template = docUploadStrings[key][locale];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}
