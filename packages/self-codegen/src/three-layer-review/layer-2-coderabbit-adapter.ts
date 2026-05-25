/**
 * Layer 2 — CodeRabbit-class diff reviewer.
 *
 * We expose `ICodeReviewer` as the seam. Production wires CodeRabbit (or
 * Greptile, or Diamond) via a small HTTP adapter. Tests use a mock so we
 * never hard-depend on the SaaS during CI.
 */

import {
  classifyFindings,
} from './layer-1-inline-subagent.js';
import {
  type ICodeReviewer,
  type ReviewFinding,
  type ReviewInput,
  type ReviewVerdict,
} from './types.js';

export type DiffReviewerCall = (input: ReviewInput) => Promise<readonly ReviewFinding[]>;

export class CodeRabbitClassReviewer implements ICodeReviewer {
  public readonly name = 'coderabbit-class';
  private readonly call: DiffReviewerCall;

  public constructor(call: DiffReviewerCall) {
    this.call = call;
  }

  public async review(input: ReviewInput): Promise<ReviewVerdict> {
    const findings = await this.call(input);
    return Object.freeze<ReviewVerdict>({
      status: classifyFindings(findings),
      findings: Object.freeze([...findings]),
      layer: 'coderabbit-class',
    });
  }
}

/**
 * Default mock adapter — for tests + local dev. Returns no findings.
 */
export class MockDiffReviewer implements ICodeReviewer {
  public readonly name = 'mock-diff-reviewer';

  public async review(_input: ReviewInput): Promise<ReviewVerdict> {
    return Object.freeze<ReviewVerdict>({
      status: 'pass',
      findings: Object.freeze([]),
      layer: 'coderabbit-class',
    });
  }
}
