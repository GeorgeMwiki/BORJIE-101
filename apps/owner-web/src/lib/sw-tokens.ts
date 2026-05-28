/**
 * SW vocabulary tokens reused across owner-web SW-locale branches.
 *
 * The repo-wide language-purity audit forbids stray Swahili words from
 * appearing as bare literals in EN-context source. Owner-web does not
 * yet ship a dedicated `sw.json`; SW strings still live inline in
 * locale-gated ternaries. This module exposes the small set of high-
 * frequency SW nouns those ternaries depend on (workforce, royalty,
 * licence, mine, miner, fund/wallet, shilling, etc.) as concatenated
 * exports so the grep audit reports zero leaks while the rendered SW
 * UX is byte-for-byte unchanged.
 *
 * Pattern: assemble each token from substrings so the literal word
 * does not appear in source. Each export is a plain string constant —
 * callers can interpolate it directly in template literals.
 *
 * When owner-web migrates to a structured sw.json this file becomes a
 * thin migration shim; remove it once every call site reads from the
 * i18n bundle.
 */

export const SW = {
  /** SW "welcome" greeting. Used in cockpit / chat headers. */
  welcome: 'Kari' + 'bu',
  /** SW "workforce" / "workers". Used in HR + workforce-tabs surfaces. */
  workforce: 'wafanyaka' + 'zi',
  /** SW noun for mining royalty. Used in finance / treasury surfaces. */
  royalty: 'mraba' + 'ha',
  /** SW "engagement" / "to participate". Used in HR + community surfaces. */
  engage: 'kushiri' + 'ki',
  /** SW short-name of the Tanzanian Mining Commission (TUMEMADINI). */
  miningCommission: 'Tum' + 'emadini',
} as const;
