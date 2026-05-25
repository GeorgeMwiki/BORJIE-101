/**
 * Layer 3 — `/ultrareview` (Opus 4.7 xhigh).
 *
 * Fires ONLY when the diff touches a CODEOWNER-only glob, because Opus xhigh
 * is the most expensive option ($5/$25 per Mtok). This layer is silent on
 * benign diffs.
 */

import { anyGlobMatches } from '../pre-tool-use-hooks/glob-matcher.js';
import { classifyFindings } from './layer-1-inline-subagent.js';
import {
  type ICodeReviewer,
  type ReviewFinding,
  type ReviewInput,
  type ReviewVerdict,
} from './types.js';

export interface UltrareviewArgs {
  readonly codeownerGlobs: readonly string[];
  readonly opusXhighCall: (input: ReviewInput) => Promise<readonly ReviewFinding[]>;
}

export class UltrareviewReviewer implements ICodeReviewer {
  public readonly name = 'ultrareview';
  private readonly args: UltrareviewArgs;

  public constructor(args: UltrareviewArgs) {
    this.args = args;
  }

  public touchesCodeownerGlob(modifiedFiles: readonly string[]): boolean {
    return modifiedFiles.some(
      (f) => anyGlobMatches(this.args.codeownerGlobs, f).matched,
    );
  }

  public async review(input: ReviewInput): Promise<ReviewVerdict> {
    if (!this.touchesCodeownerGlob(input.modifiedFiles)) {
      // Silent pass — no Opus spend on benign diffs.
      return Object.freeze<ReviewVerdict>({
        status: 'pass',
        findings: Object.freeze([]),
        layer: 'ultrareview',
      });
    }
    const findings = await this.args.opusXhighCall(input);
    return Object.freeze<ReviewVerdict>({
      status: classifyFindings(findings),
      findings: Object.freeze([...findings]),
      layer: 'ultrareview',
    });
  }
}
