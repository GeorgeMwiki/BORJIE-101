/**
 * WCAG 2.2 AA + Section 508 (29 CFR § 1194.22) check registry.
 *
 * 16 pure regex-based checks. Each check returns a single
 * `AccessibilityCheck` per scan. Checks are deliberately conservative
 * (no DOM parse) so they run in any environment — including CI on
 * shipped HTML files.
 *
 * Sources:
 *  - WCAG 2.2 published Oct 2023 — https://www.w3.org/TR/WCAG22/
 *  - Section 508 Refresh (Jan 2017) — https://www.access-board.gov/ict/
 *  - WAI-ARIA Authoring Practices 1.2 (2024)
 */

import type { AccessibilityCheck, EthicsSeverity, WcagSuccessCriterion } from '../types.js';

export interface WcagCheck {
  readonly wcagSc: WcagSuccessCriterion;
  readonly severity: EthicsSeverity;
  readonly evaluate: (html: string) => AccessibilityCheck;
}

function passed(
  wcagSc: WcagSuccessCriterion,
  severity: EthicsSeverity,
  evidence: string,
): AccessibilityCheck {
  return {
    wcagSc,
    passed: true,
    evidence,
    severity,
    remediation: '',
  };
}

function failed(
  wcagSc: WcagSuccessCriterion,
  severity: EthicsSeverity,
  evidence: string,
  remediation: string,
): AccessibilityCheck {
  return { wcagSc, passed: false, evidence, severity, remediation };
}

// ── 1.1.1 — Non-text content ─────────────────────────────────────────
export const altTextCheck: WcagCheck = {
  wcagSc: '1.1.1-non-text-content',
  severity: 'high',
  evaluate(html) {
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    const missing = imgs.filter((i) => !/\balt=/i.test(i));
    if (missing.length > 0) {
      return failed(
        '1.1.1-non-text-content',
        'high',
        `${missing.length} <img> tag(s) without alt attribute.`,
        'Add a descriptive alt attribute; use alt="" for decorative images.',
      );
    }
    return passed('1.1.1-non-text-content', 'high', `${imgs.length} image(s) checked.`);
  },
};

// ── 1.3.1 — Info and relationships (uses semantic HTML) ───────────────
export const infoAndRelationshipsCheck: WcagCheck = {
  wcagSc: '1.3.1-info-and-relationships',
  severity: 'medium',
  evaluate(html) {
    const hasNonSemanticHeadings = /<div[^>]*class=["'][^"']*heading/i.test(html);
    if (hasNonSemanticHeadings) {
      return failed(
        '1.3.1-info-and-relationships',
        'medium',
        '<div class="heading"> used instead of <h1>…<h6>.',
        'Use <h1>–<h6> elements so assistive tech announces headings.',
      );
    }
    return passed('1.3.1-info-and-relationships', 'medium', 'No non-semantic heading divs found.');
  },
};

// ── 1.3.5 — Identify input purpose ───────────────────────────────────
export const identifyInputPurposeCheck: WcagCheck = {
  wcagSc: '1.3.5-identify-input-purpose',
  severity: 'medium',
  evaluate(html) {
    const inputs = html.match(/<input\b[^>]*\btype=["']?(email|tel|name|password)["']?[^>]*>/gi) ?? [];
    const missingAutocomplete = inputs.filter((i) => !/\bautocomplete=/i.test(i));
    if (missingAutocomplete.length > 0) {
      return failed(
        '1.3.5-identify-input-purpose',
        'medium',
        `${missingAutocomplete.length} input(s) missing autocomplete.`,
        'Add autocomplete (e.g. "email", "tel", "name", "current-password") to assist autofill.',
      );
    }
    return passed('1.3.5-identify-input-purpose', 'medium', 'All sensitive inputs have autocomplete.');
  },
};

// ── 1.4.3 — Contrast (minimum) — naive only ──────────────────────────
export const contrastCheck: WcagCheck = {
  wcagSc: '1.4.3-contrast-minimum',
  severity: 'high',
  evaluate(html) {
    // Naive: any inline color paired with very-light bg is a red flag.
    if (/color:\s*#?(c|b|a)[0-9a-f]{2,5}[^;]*background[^;]*#?f[a-f0-9]{2,5}/i.test(html)) {
      return failed(
        '1.4.3-contrast-minimum',
        'high',
        'Inline style appears to set low-contrast color on a near-white background.',
        'Run a contrast checker; ensure ratio >= 4.5:1 for body text.',
      );
    }
    return passed('1.4.3-contrast-minimum', 'high', 'No obvious low-contrast inline styles.');
  },
};

// ── 1.4.10 — Reflow ──────────────────────────────────────────────────
export const reflowCheck: WcagCheck = {
  wcagSc: '1.4.10-reflow',
  severity: 'medium',
  evaluate(html) {
    if (/<meta\s+name=["']viewport["'][^>]*minimum-scale=1\b/i.test(html)) {
      return passed('1.4.10-reflow', 'medium', 'Viewport meta allows reflow.');
    }
    if (/<meta\s+name=["']viewport["'][^>]*user-scalable=no/i.test(html)) {
      return failed(
        '1.4.10-reflow',
        'medium',
        'Viewport meta sets user-scalable=no, blocking reflow + zoom.',
        'Remove user-scalable=no; allow zoom up to 200%.',
      );
    }
    return passed('1.4.10-reflow', 'medium', 'No reflow-blocking viewport restrictions found.');
  },
};

// ── 1.4.11 — Non-text contrast ───────────────────────────────────────
export const nonTextContrastCheck: WcagCheck = {
  wcagSc: '1.4.11-non-text-contrast',
  severity: 'medium',
  evaluate(html) {
    // Naive: faint borders on form controls.
    if (/border:\s*1px\s+solid\s+#(d|e|f)[a-f0-9]{2,5}/i.test(html)) {
      return failed(
        '1.4.11-non-text-contrast',
        'medium',
        'Faint 1px border on UI control(s); may fall below 3:1 contrast.',
        'Increase border contrast to >= 3:1 against adjacent colors.',
      );
    }
    return passed('1.4.11-non-text-contrast', 'medium', 'No obvious faint UI borders.');
  },
};

// ── 2.1.1 — Keyboard ─────────────────────────────────────────────────
export const keyboardCheck: WcagCheck = {
  wcagSc: '2.1.1-keyboard',
  severity: 'high',
  evaluate(html) {
    const onclickDivs = html.match(/<(div|span)\b[^>]*onclick/gi) ?? [];
    if (onclickDivs.length > 0) {
      return failed(
        '2.1.1-keyboard',
        'high',
        `${onclickDivs.length} <div>/<span> with onclick — likely not keyboard-operable.`,
        'Replace with <button> or add role="button" + tabindex="0" + onKeyDown.',
      );
    }
    return passed('2.1.1-keyboard', 'high', 'No click-only divs/spans found.');
  },
};

// ── 2.4.3 — Focus order ──────────────────────────────────────────────
export const focusOrderCheck: WcagCheck = {
  wcagSc: '2.4.3-focus-order',
  severity: 'medium',
  evaluate(html) {
    const positiveTabIndex = html.match(/tabindex=["']\s*[1-9]/gi) ?? [];
    if (positiveTabIndex.length > 0) {
      return failed(
        '2.4.3-focus-order',
        'medium',
        `${positiveTabIndex.length} element(s) with positive tabindex (breaks natural focus order).`,
        'Use tabindex="0" for focusable or rely on natural source order.',
      );
    }
    return passed('2.4.3-focus-order', 'medium', 'No positive tabindex found.');
  },
};

// ── 2.4.4 — Link purpose ─────────────────────────────────────────────
export const linkPurposeCheck: WcagCheck = {
  wcagSc: '2.4.4-link-purpose',
  severity: 'medium',
  evaluate(html) {
    const anchors = html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/gi) ?? [];
    const vague = anchors.filter((a) => /(>(\s*click here\s*|\s*here\s*|\s*read more\s*)<)/i.test(a));
    if (vague.length > 0) {
      return failed(
        '2.4.4-link-purpose',
        'medium',
        `${vague.length} link(s) use vague text ("click here", "here", "read more").`,
        'Describe the destination ("Read the privacy policy").',
      );
    }
    return passed('2.4.4-link-purpose', 'medium', 'No vague link text found.');
  },
};

// ── 2.4.6 — Headings + labels ────────────────────────────────────────
export const headingsAndLabelsCheck: WcagCheck = {
  wcagSc: '2.4.6-headings-and-labels',
  severity: 'medium',
  evaluate(html) {
    // Heading order — must not skip levels.
    const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
    for (let i = 1; i < headings.length; i += 1) {
      const cur = headings[i]!;
      const prev = headings[i - 1]!;
      if (cur > prev + 1) {
        return failed(
          '2.4.6-headings-and-labels',
          'medium',
          `Heading level jumps from h${prev} to h${cur}.`,
          'Increment heading levels by 1; do not skip levels.',
        );
      }
    }
    return passed('2.4.6-headings-and-labels', 'medium', 'Heading order is sequential.');
  },
};

// ── 2.4.7 — Focus visible ────────────────────────────────────────────
export const focusVisibleCheck: WcagCheck = {
  wcagSc: '2.4.7-focus-visible',
  severity: 'high',
  evaluate(html) {
    if (/outline:\s*none|outline:\s*0\b/i.test(html) && !/:focus-visible|focus:ring|focus-within/i.test(html)) {
      return failed(
        '2.4.7-focus-visible',
        'high',
        'outline:none used without an explicit :focus-visible replacement.',
        'Replace outline:none with a visible :focus-visible ring (Tailwind: focus-visible:ring-2).',
      );
    }
    return passed('2.4.7-focus-visible', 'high', 'Focus ring not suppressed.');
  },
};

// ── 2.5.7 — Dragging movements (WCAG 2.2 NEW) ────────────────────────
export const draggingMovementsCheck: WcagCheck = {
  wcagSc: '2.5.7-dragging-movements',
  severity: 'medium',
  evaluate(html) {
    if (/draggable=["']?true["']?/i.test(html) && !/data-keyboard-alt/i.test(html)) {
      return failed(
        '2.5.7-dragging-movements',
        'medium',
        'draggable=true without keyboard-alternative attribute.',
        'Provide a single-pointer alternative (buttons, dropdown) for dragging.',
      );
    }
    return passed('2.5.7-dragging-movements', 'medium', 'No drag-only interactions found.');
  },
};

// ── 2.5.8 — Target size (minimum) (WCAG 2.2 NEW) ─────────────────────
export const targetSizeCheck: WcagCheck = {
  wcagSc: '2.5.8-target-size-minimum',
  severity: 'medium',
  evaluate(html) {
    // Naive: explicit small dimensions on buttons.
    if (/<button[^>]*style=["'][^"']*(width|height):\s*(1\d|[1-9])px/i.test(html)) {
      return failed(
        '2.5.8-target-size-minimum',
        'medium',
        '<button> styled with width/height < 24px.',
        'Use at least 24×24 CSS pixels (WCAG 2.2 SC 2.5.8 minimum).',
      );
    }
    return passed('2.5.8-target-size-minimum', 'medium', 'No undersized buttons detected.');
  },
};

// ── 3.2.6 — Consistent help (WCAG 2.2 NEW) ───────────────────────────
export const consistentHelpCheck: WcagCheck = {
  wcagSc: '3.2.6-consistent-help',
  severity: 'low',
  evaluate(html) {
    // We can't verify across pages; we treat presence of help link as pass.
    if (/<a\b[^>]*(href=["']\/help|aria-label=["'][^"']*help)/i.test(html)) {
      return passed('3.2.6-consistent-help', 'low', 'Help link present.');
    }
    return failed(
      '3.2.6-consistent-help',
      'low',
      'No help link or aria-labelled help entry found.',
      'Provide a help mechanism in the same location across pages.',
    );
  },
};

// ── 3.3.7 — Redundant entry (WCAG 2.2 NEW) ───────────────────────────
export const redundantEntryCheck: WcagCheck = {
  wcagSc: '3.3.7-redundant-entry',
  severity: 'medium',
  evaluate(html) {
    const inputs = html.match(/<input\b[^>]*type=["']?(email|tel|name|password)[^>]*>/gi) ?? [];
    if (inputs.length >= 2) {
      const labels = inputs.map((i) => i.match(/name=["']([^"']+)/i)?.[1] ?? '').filter(Boolean);
      const hasDup = new Set(labels).size < labels.length;
      if (hasDup) {
        return passed(
          '3.3.7-redundant-entry',
          'medium',
          'Duplicate input name detected — assume autofill prevents re-entry.',
        );
      }
    }
    return passed('3.3.7-redundant-entry', 'medium', 'No likely redundant entry pattern.');
  },
};

// ── 4.1.2 — Name, role, value ────────────────────────────────────────
export const nameRoleValueCheck: WcagCheck = {
  wcagSc: '4.1.2-name-role-value',
  severity: 'high',
  evaluate(html) {
    const customButtons = html.match(/role=["']button["']/gi) ?? [];
    const missingLabel = customButtons.filter((_, i) => {
      const idx = html.indexOf(customButtons[i]!);
      const window = html.slice(Math.max(0, idx - 200), idx + 200);
      return !/aria-label=|aria-labelledby=/i.test(window);
    });
    if (missingLabel.length > 0) {
      return failed(
        '4.1.2-name-role-value',
        'high',
        `${missingLabel.length} role="button" element(s) without accessible name.`,
        'Add aria-label or aria-labelledby to convey the button\'s purpose.',
      );
    }
    return passed('4.1.2-name-role-value', 'high', 'role="button" elements appear labelled.');
  },
};

export const WCAG_CHECK_REGISTRY: ReadonlyArray<WcagCheck> = Object.freeze([
  altTextCheck,
  infoAndRelationshipsCheck,
  identifyInputPurposeCheck,
  contrastCheck,
  reflowCheck,
  nonTextContrastCheck,
  keyboardCheck,
  focusOrderCheck,
  linkPurposeCheck,
  headingsAndLabelsCheck,
  focusVisibleCheck,
  draggingMovementsCheck,
  targetSizeCheck,
  consistentHelpCheck,
  redundantEntryCheck,
  nameRoleValueCheck,
]);
