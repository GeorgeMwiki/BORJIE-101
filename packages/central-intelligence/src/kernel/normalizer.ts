/**
 * Normalizer — coerce sensor output into the kernel's expected shape.
 *
 * LITFIN-parity surface (`.planning/parity-litfin/04-sensors-routing.md`
 * section 5). The normaliser is the buffer between an LLM's wandering
 * prose and the kernel's typed contract. Five jobs:
 *
 *   1. Strip preamble — "Sure, here's the answer:" / "I'd be happy to"
 *      and similar throat-clearing. Multi-pass so nested layers
 *      ("Sure! Here's the answer: …") collapse in one call.
 *
 *   2. Strip trailing pleasantry — "Hope this helps!", "Let me know if
 *      anything else…" — they bloat tokens without adding signal.
 *
 *   3. Repair JSON — smart-quote replacement, trailing-comma fix,
 *      fenced + bare-object extraction (so an LLM that wraps a JSON
 *      object in a sentence of prose doesn't make us regenerate).
 *
 *   4. Extract ui_block — sensors may emit a structured object inside
 *      ```ui_block``` fences for rendering. Pull it out and return
 *      it separately so the kernel can route it to the UI sink.
 *
 *   5. Mutation telemetry — every operation appends a string to
 *      `mutations[]` so provenance can replay what was changed
 *      without comparing strings.
 *
 * Pure functions; deterministic; no IO.
 */

// Each preamble regex must terminate at a colon — never a period —
// so the stripper cannot consume past the preamble into the actual
// answer.
const PREAMBLE_PATTERNS: ReadonlyArray<RegExp> = [
  /^(sure|certainly|absolutely|of course)[!.,]?\s+/i,
  /^here(?:'s| is) (?:the |your )?[^:\n.]{0,40}:\s*/i,
  /^i(?:'d| would) be (?:happy|glad) to[^:\n.]{0,40}:\s*/i,
  /^i can (?:help|assist)(?: you)?(?: with)?[^:\n.]{0,40}:\s*/i,
  /^let me [^:\n.]{0,40}:\s*/i,
  /^great question[!.,]?\s*/i,
  /^(no problem|happy to help)[!.,]?\s+/i,
];

// Trailing pleasantries — the LLM equivalent of corporate sign-offs.
// Each pattern is anchored at end-of-string and consumes only the
// trailing sentence, never punctuation in the middle of the answer.
const TRAILING_PLEASANTRY_PATTERNS: ReadonlyArray<RegExp> = [
  /\s*(?:i\s+)?hope (?:this|that) helps[!.]?\s*$/i,
  /\s*let me know if (?:you (?:have )?)?(?:any|anything)[^.!?\n]{0,80}[.!?]?\s*$/i,
  /\s*(?:please )?(?:feel free to|don'?t hesitate to) (?:ask|reach out)[^.!?\n]{0,80}[.!?]?\s*$/i,
  /\s*if (?:you )?(?:have|need) (?:any )?(?:more|further) questions[^.!?\n]{0,80}[.!?]?\s*$/i,
];

// Smart-quote → ASCII map. Used inside JSON repair only — bare text is
// left as-is so we don't strip stylistic punctuation from prose answers.
const SMART_QUOTE_TRANSLATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
];

export interface NormaliserOutput {
  readonly text: string;
  readonly uiBlock: unknown | null;
  readonly mutations: ReadonlyArray<string>;
}

export function normalize(raw: string): NormaliserOutput {
  const mutations: string[] = [];

  if (typeof raw !== 'string' || raw.length === 0) {
    return { text: '', uiBlock: null, mutations: ['empty-input'] };
  }

  let text = raw;

  // 1. Preamble strip — sweep until idempotent.
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const re of PREAMBLE_PATTERNS) {
      if (re.test(text)) {
        text = text.replace(re, '');
        if (!mutations.includes('preamble-stripped')) {
          mutations.push('preamble-stripped');
        }
        stripped = true;
        break;
      }
    }
  }

  // 2. Trailing pleasantry strip — one pass per pattern is enough; the
  // patterns are anchored at $ so a single match consumes the whole tail.
  for (const re of TRAILING_PLEASANTRY_PATTERNS) {
    if (re.test(text)) {
      text = text.replace(re, '');
      if (!mutations.includes('trailing-pleasantry-stripped')) {
        mutations.push('trailing-pleasantry-stripped');
      }
    }
  }

  // 3. UI block extraction — try canonical ```ui_block ... ``` fence
  // first, then bare-JSON ``ui_block`` fallback variants.
  const ui = extractUiBlock(text);
  if (ui.found) {
    text = ui.remainder;
    mutations.push('ui_block-extracted');
  }

  // 4. JSON fence repair — for any ```json``` blocks left in the text.
  text = repairFences(text, mutations);

  return {
    text: text.trim(),
    uiBlock: ui.value,
    mutations,
  };
}

// ─────────────────────────────────────────────────────────────────────
// UI block extraction — 3-pass like LITFIN
// ─────────────────────────────────────────────────────────────────────

function extractUiBlock(text: string): {
  found: boolean;
  value: unknown | null;
  remainder: string;
} {
  // Pass 1 — canonical ```ui_block\n…\n``` fence.
  const fenceRe = /```ui_block\s*\n([\s\S]*?)\n```/i;
  const m = text.match(fenceRe);
  if (m) {
    const parsed = tryParseJsonLoose(m[1]);
    return {
      found: true,
      value: parsed ?? { raw: m[1] },
      remainder: text.replace(fenceRe, '').trim(),
    };
  }

  // Pass 2 — XML-style <ui_block>…</ui_block> tag.
  const tagRe = /<ui_block>\s*([\s\S]*?)\s*<\/ui_block>/i;
  const tag = text.match(tagRe);
  if (tag) {
    const parsed = tryParseJsonLoose(tag[1]);
    return {
      found: true,
      value: parsed ?? { raw: tag[1] },
      remainder: text.replace(tagRe, '').trim(),
    };
  }

  return { found: false, value: null, remainder: text };
}

// ─────────────────────────────────────────────────────────────────────
// JSON fence repair
// ─────────────────────────────────────────────────────────────────────

function repairFences(text: string, mutations: string[]): string {
  const jsonFenceRe = /```json\s*\n([\s\S]*?)\n```/g;
  return text.replace(jsonFenceRe, (_full, body: string) => {
    const parsedDirect = tryParseJson(body);
    if (parsedDirect !== undefined) {
      mutations.push('json-fence-validated');
      return '```json\n' + JSON.stringify(parsedDirect, null, 2) + '\n```';
    }

    const repaired = repairJsonString(body);
    const parsedRepaired = tryParseJson(repaired.text);
    if (parsedRepaired !== undefined) {
      mutations.push('json-fence-repaired');
      for (const m of repaired.mutations) {
        if (!mutations.includes(m)) mutations.push(m);
      }
      return '```json\n' + JSON.stringify(parsedRepaired, null, 2) + '\n```';
    }

    // Last-ditch — strip leading prose ("Here's the data: { ... }").
    const extracted = extractFirstJsonSubstring(body);
    if (extracted) {
      const parsedExtracted = tryParseJson(extracted);
      if (parsedExtracted !== undefined) {
        mutations.push('json-fence-extracted-from-prose');
        return '```json\n' + JSON.stringify(parsedExtracted, null, 2) + '\n```';
      }
    }

    mutations.push('json-fence-unrepairable');
    return '```\n' + body + '\n```';
  });
}

interface RepairedString {
  readonly text: string;
  readonly mutations: ReadonlyArray<string>;
}

/**
 * Bag of safe textual repairs for JSON strings: smart-quote → ASCII,
 * trailing-comma removal. Idempotent within a single call.
 */
function repairJsonString(input: string): RepairedString {
  const mutations: string[] = [];
  let out = input;

  for (const [re, replacement] of SMART_QUOTE_TRANSLATIONS) {
    if (re.test(out)) {
      out = out.replace(re, replacement);
      if (!mutations.includes('smart-quote-translated')) {
        mutations.push('smart-quote-translated');
      }
    }
  }

  const trailingComma = /,(\s*[}\]])/g;
  if (trailingComma.test(out)) {
    out = out.replace(trailingComma, '$1');
    mutations.push('trailing-comma-removed');
  }

  return { text: out, mutations };
}

/**
 * Find the first balanced JSON object / array substring inside a blob
 * of prose. Returns the substring or null if no balanced match exists.
 * Used as a last-chance rescue when the LLM produced JSON wrapped in
 * a sentence ("Here's the data: { … }").
 */
function extractFirstJsonSubstring(text: string): string | null {
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  const candidates: Array<{ start: number; open: string; close: string }> = [];
  if (startObj !== -1) candidates.push({ start: startObj, open: '{', close: '}' });
  if (startArr !== -1) candidates.push({ start: startArr, open: '[', close: ']' });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.start - b.start);
  const { start, open, close } = candidates[0];
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function tryParseJson(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Looser parse that runs the JSON repair pass before parse — used by
 * ui_block extraction where we'd rather get a structured value than
 * fall back to `{ raw }`.
 */
function tryParseJsonLoose(s: string): unknown | undefined {
  const direct = tryParseJson(s);
  if (direct !== undefined) return direct;
  const repaired = repairJsonString(s);
  return tryParseJson(repaired.text);
}
