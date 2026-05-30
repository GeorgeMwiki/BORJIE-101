/**
 * File Preview Builder — converts a Supabase storage file reference
 * into a markdown-embedded preview spec.
 *
 * Strategy:
 *   - For images (image/*): inline `![alt](signed-url)`.
 *   - For PDFs (application/pdf): inline a link (`[name](signed-url)`)
 *     with a "Open in viewer" hint; the chat side renders the
 *     markdown and the host shell decides whether to inline a PDF
 *     viewer or surface a button.
 *   - For everything else: a plain link.
 *
 * Output is always a `MarkdownSpec` (registry kind `markdown`) so
 * existing renderers handle it. The markdown is short and contains
 * no raw HTML; the registry's renderer sanitises it.
 *
 * @module features/central-command/md/presenter/file-preview
 */

import { buildMarkdown } from "@/core/brain/generative-ui/builders";
import type { MarkdownSpec } from "@/core/brain/generative-ui/types";
import type { InlineDataFetchResult } from "./types";
import { tierToBadge } from "./spec-builder";

interface FilePreviewInput {
  readonly file: NonNullable<InlineDataFetchResult["file"]>;
  readonly titleHint?: string;
  readonly tier: InlineDataFetchResult["tier"];
  readonly generatedAt: string;
}

function escapeMarkdown(text: string): string {
  // Bracket / paren / pipe are the markdown link-syntax meta-chars.
  return text.replace(/[\[\]\(\)\|`]/g, (m) => `\\${m}`);
}

export function buildFilePreviewSpec(input: FilePreviewInput): MarkdownSpec {
  const safeName = escapeMarkdown(input.file.displayName);
  const url = input.file.signedUrl ?? "";
  const lines: string[] = [];
  const title = input.titleHint ?? `Document: ${input.file.displayName}`;
  lines.push(`**${escapeMarkdown(title)}**`);
  lines.push("");

  if (input.file.mimeType.startsWith("image/")) {
    if (url) {
      lines.push(`![${safeName}](${url})`);
    } else {
      lines.push(`Image: ${safeName} (signed URL pending).`);
    }
  } else if (input.file.mimeType === "application/pdf") {
    if (url) {
      lines.push(`PDF: [${safeName}](${url})`);
      lines.push("");
      lines.push("Open in viewer to read the full document.");
    } else {
      lines.push(`PDF: ${safeName} (signed URL pending).`);
    }
  } else {
    if (url) {
      lines.push(`File: [${safeName}](${url})`);
    } else {
      lines.push(`File: ${safeName} (signed URL pending).`);
    }
  }

  return buildMarkdown({
    markdown: lines.join("\n"),
    title,
    ariaLabel: `Inline preview of ${input.file.displayName}`,
    source: {
      generatedAt: input.generatedAt,
      tier: tierToBadge(input.tier),
    },
  });
}
