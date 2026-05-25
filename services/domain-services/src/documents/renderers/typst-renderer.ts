/**
 * Typst Renderer
 *
 * Produces a PDF from a `.typ` source. If the `typst` CLI is available on
 * `PATH` (or `TYPST_BIN` env var), we shell out via a tempfile and capture
 * the compiled PDF buffer. Otherwise we degrade to the same zero-dep PDF
 * encoder used by ReactPdfRenderer so the renderer remains callable in
 * environments where Typst is not installed.
 *
 * Installation: `brew install typst` / `cargo install typst-cli`.
 * Env var: `TYPST_BIN` — absolute path to the typst executable.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  IDocumentRenderer,
  RenderResult,
  RenderTemplate,
  RenderedMimeType,
} from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';

export class TypstRenderer implements IDocumentRenderer {
  readonly kind = 'typst' as const;
  readonly supportedMimeTypes: readonly RenderedMimeType[] = ['application/pdf'];

  async render<TInput = Record<string, unknown>>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    const body = this.templateBodyAsString(template);
    const interpolated = interpolate(body, inputs as unknown as Readonly<Record<string, unknown>>);

    const typstBin = process.env.TYPST_BIN?.trim() || 'typst';
    try {
      const buffer = await compileWithTypst(typstBin, interpolated);
      return {
        buffer,
        mimeType: 'application/pdf',
        meta: { engine: 'typst', templateId: template.id },
      };
    } catch (err) {
      // Typst not installed or compile failed — degrade to zero-dep PDF.
      const buffer = buildSimplePdf(interpolated);
      return {
        buffer,
        mimeType: 'application/pdf',
        pageCount: 1,
        meta: {
          engine: 'builtin-fallback',
          templateId: template.id,
          reason: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private templateBodyAsString<TInput>(template: RenderTemplate<TInput>): string {
    if (typeof template.source === 'string') return template.source;
    if (Buffer.isBuffer(template.source)) return template.source.toString('utf-8');
    throw new RendererError(
      'INVALID_TEMPLATE',
      `TypstRenderer expects string or Buffer source; got ${typeof template.source}`
    );
  }
}

function interpolate(body: string, inputs: Readonly<Record<string, unknown>>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const val = key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, inputs);
    return val == null ? `{{${key}}}` : String(val);
  });
}

async function compileWithTypst(bin: string, source: string): Promise<Buffer> {
  const workdir = await mkdtemp(join(tmpdir(), 'typst-render-'));
  const inPath = join(workdir, 'document.typ');
  const outPath = join(workdir, 'document.pdf');
  try {
    // inPath/outPath are derived from mkdtemp() + a fixed filename — fully
    // controlled by this module. Not a user-supplied path.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from mkdtemp()
    await writeFile(inPath, source, 'utf-8');
    await runProcess(bin, ['compile', inPath, outPath], 30_000);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from mkdtemp()
    return await readFile(outPath);
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

function runProcess(cmd: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr: string[] = [];
    const stdout: string[] = [];
    child.stdout?.on('data', (b: Buffer) => stdout.push(b.toString('utf-8')));
    child.stderr?.on('data', (b: Buffer) => stderr.push(b.toString('utf-8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`typst timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(
        new Error(
          `typst exited with ${code}: ${stderr.join('').trim() || stdout.join('').trim()}`
        )
      );
    });
  });
}

// Zero-dep A4 PDF fallback — matches the shape used by ReactPdfRenderer
// and PdfRealRenderer. Single page, Helvetica 11pt, 72pt margins.
function buildSimplePdf(text: string): Buffer {
  const lines = wrapLines(text, 90);
  const lineHeight = 14;
  const startY = 770;
  const marginX = 72;

  let contentStream = 'BT\n/F1 11 Tf\n';
  contentStream += `${marginX} ${startY} Td\n`;
  lines.forEach((line, idx) => {
    if (idx > 0) contentStream += `0 -${lineHeight} Td\n`;
    contentStream += `(${escapePdfString(line)}) Tj\n`;
  });
  contentStream += 'ET';

  const contentBuffer = Buffer.from(contentStream, 'latin1');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contentBuffer.length} >>\nstream\n${contentStream}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, idx) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  offsets.forEach((off) => {
    body += `${off.toString().padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

function wrapLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length <= maxChars) {
      out.push(rawLine);
      continue;
    }
    const words = rawLine.split(/\s+/);
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).trim().length > maxChars) {
        if (current) out.push(current);
        current = w;
      } else {
        current = (current ? current + ' ' : '') + w;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
