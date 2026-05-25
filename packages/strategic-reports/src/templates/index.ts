export { buildTypstSource } from './typst-strategic.js';
export { buildCarboneBinding, type CarboneBinding, type CarboneContext } from './carbone-strategic.js';
export { buildHtmlSource } from './html-strategic.js';

import type { ReportFormat, StrategicReport } from '../types.js';
import { buildTypstSource } from './typst-strategic.js';
import { buildCarboneBinding } from './carbone-strategic.js';
import { buildHtmlSource } from './html-strategic.js';

/**
 * Adapter producing a template-binding shape the document-studio
 * renderer accepts for the chosen format. Returns either a Typst
 * source string, a Carbone binding object, or an HTML source string.
 *
 * The actual binary render (PDF / DOCX / PPTX-like via HTML→PDF) is
 * the document-studio's job; this module only shapes the inputs.
 */
export function bindTemplate(format: ReportFormat, report: StrategicReport):
  | { kind: 'typst'; source: string; templateRef: string }
  | { kind: 'carbone'; binding: ReturnType<typeof buildCarboneBinding>; templateRef: string }
  | { kind: 'html'; source: string; templateRef: string } {
  switch (format) {
    case 'pdf':
      return { kind: 'typst', source: buildTypstSource(report), templateRef: 'strategic-report/typst' };
    case 'docx':
      return { kind: 'carbone', binding: buildCarboneBinding(report), templateRef: 'strategic-report/carbone' };
    case 'html':
      return { kind: 'html', source: buildHtmlSource(report), templateRef: 'strategic-report/html' };
    case 'pptx':
      // PPTX-like delivery is HTML→PDF in landscape, one section per slide.
      return { kind: 'html', source: buildHtmlSource(report), templateRef: 'strategic-report/html-pptx' };
  }
}
