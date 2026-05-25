/**
 * Three-layer review types.
 *
 * Pattern #6 from R-CODEGEN:
 *   Layer 1 — inline `code-reviewer` subagent (free, in-process).
 *   Layer 2 — CodeRabbit-class diff reviewer (adapter abstracts SaaS).
 *   Layer 3 — /ultrareview (Opus xhigh) — ONLY on CODEOWNER-only globs.
 *
 * Each layer returns a ReviewVerdict, and the layers compose monotonically:
 *   any block → block; any comments → comments; all pass → pass.
 */

export interface ReviewFinding {
  readonly file: string;
  readonly line?: number;
  readonly severity: 'info' | 'warning' | 'error' | 'critical';
  readonly message: string;
}

export interface ReviewVerdict {
  readonly status: 'pass' | 'comments' | 'block';
  readonly findings: readonly ReviewFinding[];
  readonly layer: 'inline-subagent' | 'coderabbit-class' | 'ultrareview' | 'combined';
}

export interface ReviewInput {
  readonly diff: string;
  readonly modifiedFiles: readonly string[];
  readonly task: { readonly description: string; readonly tenantId?: string };
}

export interface ICodeReviewer {
  readonly name: string;
  review(input: ReviewInput): Promise<ReviewVerdict>;
}
