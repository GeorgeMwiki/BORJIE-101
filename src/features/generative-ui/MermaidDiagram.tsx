"use client";

/**
 * Mermaid diagram renderer. Dynamically imports the `mermaid` package
 * client-side; falls back to a fenced code block if the package is not
 * installed yet.
 *
 * The mermaid library generates SVG; we sanitise the output with
 * DOMPurify before inserting it into the DOM.
 */

import { useEffect, useRef, useState } from "react";
import type { MermaidSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";
import { sanitiseHtml, tryOptionalImport } from "./_shared";

interface Props {
  spec: MermaidSpec;
}

let mermaidInitialised = false;

export default function MermaidDiagram({ spec }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tryOptionalImport<{ default?: unknown } & Record<string, unknown>>(
      "mermaid",
    ).then(async (mod) => {
      if (!mod) return;
      const mermaid = (mod.default ?? mod) as {
        initialize: (cfg: Record<string, unknown>) => void;
        render: (id: string, text: string) => Promise<{ svg: string }>;
      };
      if (!mermaidInitialised) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
        });
        mermaidInitialised = true;
      }
      try {
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, spec.diagram);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = sanitiseHtml(svg);
          setRendered(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Mermaid render failed");
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [spec.diagram]);

  const ariaLabel = spec.ariaLabel ?? spec.title ?? "Diagram";

  return (
    <figure
      role="figure"
      aria-label={ariaLabel}
      className="my-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      {spec.title ? (
        <figcaption className="mb-2 text-sm font-medium text-slate-800">
          {spec.title}
        </figcaption>
      ) : null}
      <div
        ref={containerRef}
        data-testid="mermaid-canvas"
        aria-hidden={!rendered}
      />
      {error ? (
        <div role="alert" className="text-xs text-red-700">
          Diagram render error: {error}
        </div>
      ) : null}
      {!rendered ? (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">Diagram source</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">
            {spec.diagram}
          </pre>
        </details>
      ) : null}
      <SourceTrail {...(spec.source ?? {})} />
    </figure>
  );
}
