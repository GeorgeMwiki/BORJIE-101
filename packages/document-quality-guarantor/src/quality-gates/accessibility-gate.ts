/**
 * accessibilityGate — checks for the structural primitives PDF/UA
 * requires: `/MarkInfo << /Marked true >>` and `/StructTreeRoot` in
 * the document catalog. This is a *cheap* heuristic, not a full PAC
 * 2024 / Matterhorn validation; deeper accessibility validation
 * happens inside @borjie/document-ai/accessibility (P46 territory)
 * — this gate is the orchestrator's "ship/no-ship" verdict for the
 * tagged-PDF requirement.
 *
 * For non-PDF formats (HTML, DOCX, etc.) the caller wires a different
 * accessibility gate; this gate is PDF-specific.
 */

import type { QualityReport } from '../types.js';
import type { AccessibilityGateInput, Gate } from './types.js';

const MARK_INFO_RE = /\/MarkInfo\s*<<[^>]*\/Marked\s+true/i;
const STRUCT_TREE_RE = /\/StructTreeRoot\s+\d+\s+\d+\s+R/;

export function accessibilityGate(): Gate<AccessibilityGateInput> {
  return {
    id: 'accessibilityGate',
    async evaluate({ pdfBytes }): Promise<QualityReport> {
      const ascii = new TextDecoder('latin1').decode(pdfBytes);
      const hasMarkInfo = MARK_INFO_RE.test(ascii);
      const hasStructTree = STRUCT_TREE_RE.test(ascii);
      const passed = hasMarkInfo && hasStructTree;
      // Each requirement contributes 0.5 to the score.
      const value = (hasMarkInfo ? 0.5 : 0) + (hasStructTree ? 0.5 : 0);
      const reasons: string[] = [];
      if (!hasMarkInfo) reasons.push('missing /MarkInfo << /Marked true >> in document catalog');
      if (!hasStructTree) reasons.push('missing /StructTreeRoot reference (untagged PDF)');
      if (passed) reasons.push('PDF/UA structural primitives present');
      return {
        gateId: 'accessibilityGate',
        score: { value, threshold: 1, passed },
        reasons,
        details: { hasMarkInfo, hasStructTree },
      };
    },
  };
}
