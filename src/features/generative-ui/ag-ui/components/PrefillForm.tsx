"use client";

/**
 * 5. prefill-form — JSON-Schema-driven form with optional diff popover.
 *
 * Anti-patterns enforced:
 *   - LLM never modifies the schema (schemaJson is server-supplied)
 *   - On submit, POSTs to the api-gateway action URL (NOT the agent),
 *     so writes flow through standard server RBAC.
 *
 * The schemaJson arrives as JSON Schema Draft-7. We use a generic
 * key→input renderer; switching to @tanstack/react-form is a one-line
 * factory change that never reaches the AdaptiveRenderer.
 */

import { useState } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { PrefillFormPartSchema } from "../schemas";

export type PrefillFormProps = AgUiUiPartByKind<"prefill-form">;

interface JsonSchemaProperty {
  readonly type?: string;
  readonly enum?: ReadonlyArray<string | number>;
  readonly description?: string;
  readonly format?: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

function inputTypeFor(p: JsonSchemaProperty): string {
  if (p.format === "email") return "email";
  if (p.format === "date") return "date";
  if (p.format === "date-time") return "datetime-local";
  if (p.type === "number" || p.type === "integer") return "number";
  return "text";
}

export function PrefillForm(props: PrefillFormProps): JSX.Element {
  const parsed = PrefillFormPartSchema.safeParse(props);

  const [values, setValues] = useState<Record<string, unknown>>({
    ...props.values,
  });
  const [submitState, setSubmitState] = useState<
    "idle" | "submitting" | "ok" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  if (!parsed.success) {
    return (
      <GenUiError
        kind="prefill-form"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  const schema = props.schemaJson as {
    properties?: Record<string, JsonSchemaProperty>;
    required?: ReadonlyArray<string>;
  };
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitState("submitting");
    setErrorMessage("");
    try {
      const res = await fetch(props.action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formId: props.formId, values }),
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        setSubmitState("error");
        setErrorMessage(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      setSubmitState("ok");
    } catch (err) {
      setSubmitState("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Frame
      kind="prefill-form"
      {...(props.title
        ? { title: props.title }
        : { title: `Form: ${props.formId}` })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        {Object.entries(properties).map(([key, prop]) => {
          const isRequired = required.has(key);
          const v = values[key];
          if (prop.enum) {
            return (
              <label key={key} className="flex flex-col gap-1 text-xs">
                <span>
                  {key}
                  {isRequired ? " *" : ""}
                </span>
                <select
                  value={String(v ?? "")}
                  onChange={(e) =>
                    setValues({ ...values, [key]: e.target.value })
                  }
                  className="rounded border border-border bg-surface px-2 py-1"
                >
                  <option value="">—</option>
                  {prop.enum.map((opt) => (
                    <option key={String(opt)} value={String(opt)}>
                      {String(opt)}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          const inputType = inputTypeFor(prop);
          const isDiff =
            props.diffMode &&
            JSON.stringify(props.values[key]) !== JSON.stringify(v);
          return (
            <label key={key} className="flex flex-col gap-1 text-xs">
              <span className={isDiff ? "text-amber-600" : ""}>
                {key}
                {isRequired ? " *" : ""}
                {isDiff ? " (modified)" : ""}
              </span>
              <input
                type={inputType}
                value={v === undefined || v === null ? "" : String(v)}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [key]:
                      inputType === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
                className="rounded border border-border bg-surface px-2 py-1"
              />
            </label>
          );
        })}
        <div className="flex items-center gap-2 mt-2">
          <button
            type="submit"
            disabled={submitState === "submitting"}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitState === "submitting" ? "Submitting…" : "Submit"}
          </button>
          {submitState === "ok" ? (
            <span className="text-xs text-green-600">Saved</span>
          ) : null}
          {submitState === "error" ? (
            <span className="text-xs text-destructive">
              Error: {errorMessage}
            </span>
          ) : null}
        </div>
      </form>
    </Frame>
  );
}
