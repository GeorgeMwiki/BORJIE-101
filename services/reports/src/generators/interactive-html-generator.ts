/**
 * Interactive HTML Report Generator (NEW 17)
 *
 * Assembles a self-contained HTML bundle with embedded media (photos,
 * videos, charts via <img>/<video>/data-canvas) and clickable action
 * plans that POST to the interactive reports API. Falls back to a
 * print-stylesheet when the browser is asked to print (→ PDF).
 *
 * Implements the existing IReportGenerator interface for symmetry with
 * PdfGenerator / ExcelGenerator / CsvGenerator. Additional interactive
 * inputs are accepted via extended options.
 */

import type {
  IReportGenerator,
  ReportData,
  ReportGeneratorOptions,
} from './generator.interface.js';
import { ReportGeneratorError } from './generator.interface.js';
import type {
  ActionPlan,
  MediaReference,
} from '../interactive/types.js';

export interface InteractiveHtmlGeneratorOptions extends ReportGeneratorOptions {
  readonly media?: readonly MediaReference[];
  readonly actionPlans?: readonly ActionPlan[];
  /** Absolute base for action-plan POSTs, e.g. "/v1/reports/{id}/action-plans". */
  readonly actionPlanPostPath?: string;
  /** Interactive report version id (included in POST body). */
  readonly interactiveReportVersionId?: string;
  /** If true, injects print-to-PDF fallback CSS. */
  readonly includePrintFallback?: boolean;
}

const HTML_ESCAPE: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

function renderMedia(media: MediaReference): string {
  const caption = media.caption ? escapeHtml(media.caption) : '';
  switch (media.kind) {
    case 'image':
      return [
        `<figure class="media media-image" data-media-id="${escapeHtml(media.id)}">`,
        `  <img src="${escapeHtml(media.signedUrl)}" alt="${caption}" loading="lazy" />`,
        caption ? `  <figcaption>${caption}</figcaption>` : '',
        `</figure>`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'video': {
      // Follow-up KI-015 (#33): swap bare <video> for a skinned player (videojs /
      //   Plyr) with analytics hooks once the shared media player package
      //   lands. See Docs/KNOWN_ISSUES.md#ki-015.
      const poster = media.posterKey
        ? ` poster="${escapeHtml(media.posterKey)}"`
        : '';
      const mime = media.mimeType
        ? ` type="${escapeHtml(media.mimeType)}"`
        : '';
      return [
        `<figure class="media media-video" data-media-id="${escapeHtml(media.id)}">`,
        `  <video controls preload="metadata"${poster}>`,
        `    <source src="${escapeHtml(media.signedUrl)}"${mime} />`,
        `    Your browser does not support embedded video.`,
        `  </video>`,
        caption ? `  <figcaption>${caption}</figcaption>` : '',
        `</figure>`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'chart':
      // Charts are rendered client-side; the generator embeds a stub
      // canvas referencing a data URL key.
      return [
        `<figure class="media media-chart" data-media-id="${escapeHtml(media.id)}" data-chart-key="${escapeHtml(media.storageKey)}">`,
        `  <canvas data-src="${escapeHtml(media.signedUrl)}"></canvas>`,
        caption ? `  <figcaption>${caption}</figcaption>` : '',
        `</figure>`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'audio':
      return [
        `<figure class="media media-audio" data-media-id="${escapeHtml(media.id)}">`,
        `  <audio controls src="${escapeHtml(media.signedUrl)}"></audio>`,
        caption ? `  <figcaption>${caption}</figcaption>` : '',
        `</figure>`,
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return '';
  }
}

function renderActionPlan(
  plan: ActionPlan,
  postPath: string | undefined,
  versionId: string | undefined
): string {
  const endpoint =
    postPath && versionId
      ? postPath.replace('{id}', encodeURIComponent(versionId)) +
        `/${encodeURIComponent(plan.id)}/ack`
      : '';
  const severity = escapeHtml(plan.severity ?? 'info');
  const disabled = plan.status !== 'pending' ? 'disabled' : '';
  const buttonLabel =
    plan.status === 'pending' ? 'Acknowledge & route' : `Status: ${escapeHtml(plan.status)}`;

  return [
    `<section class="action-plan action-plan--${severity}" data-action-id="${escapeHtml(plan.id)}" data-kind="${escapeHtml(plan.action.kind)}">`,
    `  <header>`,
    `    <h3>${escapeHtml(plan.title)}</h3>`,
    `    <span class="severity">${severity}</span>`,
    `  </header>`,
    `  <p>${escapeHtml(plan.description)}</p>`,
    `  <button`,
    `    class="action-plan__cta"`,
    `    data-endpoint="${escapeHtml(endpoint)}"`,
    `    data-action-kind="${escapeHtml(plan.action.kind)}"`,
    `    ${disabled}`,
    `  >${buttonLabel}</button>`,
    `</section>`,
  ].join('\n');
}

function renderSections(data: ReportData): string {
  return data.sections
    .map((section) => {
      const parts: string[] = [
        `<section class="report-section">`,
        `  <h2>${escapeHtml(section.title)}</h2>`,
      ];
      if (section.content) {
        parts.push(`  <p>${escapeHtml(section.content)}</p>`);
      }
      if (section.table) {
        parts.push('  <table class="report-table">');
        parts.push('    <thead><tr>');
        for (const header of section.table.headers) {
          parts.push(`      <th>${escapeHtml(String(header))}</th>`);
        }
        parts.push('    </tr></thead>');
        parts.push('    <tbody>');
        for (const row of section.table.rows) {
          parts.push('      <tr>');
          for (const cell of row) {
            parts.push(`        <td>${escapeHtml(String(cell))}</td>`);
          }
          parts.push('      </tr>');
        }
        parts.push('    </tbody>');
        parts.push('  </table>');
      }
      parts.push(`</section>`);
      return parts.join('\n');
    })
    .join('\n');
}

const BASE_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; color: #1a202c; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  h2 { font-size: 20px; margin: 24px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  h3 { font-size: 16px; margin: 0 0 6px; }
  .report-meta { color: #718096; font-size: 12px; margin-bottom: 24px; }
  .report-table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  .report-table th, .report-table td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
  .report-table th { background: #f7fafc; }
  .media { margin: 16px 0; }
  .media img, .media video, .media canvas { max-width: 100%; border-radius: 6px; }
  .media figcaption { font-size: 12px; color: #4a5568; margin-top: 4px; }
  .action-plan { border: 1px solid #cbd5e0; border-radius: 8px; padding: 12px 16px; margin: 12px 0; background: #fdfdfd; }
  .action-plan header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .action-plan .severity { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #718096; }
  .action-plan--high, .action-plan--critical { border-color: #e53e3e; }
  .action-plan--medium { border-color: #dd6b20; }
  .action-plan__cta { background: #2b6cb0; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  .action-plan__cta[disabled] { background: #a0aec0; cursor: not-allowed; }
`;

const PRINT_STYLES = `
  @media print {
    .action-plan__cta { display: none; }
    body { padding: 0; }
    .action-plan { page-break-inside: avoid; }
    .media { page-break-inside: avoid; }
  }
`;

const ACK_SCRIPT = `
  document.addEventListener('click', async function(ev) {
    var target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('action-plan__cta')) return;
    var endpoint = target.getAttribute('data-endpoint');
    var kind = target.getAttribute('data-action-kind');
    if (!endpoint) return;
    target.setAttribute('disabled', 'disabled');
    try {
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ actionKind: kind })
      });
      if (!res.ok) throw new Error('ack_failed');
      target.textContent = 'Routed';
    } catch (e) {
      target.removeAttribute('disabled');
      target.textContent = 'Retry';
    }
  });
`;

export class InteractiveHtmlGenerator implements IReportGenerator {
  async generate(
    options: InteractiveHtmlGeneratorOptions | ReportGeneratorOptions,
    data: ReportData
  ): Promise<string> {
    try {
      const opts = options as InteractiveHtmlGeneratorOptions;
      const generatedAt = opts.generatedAt ?? new Date();
      const mediaSection =
        opts.media && opts.media.length > 0
          ? `<section class="report-section"><h2>Media</h2>${opts.media
              .map(renderMedia)
              .join('\n')}</section>`
          : '';
      const actionSection =
        opts.actionPlans && opts.actionPlans.length > 0
          ? `<section class="report-section"><h2>Action plans</h2>${opts.actionPlans
              .map((p) =>
                renderActionPlan(
                  p,
                  opts.actionPlanPostPath,
                  opts.interactiveReportVersionId
                )
              )
              .join('\n')}</section>`
          : '';

      const styles =
        BASE_STYLES + (opts.includePrintFallback !== false ? PRINT_STYLES : '');

      const subtitle = opts.subtitle
        ? `<p class="report-subtitle">${escapeHtml(opts.subtitle)}</p>`
        : '';

      return [
        `<!DOCTYPE html>`,
        `<html lang="en">`,
        `<head>`,
        `<meta charset="utf-8" />`,
        `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
        `<title>${escapeHtml(opts.title)}</title>`,
        `<style>${styles}</style>`,
        `</head>`,
        `<body>`,
        `<header class="report-header">`,
        `  <h1>${escapeHtml(opts.title)}</h1>`,
        subtitle,
        `  <div class="report-meta">Generated: ${escapeHtml(
          generatedAt.toISOString().slice(0, 19).replace('T', ' ')
        )}</div>`,
        `</header>`,
        renderSections(data),
        mediaSection,
        actionSection,
        data.summary && Object.keys(data.summary).length > 0
          ? `<section class="report-section"><h2>Summary</h2><ul>${Object.entries(
              data.summary
            )
              .map(
                ([k, v]) =>
                  `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(
                    String(v)
                  )}</li>`
              )
              .join('')}</ul></section>`
          : '',
        `<script>${ACK_SCRIPT}</script>`,
        `</body>`,
        `</html>`,
      ].join('\n');
    } catch (err) {
      throw new ReportGeneratorError(
        err instanceof Error ? err.message : String(err),
        'interactive_html',
        err
      );
    }
  }
}
