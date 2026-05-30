"use client";

/**
 * Drop-in chat-message renderer. Splits an assistant message into text +
 * generative-ui spec segments, then renders each. Plain text is passed
 * through react-markdown via the MarkdownSpec renderer so links + lists
 * still work.
 *
 * Usage in any chat surface:
 *
 *   import { GenerativeUiMessage } from "@/features/generative-ui/GenerativeUiMessage";
 *   <GenerativeUiMessage content={message.content} />
 */

import { Fragment } from "react";
import { parseGenerativeUiSegments } from "@/core/brain/generative-ui/stream-protocol";
import { renderSpec } from "@/core/brain/generative-ui/registry";

interface Props {
  content: string;
}

export function GenerativeUiMessage({ content }: Props) {
  const segments = parseGenerativeUiSegments(content);
  return (
    <div className="space-y-2">
      {segments.map((segment, idx) => {
        if (segment.kind === "text" && segment.text) {
          return (
            <p
              key={`seg-${idx}`}
              className="whitespace-pre-wrap text-sm text-slate-800"
            >
              {segment.text}
            </p>
          );
        }
        if (segment.kind === "spec" && segment.spec) {
          return (
            <Fragment key={`seg-${idx}`}>{renderSpec(segment.spec)}</Fragment>
          );
        }
        if (segment.kind === "spec" && segment.rawInvalid) {
          return (
            <div
              key={`seg-${idx}`}
              role="alert"
              className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800"
            >
              Generative UI block rejected: invalid spec.
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
