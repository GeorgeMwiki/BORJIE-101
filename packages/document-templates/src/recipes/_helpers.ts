/**
 * Shared helpers for recipe modules. Keeps each recipe file focused
 * on its section structure rather than on plumbing.
 *
 * Notably: artifact assembly, citation gating, audit-chain linking, and
 * the brand-locked render dispatch all flow through this module.
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  DocComposeContext,
  DocumentArtifact,
  DocumentFormat,
  DocumentRecipe,
  IRDoc,
  SpanCitation,
} from '../types.js';
import { CompositionError } from '../types.js';
import { brandPdf } from '../brand-lock/pdf-brander.js';
import { brandDocx } from '../brand-lock/docx-brander.js';
import { brandXlsx } from '../brand-lock/xlsx-brander.js';
import { brandPptx } from '../brand-lock/pptx-brander.js';
import { enforceCitationGate } from '../citations/embedder.js';
import { buildDocAuditLink } from '../citations/audit-chain-link.js';
import { initialApprovalState } from '../approval/workflow.js';

export interface BuildArtifactArgs {
  readonly recipe: Pick<
    DocumentRecipe,
    'id' | 'version' | 'class' | 'authority_tier' | 'approval_required'
  >;
  readonly ctx: DocComposeContext;
  readonly irDoc: IRDoc;
  readonly format: DocumentFormat;
}

/**
 * Apply the full Layer 3 pipeline: citation gate → brand-locked
 * render → audit-chain link → final artifact assembly.
 */
export function buildArtifactFromIRDoc(args: BuildArtifactArgs): DocumentArtifact {
  enforceCitationGate(args.irDoc);

  const { bytes, checksum, bodyString } = renderForFormat(args.irDoc, args.format);

  const link = buildDocAuditLink({
    tenant_id: args.ctx.tenant_id,
    recipe: args.recipe,
    checksum,
    span_citations: args.irDoc.citations,
    generated_at: args.irDoc.generated_at,
    format: args.format,
  });

  const id = randomUUID();
  const storageBucket = args.ctx.storage_bucket ?? `borjie-docs-${args.recipe.class}`;
  const storage_key = `${storageBucket}/${id}.${formatExtension(args.format)}`;

  const approval_state = args.recipe.approval_required
    ? 'pending'
    : initialApprovalState(args.recipe.authority_tier);

  return {
    id,
    recipe_id: args.recipe.id,
    recipe_version: args.recipe.version,
    format: args.format,
    storage_key,
    checksum,
    span_citations: args.irDoc.citations,
    audit_hash: link.audit_hash,
    approval_state,
    body: bodyString ?? bytes,
    generated_at: args.irDoc.generated_at,
  };
}

interface RenderResult {
  readonly bytes: Buffer;
  readonly checksum: string;
  readonly bodyString?: string;
}

function renderForFormat(doc: IRDoc, format: DocumentFormat): RenderResult {
  switch (format) {
    case 'pdf': {
      const r = brandPdf(doc);
      return { bytes: r.bytes, checksum: r.checksum };
    }
    case 'docx': {
      const r = brandDocx(doc);
      return { bytes: r.bytes, checksum: r.checksum };
    }
    case 'xlsx': {
      const r = brandXlsx(doc);
      return { bytes: r.bytes, checksum: r.checksum };
    }
    case 'pptx': {
      const r = brandPptx(doc);
      return { bytes: r.bytes, checksum: r.checksum };
    }
    case 'md': {
      const md = renderIRDocToMarkdown(doc);
      const buf = Buffer.from(md, 'utf-8');
      const checksum = sha256Hex(buf);
      return { bytes: buf, checksum, bodyString: md };
    }
    case 'html': {
      // Defer to the PDF brander's HTML path to reuse the brand-lint
      // gate. We expose the html via bodyString and stash the bytes for
      // checksum stability.
      const r = brandPdf(doc);
      const buf = Buffer.from(r.html, 'utf-8');
      const checksum = sha256Hex(buf);
      return { bytes: buf, checksum, bodyString: r.html };
    }
    default:
      throw new CompositionError(
        'UNSUPPORTED_FORMAT',
        `format ${format} not supported by brand-lock pipeline`,
        [format],
      );
  }
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function renderIRDocToMarkdown(doc: IRDoc): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  if (doc.subtitle !== undefined && doc.subtitle.length > 0) {
    lines.push(`> ${doc.subtitle}`);
  }
  lines.push('');
  lines.push(`_Generated ${doc.generated_at}_`);
  if (doc.watermark === 'draft') {
    lines.push('');
    lines.push('**[DRAFT]**');
  }
  lines.push('');
  for (const section of doc.sections) {
    lines.push(`## ${section.title}`);
    lines.push('');
    for (const block of section.blocks) {
      if (block.kind === 'heading' && block.text !== undefined) {
        const level = block.level ?? 3;
        lines.push(`${'#'.repeat(level)} ${block.text}`);
        lines.push('');
      } else if (block.kind === 'paragraph' && block.text !== undefined) {
        const suffix =
          block.citationId !== undefined && block.citationId.length > 0
            ? ` [${block.citationId}]`
            : '';
        lines.push(`${block.text}${suffix}`);
        lines.push('');
      } else if (block.kind === 'kpi_grid' && block.kpis !== undefined) {
        for (const k of block.kpis) {
          const suffix =
            k.citationId !== undefined && k.citationId.length > 0
              ? ` [${k.citationId}]`
              : '';
          lines.push(`- **${k.label}**: ${k.value}${suffix}`);
        }
        lines.push('');
      } else if (block.kind === 'table' && block.headers !== undefined) {
        lines.push(`| ${block.headers.join(' | ')} |`);
        lines.push(`| ${block.headers.map(() => '---').join(' | ')} |`);
        for (const row of block.rows ?? []) {
          lines.push(`| ${row.join(' | ')} |`);
        }
        lines.push('');
      } else if (block.kind === 'chart_placeholder' && block.text !== undefined) {
        lines.push(`> _Chart: ${block.text}_`);
        lines.push('');
      } else if (block.kind === 'signature_block' && block.text !== undefined) {
        lines.push('---');
        lines.push(block.text);
        lines.push('');
      }
    }
  }
  if (doc.citations.length > 0) {
    lines.push('## References');
    lines.push('');
    for (const c of doc.citations) {
      lines.push(`- **[${c.id}]** ${c.claim} — ${c.source.kind}:${c.source.ref}`);
    }
  }
  return lines.join('\n');
}

function formatExtension(format: DocumentFormat): string {
  switch (format) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'pptx':
      return 'pptx';
    case 'xlsx':
      return 'xlsx';
    case 'md':
      return 'md';
    case 'html':
      return 'html';
  }
}

/**
 * Convenience: pin the artifact's `generated_at` from context or `now()`.
 */
export function pinGeneratedAt(ctx: DocComposeContext): string {
  return ctx.generated_at ?? new Date().toISOString();
}

/**
 * Convenience: pull a typed value out of `ctx.available_data` by key.
 */
export function readData<T = unknown>(
  ctx: DocComposeContext,
  key: string,
): T | undefined {
  const found = ctx.available_data.find((d) => d.key === key);
  if (found === undefined) return undefined;
  return found.value as T;
}

/**
 * Convenience: assert all required citation keys are present in
 * ctx.citations. Refuses with CITATION_GAP if any are missing.
 */
export function assertCitations(
  ctx: DocComposeContext,
  keys: ReadonlyArray<string>,
): ReadonlyArray<SpanCitation> {
  const have = new Map(ctx.citations.map((c) => [c.id, c] as const));
  const missing = keys.filter((k) => !have.has(k));
  if (missing.length > 0) {
    throw new CompositionError(
      'CITATION_GAP',
      `recipe requires ${missing.length} additional citation(s)`,
      missing,
    );
  }
  return ctx.citations;
}
