"use client";

/**
 * Markdown renderer with a strict safe schema. Uses react-markdown +
 * remark-gfm (already in package.json). Any HTML embedded in the markdown
 * is rejected — react-markdown drops it by default unless the rehype-raw
 * plugin is used, which we deliberately do NOT include.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MarkdownSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";

interface Props {
  spec: MarkdownSpec;
}

export default function MarkdownRender({ spec }: Props) {
  const ariaLabel = spec.ariaLabel ?? spec.title ?? "Markdown content";
  return (
    <section
      aria-label={ariaLabel}
      className="prose prose-sm my-3 max-w-none rounded-lg border border-slate-200 bg-white p-4"
    >
      {spec.title ? (
        <h3 className="mb-2 text-sm font-medium text-slate-800">
          {spec.title}
        </h3>
      ) : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Deliberately omit rehype-raw — no raw HTML pass-through.
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              rel="noopener noreferrer"
              target="_blank"
              className="text-sky-700 underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {spec.markdown}
      </ReactMarkdown>
      <SourceTrail {...(spec.source ?? {})} />
    </section>
  );
}
