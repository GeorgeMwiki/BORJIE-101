"use client";

/**
 * Confirmation dialog for destructive / sovereign-tier actions.
 *
 * Rendered inline as a card (not a modal portal) so it composes inside the
 * chat scroll, but with `role="alertdialog"` and focus-trap behaviour
 * equivalent to a Radix Dialog. Four-eye approval surface is mandatory
 * for sovereign-tier actions.
 */

import { useEffect, useRef } from "react";
import type { ConfirmDialogSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";

interface Props {
  spec: ConfirmDialogSpec;
  onConfirm?: (
    tool: string,
    params: Record<string, unknown>,
  ) => Promise<void> | void;
  onCancel?: () => void;
}

const SEVERITY_STYLES: Record<
  ConfirmDialogSpec["severity"],
  { box: string; button: string; label: string }
> = {
  info: {
    box: "border-sky-300 bg-sky-50",
    button: "bg-sky-700 hover:bg-sky-800",
    label: "text-sky-900",
  },
  warning: {
    box: "border-amber-300 bg-amber-50",
    button: "bg-amber-700 hover:bg-amber-800",
    label: "text-amber-900",
  },
  destructive: {
    box: "border-red-300 bg-red-50",
    button: "bg-red-700 hover:bg-red-800",
    label: "text-red-900",
  },
};

export default function ConfirmDialog({ spec, onConfirm, onCancel }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const styles = SEVERITY_STYLES[spec.severity];

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  async function handleConfirm() {
    if (onConfirm) {
      await onConfirm(spec.confirmAction.tool, spec.confirmAction.params ?? {});
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="gui-confirm-title"
      aria-describedby="gui-confirm-body"
      className={`my-3 rounded-lg border p-4 ${styles.box}`}
    >
      <h3
        id="gui-confirm-title"
        className={`text-sm font-semibold ${styles.label}`}
      >
        {spec.title}
      </h3>
      <p
        id="gui-confirm-body"
        className="mt-1 text-sm text-slate-700 whitespace-pre-wrap"
      >
        {spec.body}
      </p>
      {spec.requiresFourEye ? (
        <div className="mt-3 rounded border border-amber-400 bg-amber-100 px-3 py-2 text-xs text-amber-900">
          Four-eye approval required. A second signer must countersign.
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          ref={buttonRef}
          type="button"
          onClick={handleConfirm}
          className={`rounded px-3 py-1.5 text-sm font-medium text-white ${styles.button}`}
        >
          {spec.confirmLabel ?? "Confirm"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          {spec.cancelLabel ?? "Cancel"}
        </button>
      </div>
      <SourceTrail {...(spec.source ?? {})} />
    </div>
  );
}
