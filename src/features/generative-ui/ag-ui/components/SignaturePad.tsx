"use client";

/**
 * 22. signature-pad — canvas-based signature capture.
 *
 * No-dep pointer-event-based capture. On submit, exports the canvas
 * to a PNG dataURL and dispatches the configured onSubmitAction
 * (tool / navigate) via a DOM CustomEvent `genui:signature-submit`
 * carrying `{ dataUrl, action }`. Host app wires the actual tool call.
 *
 * Anti-pattern guards:
 *   - LLM emits onSubmitAction descriptor, NOT a click handler
 *   - safeParse before render
 */

import { useCallback, useRef, useState } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { SignaturePadPartSchema } from "../schemas";

export type SignaturePadProps = AgUiUiPartByKind<"signature-pad">;

const WIDTH = 360;
const HEIGHT = 140;

export function SignaturePad(props: SignaturePadProps): JSX.Element {
  const parsed = SignaturePadPartSchema.safeParse(props);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasContent, setHasContent] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const ctxFor = useCallback((): CanvasRenderingContext2D | null => {
    const c = ref.current;
    if (!c) return null;
    return c.getContext("2d");
  }, []);

  if (!parsed.success) {
    return (
      <GenUiError
        kind="signature-pad"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxFor();
    if (!ctx || !ref.current) return;
    drawing.current = true;
    const rect = ref.current.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ctxFor();
    if (!ctx || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
    setHasContent(true);
  };
  const end = () => {
    drawing.current = false;
  };
  const clear = () => {
    const ctx = ctxFor();
    if (ctx && ref.current) {
      ctx.clearRect(0, 0, ref.current.width, ref.current.height);
      setHasContent(false);
      setSubmitted(false);
    }
  };
  const submit = () => {
    if (!ref.current) return;
    const dataUrl = ref.current.toDataURL("image/png");
    setSubmitted(true);
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent("genui:signature-submit", {
            detail: { dataUrl, action: props.onSubmitAction },
          }),
        );
      } catch {
        // ignore
      }
    }
  };

  return (
    <Frame
      kind="signature-pad"
      {...(props.title ? { title: props.title } : {})}
    >
      <p className="mb-2 text-sm text-foreground">{props.prompt}</p>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Required for: {props.requiredFor}
      </p>
      <canvas
        ref={ref}
        width={WIDTH}
        height={HEIGHT}
        className="block rounded border border-border bg-surface touch-none"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        data-genui-signature-pad
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={clear}
          className="rounded border border-border bg-surface px-2 py-1 text-xs"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!hasContent || submitted}
          className="rounded border border-blue-500 bg-blue-500 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {submitted ? "Submitted" : "Submit signature"}
        </button>
      </div>
    </Frame>
  );
}
