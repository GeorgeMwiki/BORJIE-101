"use client";

/**
 * Schema-driven form for `form` specs.
 *
 * Implementation note: we deliberately use a controlled React form rather
 * than depending on react-hook-form at module-load time. This keeps tsc
 * silent before the package is installed. When react-hook-form ships, the
 * builders + spec shape remain unchanged — only the internals of this
 * component swap to RHF + zodResolver.
 */

import { useState, type FormEvent } from "react";
import type { FormSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";

interface Props {
  spec: FormSpec;
  /** Optional override — defaults to POSTing to /api/brain/tool/<tool>. */
  onSubmit?: (
    tool: string,
    params: Record<string, unknown>,
  ) => Promise<void> | void;
  onCancel?: () => void;
}

type FieldValue = string | number | boolean | string[];

export default function FormSchemaDriven({ spec, onSubmit, onCancel }: Props) {
  const ariaLabel = spec.ariaLabel ?? spec.title ?? "Form";
  const initial: Record<string, FieldValue> = {};
  spec.fields.forEach((f) => {
    if (f.default !== undefined) initial[f.name] = f.default;
    else if (f.kind === "checkbox") initial[f.name] = false;
    else if (f.kind === "multiselect") initial[f.name] = [];
    else if (f.kind === "number" || f.kind === "currency") initial[f.name] = "";
    else initial[f.name] = "";
  });

  const [values, setValues] = useState<Record<string, FieldValue>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function update(name: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    spec.fields.forEach((field) => {
      const v = values[field.name];
      if (
        field.required &&
        (v === "" ||
          v === undefined ||
          v === null ||
          (Array.isArray(v) && v.length === 0))
      ) {
        next[field.name] = `${field.label} is required.`;
        return;
      }
      if (
        field.kind === "email" &&
        typeof v === "string" &&
        v &&
        !/^\S+@\S+\.\S+$/.test(v)
      ) {
        next[field.name] = "Invalid email.";
      }
      if (field.kind === "url" && typeof v === "string" && v) {
        try {
          new URL(v);
        } catch {
          next[field.name] = "Invalid URL.";
        }
      }
      if (
        (field.kind === "number" || field.kind === "currency") &&
        v !== "" &&
        typeof v === "string" &&
        Number.isNaN(Number(v))
      ) {
        next[field.name] = "Must be a number.";
      }
      if (field.pattern && typeof v === "string" && v) {
        try {
          if (!new RegExp(field.pattern).test(v)) {
            next[field.name] = `${field.label} format is invalid.`;
          }
        } catch {
          // Bad regex from the model — skip rather than crash.
        }
      }
    });
    return next;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const params: Record<string, unknown> = {
      ...(spec.submitAction.params ?? {}),
    };
    spec.fields.forEach((f) => {
      const v = values[f.name];
      if (f.kind === "number" || f.kind === "currency") {
        params[f.name] = v === "" ? null : Number(v);
      } else {
        params[f.name] = v;
      }
    });

    setSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit(spec.submitAction.tool, params);
      } else {
        await defaultSubmit(spec.submitAction.tool, params);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      aria-label={ariaLabel}
      onSubmit={handleSubmit}
      className="my-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      {spec.title ? (
        <h3 className="mb-1 text-sm font-medium text-slate-800">
          {spec.title}
        </h3>
      ) : null}
      {spec.description ? (
        <p className="mb-3 text-xs text-slate-600">{spec.description}</p>
      ) : null}
      {spec.requiresFourEye ? (
        <div
          role="note"
          className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          This action requires four-eye approval. A second signer must
          countersign before the change is executed.
        </div>
      ) : null}
      <div className="space-y-3">
        {spec.fields.map((field) => (
          <FieldRow
            key={field.name}
            field={field}
            value={values[field.name]}
            error={errors[field.name]}
            onChange={(v) => update(field.name, v)}
          />
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? "Submitting…" : (spec.submitLabel ?? "Submit")}
        </button>
        {spec.cancelable !== false ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            {spec.cancelLabel ?? "Cancel"}
          </button>
        ) : null}
      </div>
      <SourceTrail {...(spec.source ?? {})} />
    </form>
  );
}

async function defaultSubmit(
  tool: string,
  params: Record<string, unknown>,
): Promise<void> {
  await fetch(`/api/brain/tool/${encodeURIComponent(tool)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  }).catch(() => {
    // Surfacing the error to chat is the consumer's responsibility.
  });
}

interface FieldRowProps {
  field: FormSpec["fields"][number];
  value: FieldValue;
  error?: string;
  onChange: (v: FieldValue) => void;
}

function FieldRow({ field, value, error, onChange }: FieldRowProps) {
  const inputId = `gui-field-${field.name}`;
  const ariaDescribed = error ? `${inputId}-err` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-xs font-medium text-slate-700">
        {field.label}
        {field.required ? <span aria-hidden> *</span> : null}
      </label>
      {renderInput(field, inputId, value, onChange, ariaDescribed)}
      {field.helpText ? (
        <span className="text-xs text-slate-500">{field.helpText}</span>
      ) : null}
      {error ? (
        <span
          id={`${inputId}-err`}
          role="alert"
          className="text-xs text-red-700"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

function renderInput(
  field: FormSpec["fields"][number],
  id: string,
  value: FieldValue,
  onChange: (v: FieldValue) => void,
  ariaDescribed?: string,
) {
  const baseClass =
    "w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none";
  switch (field.kind) {
    case "textarea":
      return (
        <textarea
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          aria-describedby={ariaDescribed}
          className={baseClass}
          rows={4}
        />
      );
    case "select":
      return (
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          aria-describedby={ariaDescribed}
          className={baseClass}
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "multiselect":
      return (
        <select
          id={id}
          multiple
          value={Array.isArray(value) ? value : []}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions).map(
              (o) => o.value,
            );
            onChange(selected);
          }}
          required={field.required}
          aria-describedby={ariaDescribed}
          className={baseClass}
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "checkbox":
      return (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={ariaDescribed}
        />
      );
    case "radio":
      return (
        <div role="radiogroup" className="flex flex-col gap-1">
          {field.options?.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1">
              <input
                type="radio"
                name={field.name}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
                aria-describedby={ariaDescribed}
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      );
    case "date":
      return (
        <input
          id={id}
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          aria-describedby={ariaDescribed}
          className={baseClass}
        />
      );
    case "number":
    case "currency":
      return (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          min={field.min}
          max={field.max}
          aria-describedby={ariaDescribed}
          className={baseClass}
        />
      );
    case "email":
      return (
        <input
          id={id}
          type="email"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          aria-describedby={ariaDescribed}
          className={baseClass}
        />
      );
    case "url":
      return (
        <input
          id={id}
          type="url"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          aria-describedby={ariaDescribed}
          className={baseClass}
        />
      );
    case "text":
    default:
      return (
        <input
          id={id}
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          aria-describedby={ariaDescribed}
          className={baseClass}
        />
      );
  }
}
