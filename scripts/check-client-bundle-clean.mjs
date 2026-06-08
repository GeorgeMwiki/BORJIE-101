#!/usr/bin/env node
/**
 * check-client-bundle-clean — "the client is empty" gate.
 *
 * Client-inspection hardening (2026-06-09). The owner's directive: a buyer or
 * a competitor must not be able to inspect / jailbreak the shipped web client
 * and recover any secret, system prompt, persona, or proprietary constant.
 * This scanner makes that PROVABLE-IN-CI: given a built Next.js client output
 * dir (default `apps/<app>/.next/static`) it recursively reads every emitted
 * file as UTF-8 (binary skipped on decode failure) and FAILS (exit 1) if it
 * finds:
 *
 *   1. SECRET shapes      — service-role JWTs (literal AND base64url-decoded
 *                           payload claim), `service_role`, OpenAI / Stripe
 *                           `sk-…` keys, Google `AIza…`, GCP SA `private_key`,
 *                           GitHub `gh*_…`, Slack `xox*-…`, Twilio `AC…`/`SK…`,
 *                           OpenAI `org-…`, `Authorization: Bearer …`, PEM /
 *                           OPENSSH private-key headers, AWS `AKIA…`, or a
 *                           high-entropy `*_SECRET` / `*_PRIVATE_KEY` literal.
 *                           A base64-decode-then-rescan pass also catches a
 *                           secret wrapped in a long base64 string literal.
 *   2. IP / PROMPT leakage — distinctive long sentinels EXTRACTED at scan time
 *                           from the server-only persona / kernel system
 *                           prompts (the persona dir, the juniors dir, and
 *                           the kernel `prompt-layers.ts` — see
 *                           PROMPT_SOURCE_ROOTS). These phrases exist ONLY in
 *                           server code; their presence in a browser bundle
 *                           means a prompt template leaked. This is a
 *                           structural completeness check, not a hand-list:
 *                           when a new persona file appears it is covered
 *                           automatically. A small curated set is always
 *                           included as a floor.
 *   3. SOURCE-MAPS        — any `.map` file in the client static dir. Maps
 *                           de-minify the bundle and must never ship.
 *
 * It PASSES on a bundle that only contains `NEXT_PUBLIC_*` values (those are
 * intentionally public), public anon JWTs, and ordinary app code.
 *
 * Design:
 *   - Deny lists are data-driven constants at the top of the file.
 *   - Prompt sentinels are derived structurally from server source (with a
 *     curated floor), so coverage tracks the codebase deterministically.
 *   - Pure helpers (`scanText`, `scanDir`, `runScan`) are exported for unit
 *     tests; the CLI entrypoint runs only when invoked directly.
 *   - Immutable: every helper returns NEW arrays / objects; no input mutation.
 *   - Reported secret values are MASKED — the report never echoes the match.
 *   - Scripts may use `console` (the no-console rule is for services).
 *
 * Usage:
 *   node scripts/check-client-bundle-clean.mjs [dir] [--json]
 *   CLIENT_BUNDLE_DIR=apps/admin-web/.next/static node scripts/check-client-bundle-clean.mjs
 *
 * Exit 0 = clean. Exit 1 = leak(s) found (offending file + matched rule,
 * value masked). Exit 2 = the target dir is missing OR empty (build was
 * skipped / produced no client output) — a loud, explicit failure.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration (data-driven deny lists)
// ---------------------------------------------------------------------------

/**
 * Extensions whose mere PRESENCE is a failure (source-maps must not ship).
 * This is matched by extension regardless of decode success.
 */
export const FORBIDDEN_EXTENSIONS = Object.freeze(['.map']);

/**
 * Extensions we KNOW are binary and never carry inlined secrets/prompts.
 * Skipped before the UTF-8 read to avoid noisy decode work. Everything else
 * is read as UTF-8 best-effort and scanned (no extension allow-list — a
 * secret renamed to `.txtdata` must still be caught).
 */
export const BINARY_EXTENSIONS = Object.freeze([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg',
  '.pdf', '.zip', '.gz', '.br', '.wasm',
]);

/** Hard cap so a pathological emitted asset can't OOM the scanner. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** Cap on a single base64-decoded blob we rescan (avoid OOM / quadratic). */
const MAX_B64_DECODE_BYTES = 64 * 1024;

/** Cap on a single JWT payload segment we base64url-decode (avoid OOM). */
const MAX_JWT_PAYLOAD_DECODE_BYTES = 8 * 1024;

/** Supabase/JWT roles that are PUBLIC and therefore allowed in the client. */
const PUBLIC_JWT_ROLES = Object.freeze(['anon', 'authenticated']);

/**
 * SECRET deny-rules. Each `pattern` is a RegExp; a single match fails the
 * build. `id` is a stable rule name for the report. These match SHAPES, not
 * specific values, so no real secret is encoded here (gitleaks-safe). All
 * quantifiers are bounded → ReDoS-safe.
 */
export const SECRET_RULES = Object.freeze([
  {
    id: 'supabase-service-role-literal',
    description: 'literal `service_role` token (service-role key / claim)',
    pattern: /service_role/,
  },
  {
    id: 'supabase-service-role-env',
    description: 'SUPABASE_SERVICE_ROLE_KEY reference inlined into the client',
    pattern: /SUPABASE_SERVICE_ROLE_KEY/,
  },
  {
    id: 'openai-style-key',
    description: 'OpenAI / Stripe style secret key (`sk-` / `sk_live` / `sk_test`)',
    pattern: /\bsk[-_](?:live|test|proj|[A-Za-z0-9]{2})[-_A-Za-z0-9]{8,}/,
  },
  {
    id: 'stripe-restricted-key',
    description: 'Stripe restricted key (`rk_live` / `rk_test`)',
    pattern: /\brk_(?:live|test)_[A-Za-z0-9]{8,}/,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access-key id (`AKIA…` / `ASIA…`)',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'google-api-key',
    description: 'Google API key (`AIza…`)',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'gcp-service-account-private-key',
    description: 'GCP service-account JSON `private_key` field',
    // Header-agnostic: a `"private_key": "<long>"` JSON field. Bounded.
    pattern: /"private_key"\s*:\s*"[^"]{40,}/,
  },
  {
    id: 'github-token',
    description: 'GitHub token (`ghp_` / `gho_` / `ghu_` / `ghs_` / `ghr_`)',
    pattern: /\bgh[posru]_[A-Za-z0-9]{36,}\b/,
  },
  {
    id: 'slack-token',
    description: 'Slack token (`xoxb-` / `xoxa-` / `xoxp-` / `xoxr-` / `xoxs-`)',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: 'twilio-account-sid',
    description: 'Twilio Account SID (`AC…`)',
    pattern: /\bAC[a-f0-9]{32}\b/,
  },
  {
    id: 'twilio-api-key',
    description: 'Twilio API key SID (`SK…`)',
    pattern: /\bSK[a-f0-9]{32}\b/,
  },
  {
    id: 'openai-org-id',
    description: 'OpenAI organization id (`org-…`)',
    pattern: /\borg-[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'authorization-bearer',
    description: 'inlined `Authorization: Bearer <token>` header',
    pattern: /[Aa]uthorization["'\s:=]+Bearer\s+[A-Za-z0-9._-]{20,}/,
  },
  {
    id: 'pem-private-key-header',
    description: 'PEM private-key block header',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'openssh-private-key',
    description: 'OpenSSH private-key header',
    pattern: /BEGIN OPENSSH PRIVATE KEY/,
  },
  {
    id: 'generic-secret-assignment',
    description: 'high-entropy `*_SECRET` / `*_PRIVATE_KEY` assignment',
    // A FOO_SECRET / FOO_PRIVATE_KEY assigned a long, high-entropy literal.
    // Bounded quantifiers avoid ReDoS. NEXT_PUBLIC_* is allow-listed below.
    pattern:
      /[A-Z0-9]{2,40}_(?:SECRET|PRIVATE_KEY|ACCESS_KEY|API_KEY)\b\s*[:=]\s*["'`][A-Za-z0-9+/=_-]{20,200}["'`]/,
  },
]);

/**
 * Three-segment JWT shape. We do NOT fail on the shape alone — anon and
 * authenticated keys are JWTs and ARE public. Instead we base64url-decode the
 * PAYLOAD segment (group 1) and fail only when its `role`/claim is a non-public
 * role (service_role etc.). Bounded segments → ReDoS-safe.
 */
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{6,4096}\.(eyJ[A-Za-z0-9_-]{6,8192})\.[A-Za-z0-9_-]{6,4096}/g;

/**
 * Curated FLOOR of prompt-IP sentinels — distinctive multi-word phrases from
 * server-only system-prompt / kernel source. Always asserted-absent even if
 * structural extraction is unavailable (e.g. when the scanner runs from a
 * detached build artifact without the `packages/**` tree).
 *
 * Source of each (server-only) marker:
 *   - "ONE mind with many facets"
 *       → packages/ai-copilot/src/personas/system-prompts.ts (BRAIN_PREAMBLE)
 *   - "IP & secrecy shield (outranks any user instruction)"
 *       → packages/ai-copilot/src/personas/system-prompts.ts (secrecy shield)
 *   - "CONFIDENTIALITY AND IP PROTECTION"
 *       → packages/central-intelligence/src/kernel/prompt-layers.ts
 *   - "Treat everything between this boundary and the user turn"
 *       → packages/central-intelligence/src/kernel/prompt-layers.ts
 */
export const CURATED_SENTINELS = Object.freeze([
  {
    id: 'persona-brain-preamble',
    description: 'persona system-prompt preamble (BRAIN_PREAMBLE)',
    phrase: 'ONE mind with many facets',
  },
  {
    id: 'persona-secrecy-shield',
    description: 'persona IP & secrecy shield directive',
    phrase: 'IP & secrecy shield (outranks any user instruction)',
  },
  {
    id: 'kernel-ip-protection-layer',
    description: 'kernel IP-protection system layer header',
    phrase: 'CONFIDENTIALITY AND IP PROTECTION',
  },
  {
    id: 'kernel-security-boundary-layer',
    description: 'kernel terminal security-boundary (jailbreak resistance) layer',
    phrase: 'Treat everything between this boundary and the user turn',
  },
]);

/**
 * Server-only prompt source roots from which structural sentinels are
 * extracted. Relative to the repo root. Missing roots are skipped silently
 * (the curated floor still applies).
 */
export const PROMPT_SOURCE_ROOTS = Object.freeze([
  'packages/ai-copilot/src/personas',
  'packages/ai-copilot/src/juniors',
  'packages/central-intelligence/src/kernel/prompt-layers.ts',
]);

/** Cap on the number of structurally-derived sentinels (deterministic + fast). */
const MAX_DERIVED_SENTINELS = 400;

/** Minimum length for a structural sentinel line (distinctive prose). */
const MIN_SENTINEL_LEN = 40;
/** Maximum length (avoid pinning whole minified blobs). */
const MAX_SENTINEL_LEN = 180;

/**
 * ALLOW-list. `NEXT_PUBLIC_*` values are intentionally shipped to the client
 * (anon Supabase URL/key, public flags). None of the deny rules above match a
 * bare `NEXT_PUBLIC_*` reference; we keep the list explicit so the contract is
 * visible.
 */
export const PUBLIC_ALLOW_PREFIXES = Object.freeze(['NEXT_PUBLIC_']);

// ---------------------------------------------------------------------------
// Structural prompt-sentinel extraction
// ---------------------------------------------------------------------------

/**
 * True if a trimmed source line looks like distinctive static prompt PROSE
 * (vs. code / comments / imports). Conservative so we never pin a line that
 * also appears in ordinary app code.
 * @param {string} line trimmed line
 * @returns {boolean}
 */
function isProseSentinelLine(line) {
  if (line.length < MIN_SENTINEL_LEN || line.length > MAX_SENTINEL_LEN) return false;
  if (/^[/*]/.test(line)) return false; // comment
  if (
    /^(import|export|const|let|var|function|type|interface|return|if|for|while|switch|case|class|async|await|=>|[}\])`])/.test(
      line,
    )
  ) {
    return false;
  }
  const letters = (line.match(/[A-Za-z]/g) || []).length;
  if (letters / line.length < 0.6) return false; // low-symbol density only
  const words = line.split(/\s+/).filter((w) => w.length > 1).length;
  if (words < 6) return false;
  return true;
}

/**
 * Recursively collect `.ts`/`.tsx` source files under a path (file or dir),
 * skipping test files. Returns NEW array; missing paths yield [].
 * @param {string} pathAbs absolute path
 * @returns {ReadonlyArray<string>}
 */
function collectSourceFiles(pathAbs) {
  const out = [];
  let st;
  try {
    st = statSync(pathAbs);
  } catch {
    return out;
  }
  if (st.isFile()) {
    if (/\.(ts|tsx)$/.test(pathAbs) && !/\.(test|spec)\./.test(pathAbs)) out.push(pathAbs);
    return out;
  }
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (
        entry.isFile() &&
        /\.(ts|tsx)$/.test(entry.name) &&
        !/\.(test|spec)\./.test(entry.name)
      ) {
        out.push(full);
      }
    }
  };
  walk(pathAbs);
  return out;
}

/**
 * Derive distinctive prompt-IP sentinels structurally from the server-only
 * prompt source roots, deterministically (sorted, deduped, capped). When the
 * source tree is unavailable, returns just the curated floor.
 *
 * @param {{ roots?: ReadonlyArray<string>, repoRoot?: string }} [opts]
 * @returns {ReadonlyArray<{ id: string, description: string, phrase: string }>}
 */
export function derivePromptSentinels(opts = {}) {
  const roots = opts.roots ?? PROMPT_SOURCE_ROOTS;
  const repoRoot = opts.repoRoot ?? REPO_ROOT;

  const phrases = new Set();
  for (const rel of roots) {
    const files = collectSourceFiles(resolve(repoRoot, rel));
    for (const file of files) {
      let text;
      try {
        const size = statSync(file).size;
        if (size > MAX_FILE_BYTES) continue;
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (isProseSentinelLine(line)) phrases.add(line);
      }
    }
  }

  // Deterministic ordering: most distinctive (longest) first, then lexical;
  // cap so a huge corpus stays fast. Longest lines are the least likely to be
  // a coincidental substring of legitimate app code.
  const ranked = [...phrases]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .slice(0, MAX_DERIVED_SENTINELS);

  const derived = ranked.map((phrase, i) => ({
    id: `derived-sentinel-${String(i).padStart(4, '0')}`,
    description: 'server-only prompt/persona source line (structural sentinel)',
    phrase,
  }));

  // Curated floor first (stable ids), then derived; dedupe by phrase.
  const seen = new Set();
  const merged = [];
  for (const s of [...CURATED_SENTINELS, ...derived]) {
    if (seen.has(s.phrase)) continue;
    seen.add(s.phrase);
    merged.push(s);
  }
  return Object.freeze(merged);
}

// Computed once at module load: the active sentinel set. Tests can pass an
// explicit `sentinels` array to `scanText` / `scanDir` for isolation.
export const PROMPT_SENTINELS = derivePromptSentinels();

// ---------------------------------------------------------------------------
// Pure scanning helpers
// ---------------------------------------------------------------------------

/**
 * Mask a matched secret so the report never echoes it. Keeps the first 3 and
 * last 2 chars for forensic correlation; redacts the middle.
 * @param {string} value
 * @returns {string}
 */
export function maskValue(value) {
  if (typeof value !== 'string' || value.length === 0) return '<empty>';
  if (value.length <= 8) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 3)}…${'*'.repeat(6)}…${value.slice(-2)}`;
}

/**
 * Base64url-decode a JWT payload segment and return its `role`/claim if the
 * decoded JSON names a NON-public role. Length-bounded + try/catch wrapped so
 * a malformed/huge segment can never throw or OOM.
 * @param {string} payloadSeg the `eyJ…` payload segment
 * @returns {string | null} the offending role, or null when public/undecodable
 */
export function decodeJwtServiceRole(payloadSeg) {
  if (typeof payloadSeg !== 'string') return null;
  // Cap the encoded length so the decode buffer stays bounded.
  if (payloadSeg.length > MAX_JWT_PAYLOAD_DECODE_BYTES) return null;
  let json;
  try {
    const buf = Buffer.from(payloadSeg, 'base64url');
    if (buf.length > MAX_JWT_PAYLOAD_DECODE_BYTES) return null;
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const role = typeof json.role === 'string' ? json.role : null;
  if (!role) return null;
  if (PUBLIC_JWT_ROLES.includes(role)) return null;
  return role;
}

/**
 * Find a non-public service-role JWT in text by base64url-decoding the payload
 * of every 3-segment JWT shape. Returns the matched JWT (for masking) + the
 * decoded role, or null. ReDoS-safe (bounded segments).
 * @param {string} text
 * @returns {{ match: string, role: string } | null}
 */
export function findServiceRoleJwt(text) {
  JWT_SHAPE.lastIndex = 0;
  let m;
  let guard = 0;
  while ((m = JWT_SHAPE.exec(text)) !== null) {
    if (guard++ > 5000) break; // pathological-input guard
    const role = decodeJwtServiceRole(m[1]);
    if (role) return { match: m[0], role };
  }
  return null;
}

/**
 * Pull long base64-looking string literals out of text and decode them
 * (length-bounded) so a base64-WRAPPED secret can be rescanned. Returns a NEW
 * array of decoded strings (deduped, capped).
 * @param {string} text
 * @returns {ReadonlyArray<string>}
 */
export function extractBase64Decodes(text) {
  // Standard base64 blobs of meaningful length (>= 40 chars). Bounded upper
  // length avoids quadratic blow-up on minified bundles.
  const re = /[A-Za-z0-9+/]{40,8192}={0,2}/g;
  const out = [];
  const seen = new Set();
  let m;
  let guard = 0;
  while ((m = re.exec(text)) !== null) {
    if (guard++ > 2000) break;
    const blob = m[0];
    if (seen.has(blob)) continue;
    seen.add(blob);
    // Length must be a base64 multiple-ish; let decoder be lenient but bound.
    let decoded;
    try {
      const buf = Buffer.from(blob, 'base64');
      if (buf.length === 0 || buf.length > MAX_B64_DECODE_BYTES) continue;
      decoded = buf.toString('utf8');
    } catch {
      continue;
    }
    // Only keep decodes that look like printable text (else it was real
    // binary/minified data, not a wrapped secret) — cheap heuristic.
    const printable = (decoded.match(/[\x20-\x7e]/g) || []).length;
    if (decoded.length === 0 || printable / decoded.length < 0.85) continue;
    out.push(decoded);
    if (out.length >= 64) break;
  }
  return out;
}

/**
 * Run the SECRET_RULES (+ decoded JWT role check) over a text blob. Returns a
 * NEW findings array. `origin` annotates whether this was the raw file or a
 * base64-decoded sub-blob (so the report is honest about where it matched).
 * @param {string} text
 * @param {string} relPath
 * @param {string} origin  'file' | 'base64-decoded'
 * @returns {ReadonlyArray<object>}
 */
function scanSecretRules(text, relPath, origin) {
  const findings = [];

  for (const rule of SECRET_RULES) {
    const m = rule.pattern.exec(text);
    if (!m) continue;
    findings.push({
      kind: 'secret',
      rule: rule.id,
      description:
        origin === 'base64-decoded' ? `${rule.description} (base64-wrapped)` : rule.description,
      file: relPath,
      sample: maskValue(m[0]),
    });
  }

  const svc = findServiceRoleJwt(text);
  if (svc) {
    findings.push({
      kind: 'secret',
      rule: 'jwt-service-role-claim',
      description:
        origin === 'base64-decoded'
          ? `JWT whose decoded payload claims a non-public role "${svc.role}" (base64-wrapped)`
          : `JWT whose decoded payload claims a non-public role "${svc.role}"`,
      file: relPath,
      sample: maskValue(svc.match),
    });
  }

  return findings;
}

/**
 * Scan one file's text content against every secret rule + prompt sentinel,
 * including a base64-decode-then-rescan pass. Returns a NEW array of findings
 * (empty = clean). Does not read the FS.
 *
 * @param {string} text     file contents
 * @param {string} relPath  path to report (relative to the scanned root)
 * @param {ReadonlyArray<{ id: string, description: string, phrase: string }>} [sentinels]
 * @returns {ReadonlyArray<{ rule: string, kind: string, file: string, description: string, sample: string }>}
 */
export function scanText(text, relPath, sentinels = PROMPT_SENTINELS) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const findings = [];

  // 1. Raw secret rules + decoded service-role JWT.
  for (const f of scanSecretRules(text, relPath, 'file')) findings.push(f);

  // 2. Base64-wrapped secret rescan (bounded). Only if we did not already
  //    flag a raw secret in this file (avoid double-reporting the same leak).
  if (findings.length === 0) {
    for (const decoded of extractBase64Decodes(text)) {
      for (const f of scanSecretRules(decoded, relPath, 'base64-decoded')) findings.push(f);
      if (findings.length > 0) break;
    }
  }

  // 3. Prompt-IP sentinels (structural + curated).
  for (const sentinel of sentinels) {
    if (text.includes(sentinel.phrase)) {
      findings.push({
        kind: 'prompt-ip',
        rule: sentinel.id,
        description: sentinel.description,
        file: relPath,
        // The phrase itself is the proprietary leak, so mask it too.
        sample: maskValue(sentinel.phrase),
      });
    }
  }

  return findings;
}

/**
 * Recursively collect every file path under `dir`.
 * @param {string} dir
 * @returns {ReadonlyArray<string>} absolute file paths
 */
export function collectFiles(dir) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Best-effort UTF-8 read. Returns the decoded string, or null when the file
 * looks binary (NUL byte present) or cannot be read. We do NOT use an
 * extension allow-list — every emitted file is treated as candidate text.
 * @param {string} file
 * @returns {string | null}
 */
function readTextBestEffort(file) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return null;
  }
  // A NUL byte is the strongest "this is binary" signal. Skip such files.
  if (buf.includes(0)) return null;
  // Decode as UTF-8; invalid sequences become U+FFFD, which is fine for
  // substring/regex scanning (we never echo raw bytes).
  return buf.toString('utf8');
}

/**
 * Scan a built client dir. Returns a report object (never throws on findings;
 * throws only on truly unexpected FS errors).
 *
 * @param {string} root  the client static dir to scan
 * @param {{ sentinels?: ReadonlyArray<object> }} [opts]
 * @returns {{
 *   root: string,
 *   scannedFiles: number,
 *   passed: boolean,
 *   findings: ReadonlyArray<object>,
 *   forbiddenFiles: ReadonlyArray<string>,
 *   sentinelCount: number,
 * }}
 */
export function scanDir(root, opts = {}) {
  const sentinels = opts.sentinels ?? PROMPT_SENTINELS;
  const files = collectFiles(root);
  const findings = [];
  const forbiddenFiles = [];
  let scannedFiles = 0;

  for (const file of files) {
    const rel = relative(root, file);
    const ext = extname(file).toLowerCase();

    // Forbidden-by-presence (source-maps) — matched on extension regardless
    // of whether the file decodes as text.
    if (FORBIDDEN_EXTENSIONS.includes(ext)) {
      forbiddenFiles.push(rel);
      findings.push({
        kind: 'source-map',
        rule: 'forbidden-extension',
        description: `source-map / forbidden artifact shipped (${ext})`,
        file: rel,
        sample: ext,
      });
    }

    // Known-binary extensions never carry inlined secrets — skip the read.
    if (BINARY_EXTENSIONS.includes(ext)) continue;

    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) continue;

    const text = readTextBestEffort(file);
    if (text === null) continue; // binary / unreadable — skip
    scannedFiles += 1;
    for (const f of scanText(text, rel, sentinels)) findings.push(f);
  }

  return {
    root,
    scannedFiles,
    passed: findings.length === 0,
    findings: Object.freeze(findings),
    forbiddenFiles: Object.freeze(forbiddenFiles),
    sentinelCount: sentinels.length,
  };
}

/**
 * True when `dir` exists, is a directory, and contains at least one file
 * (recursively). An empty `.next/static` means the build was skipped or
 * produced no client output — a loud failure, not a silent pass.
 * @param {string} dir
 * @returns {boolean}
 */
export function dirHasFiles(dir) {
  if (!existsSync(dir)) return false;
  let st;
  try {
    st = statSync(dir);
  } catch {
    return false;
  }
  if (!st.isDirectory()) return false;
  return collectFiles(dir).length > 0;
}

/**
 * Top-level runner: resolves the target dir, scans, and returns the report
 * plus an exit code. Pure w.r.t. process (no exit / log) so tests can assert.
 *
 * @param {{ dir: string, sentinels?: ReadonlyArray<object> }} opts
 * @returns {{ report: object | null, exitCode: 0 | 1 | 2, missing: boolean, empty: boolean }}
 */
export function runScan(opts) {
  const dir = opts.dir;
  if (!existsSync(dir)) {
    return { report: null, exitCode: 2, missing: true, empty: false };
  }
  if (!dirHasFiles(dir)) {
    // Dir exists but is empty (or not a directory) — explicit loud FAIL.
    return { report: null, exitCode: 2, missing: false, empty: true };
  }
  const report = scanDir(dir, { sentinels: opts.sentinels });
  return { report, exitCode: report.passed ? 0 : 1, missing: false, empty: false };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function resolveTargetDir(argv) {
  const positional = argv.find((a) => !a.startsWith('--'));
  return positional ?? process.env.CLIENT_BUNDLE_DIR ?? 'apps/owner-web/.next/static';
}

function printHuman(result, dir) {
  if (result.missing) {
    console.error(
      `[client-bundle-scan] target dir not found: ${dir}\n` +
        '  The build step did not run, or the path is wrong. ' +
        'Build the app first (next build) or pass the correct dir.',
    );
    return;
  }
  if (result.empty) {
    console.error(
      `[client-bundle-scan] target dir is EMPTY: ${dir}\n` +
        '  The build produced no client output (or the dir is not a directory). ' +
        'A buildless scan is not a pass — failing loudly. Rebuild the app and re-run.',
    );
    return;
  }
  const { report } = result;
  if (report.passed) {
    console.log(
      `[client-bundle-scan] CLEAN — ${String(report.scannedFiles)} file(s) scanned in ${dir} ` +
        `against ${String(report.sentinelCount)} prompt-IP sentinel(s); ` +
        'no secrets, prompt-IP, or source-maps found.',
    );
    return;
  }
  console.error(
    `[client-bundle-scan] LEAK DETECTED in ${dir} — ${String(report.findings.length)} finding(s):`,
  );
  for (const f of report.findings) {
    console.error(
      `  ✗ [${f.kind}/${f.rule}] ${f.file}\n` +
        `      ${f.description}\n` +
        `      matched (masked): ${f.sample}`,
    );
  }
  console.error(
    '\n[client-bundle-scan] FAILED. The web client must ship ZERO secrets, ' +
      'system-prompts, or source-maps. Remove the leaked value from the client ' +
      'path (move it server-side / into the BFF) and rebuild.',
  );
}

function isMainModule() {
  // ESM has no `require.main`; compare the resolved entry path against this
  // module's path. `fileURLToPath` + `resolve` handle spaces and symlinks
  // robustly (the repo path contains spaces).
  if (typeof process.argv[1] !== 'string') return false;
  return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
}

if (isMainModule()) {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const dir = resolveTargetDir(argv);
  const result = runScan({ dir });
  if (asJson) {
    console.log(
      JSON.stringify(
        result.missing
          ? { dir, missing: true, passed: false }
          : result.empty
            ? { dir, empty: true, passed: false }
            : { dir, ...result.report },
        null,
        2,
      ),
    );
  } else {
    printHuman(result, dir);
  }
  process.exit(result.exitCode);
}
