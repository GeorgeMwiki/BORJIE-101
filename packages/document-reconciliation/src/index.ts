/**
 * @borjie/document-reconciliation — public API (LP-26).
 *
 * Cross-document fact reconciliation + confidence calibration + self-
 * consistency vote + per-issuer fingerprinting + EML/MSG/M-PESA-SMS/QR
 * extractors for mining estate paperwork. Pure functions + injected ports;
 * no direct SDK/DB. Wire the stores + LLM/decoder fallbacks at the host.
 *
 * @module @borjie/document-reconciliation
 */

export * from './types.js';

export {
  levenshtein,
  matchNames,
  normalizePhone,
  matchPhones,
  canonicalizeAddressString,
  matchAddresses,
  matchDates,
  matchAmounts,
  matchBankAccounts,
  reconcileDocBatch,
} from './fact-matcher.js';

export {
  buildFactBag,
  buildFactBags,
  type ExtractedField,
  type ExtractionForReconciliation,
} from './fact-bag-builder.js';

export {
  sigmoid,
  applyPlatt,
  calibrate,
  temperatureScaledPlatt,
  expectedCalibrationError,
  DEFAULT_PLATT,
  DEFAULT_CALIBRATION_TABLE,
  type PlattParams,
  type CalibrationTable,
  type CalibrationSample,
} from './calibration.js';

export {
  voteOnFields,
  type ExtractedFieldLike,
  type FieldVote,
  type VoteResult,
} from './self-consistency.js';

export {
  createInMemoryFingerprintStore,
  canonicaliseHeaderText,
  hashHeaderText,
  computePerceptualHash,
  matchFingerprint,
  registerFingerprint,
  type IssuerFingerprint,
  type FingerprintMatchInput,
  type FingerprintStore,
} from './issuer-fingerprint.js';

export {
  extractMpesaSms,
  parseOneMessage,
  type MpesaSmsRecord,
  type MpesaSmsBatchResult,
  type MpesaSmsLlmFallback,
} from './extractors/mpesa-sms.js';

export {
  extractEml,
  type EmlAttachment,
  type EmlExtractionResult,
} from './extractors/eml.js';

export {
  extractMsg,
  MsgUnsupportedError,
  type MsgExtractionResult,
  type MsgReaderPort,
} from './extractors/msg.js';

export {
  crossVerifyQr,
  decodeAndCrossVerify,
  type QrDecodeInput,
  type QrDecoderPort,
  type QrCrossVerifyResult,
} from './extractors/qr.js';
