/**
 * MarkdownStyles — the scoped stylesheet for `renderMarkdown` output.
 *
 * The chat-ui package deliberately ships ZERO external stylesheets (see the
 * `BorjieKeyframes` inline-`<style>` pattern in FloatingAskBorjie): every visual
 * lives in an inline `<style>` block so a host can drop the package in without a
 * CSS build step. `renderMarkdown` emits `borjie-md-*` classes for the
 * expressive-range devices (tables, task-lists, del/mark/kbd, callouts, fenced
 * code); WITHOUT this stylesheet those devices would render unstyled — a device
 * the renderer emits but nothing paints is effectively born-dark. This component
 * mounts once per message-list so the rules exist wherever a bubble does.
 *
 * Colours reuse the widget's slate/blue token palette (#0f172a text, #2563eb
 * accent, #64748b muted, #f1f5f9 surface) so the devices are cohesive with the
 * bubble chrome — not an arbitrary new palette. STRUCTURE only; no user copy
 * lives here, so this file is locale-agnostic.
 */
import type { JSX } from 'react';

const MARKDOWN_CSS = `
.borjie-md-code {
  background: #e2e8f0;
  color: #0f172a;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
}
.borjie-md-pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
  position: relative;
  font-size: 0.85em;
  line-height: 1.5;
}
.borjie-md-pre code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: none;
  color: inherit;
  padding: 0;
  white-space: pre;
}
.borjie-md-pre[data-lang]::before {
  content: attr(data-lang);
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #94a3b8;
}
.borjie-md-mark {
  background: #fef08a;
  color: #0f172a;
  padding: 0 2px;
  border-radius: 3px;
}
.borjie-md-kbd {
  display: inline-block;
  background: #f1f5f9;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 0 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82em;
  line-height: 1.5;
}
.borjie-md-tablewrap {
  overflow-x: auto;
  margin: 8px 0;
}
.borjie-md-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.9em;
}
.borjie-md-table th,
.borjie-md-table td {
  border: 1px solid #e2e8f0;
  padding: 5px 9px;
  text-align: left;
}
.borjie-md-table th {
  background: #f1f5f9;
  font-weight: 600;
  color: #0f172a;
}
.borjie-md-table tr:nth-child(even) td {
  background: #f8fafc;
}
.borjie-md-tasklist {
  list-style: none;
  padding-left: 4px;
  margin: 6px 0;
}
.borjie-md-taskitem {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 2px 0;
}
.borjie-md-task {
  margin-top: 3px;
  accent-color: #2563eb;
}
.borjie-md-quote {
  border-left: 3px solid #cbd5e1;
  margin: 8px 0;
  padding: 2px 12px;
  color: #475569;
}
.borjie-md-quote p {
  margin: 4px 0;
}
.borjie-md-callout {
  border-left: 3px solid #64748b;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 8px 0;
  background: #f8fafc;
}
.borjie-md-callout__title {
  font-weight: 600;
  margin: 0 0 3px;
  text-transform: capitalize;
}
.borjie-md-callout p:last-child {
  margin-bottom: 0;
}
.borjie-md-callout--note {
  border-left-color: #2563eb;
  background: #eff6ff;
}
.borjie-md-callout--note .borjie-md-callout__title { color: #1d4ed8; }
.borjie-md-callout--tip {
  border-left-color: #16a34a;
  background: #f0fdf4;
}
.borjie-md-callout--tip .borjie-md-callout__title { color: #15803d; }
.borjie-md-callout--important {
  border-left-color: #7c3aed;
  background: #f5f3ff;
}
.borjie-md-callout--important .borjie-md-callout__title { color: #6d28d9; }
.borjie-md-callout--warning {
  border-left-color: #d97706;
  background: #fffbeb;
}
.borjie-md-callout--warning .borjie-md-callout__title { color: #b45309; }
.borjie-md-callout--caution {
  border-left-color: #dc2626;
  background: #fef2f2;
}
.borjie-md-callout--caution .borjie-md-callout__title { color: #b91c1c; }
`;

/**
 * Inline `<style>` carrying every `borjie-md-*` rule. Idempotent to mount more
 * than once (duplicate identical rules are a no-op); a single mount per
 * message-list is the intended usage.
 */
export function MarkdownStyles(): JSX.Element {
  return <style suppressHydrationWarning>{MARKDOWN_CSS}</style>;
}
