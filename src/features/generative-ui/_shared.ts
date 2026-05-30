/**
 * Shared helpers for generative-ui renderers.
 *
 * Centralises:
 *   - Source-trail strip (timestamp + tier badge) shown under every spec.
 *   - DOMPurify wrapper with strict allowlists.
 *   - Currency / date formatting.
 *   - Vite-opaque dynamic import for optional renderer dependencies.
 */

import DOMPurify from "dompurify";

/**
 * Dynamic import that Vite cannot statically analyse. Used to load
 * optional renderer dependencies (react-vega, mermaid, react-leaflet,
 * mapbox-gl) that may not be installed yet. Returns `null` if the import
 * fails for any reason.
 *
 * Centralising this here keeps Vite from emitting "Failed to resolve
 * import" errors at test time when these packages are absent.
 */
export async function tryOptionalImport<T = unknown>(
  spec: string,
): Promise<T | null> {
  try {
    // Use the global `Function` constructor to build a dynamic-import
    // call as a string. Vite's static analysis cannot see through this.
    const dynImport = new Function("s", "return import(s)") as (
      s: string,
    ) => Promise<T>;
    return await dynImport(spec);
  } catch {
    return null;
  }
}

/**
 * Sanitise an HTML string against an extremely strict allowlist. The
 * renderers never inject HTML from a spec, but this is used for the
 * markdown renderer's HTML pass to defend against `dangerouslySetInnerHTML`
 * on Vega-Lite-style HTML labels and the like.
 */
export function sanitiseHtml(input: string): string {
  // Happy-dom (vitest) does not expose a `window` object the way jsdom
  // does, so the DOMPurify factory requires explicit invocation in some
  // environments. We fall back to a strict regex strip if DOMPurify cannot
  // bind to a DOM (e.g. server-render path).
  try {
    if (typeof window !== "undefined") {
      return DOMPurify.sanitize(input, {
        ALLOWED_TAGS: [
          "b",
          "i",
          "em",
          "strong",
          "a",
          "p",
          "ul",
          "ol",
          "li",
          "code",
          "pre",
          "br",
          "h1",
          "h2",
          "h3",
          "h4",
          "blockquote",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
        ],
        ALLOWED_ATTR: ["href", "title", "target", "rel"],
        ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
      });
    }
  } catch {
    // Fall through to regex strip
  }
  return stripDangerousTags(input);
}

function stripDangerousTags(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/on[a-z]+="[^"]*"/gi, "")
    .replace(/on[a-z]+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

export function formatCell(
  value: string | number | boolean | null,
  format?:
    | "text"
    | "number"
    | "currency"
    | "percent"
    | "date"
    | "datetime"
    | "boolean"
    | "code",
): string {
  if (value === null || value === undefined) return "";
  switch (format) {
    case "currency":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          }).format(value)
        : String(value);
    case "percent":
      return typeof value === "number"
        ? `${(value * 100).toFixed(1)}%`
        : String(value);
    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US").format(value)
        : String(value);
    case "date":
    case "datetime": {
      const date =
        typeof value === "string" || typeof value === "number"
          ? new Date(value)
          : null;
      if (!date || Number.isNaN(date.getTime())) return String(value);
      return format === "date"
        ? date.toLocaleDateString()
        : date.toLocaleString();
    }
    case "boolean":
      return value === true || value === "true" ? "Yes" : "No";
    case "code":
      return String(value);
    case "text":
    default:
      return String(value);
  }
}
