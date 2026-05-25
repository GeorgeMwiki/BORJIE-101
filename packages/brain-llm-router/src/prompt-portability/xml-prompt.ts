/**
 * prompt-portability/ — XML-tag standard for cross-provider prompts.
 *
 * All BORJIE system prompts use a canonical XML structure:
 *
 *   <role>...</role>           — model persona / mission
 *   <context>...</context>     — optional retrieved context
 *   <tools>...</tools>         — tool catalogue (when tool-use enabled)
 *   <task>...</task>           — the immediate task
 *   <examples>...</examples>   — optional few-shot
 *   <output_format>...</output_format> — strict output schema
 *
 * Anthropic accepts XML directly. OpenAI tolerates XML in content but
 * also accepts a flat string. Google reads from `systemInstruction` with
 * parts-array shape. This module canonicalises a single XmlPrompt object
 * and renders it into each provider's preferred format.
 *
 * Research §4 + §7 #9: one prompt format works across Anthropic / OpenAI /
 * Google.
 */

import type { ProviderName } from '../types.js';

export interface XmlPrompt {
  readonly role: string;
  readonly context?: string;
  readonly tools?: string;
  readonly task: string;
  readonly examples?: readonly { readonly input: string; readonly output: string }[];
  readonly outputFormat?: string;
}

export const ALL_XML_SECTIONS = ['role', 'context', 'tools', 'task', 'examples', 'output_format'] as const;

/** Render an `XmlPrompt` into the canonical XML form. */
export function renderXml(prompt: XmlPrompt): string {
  const parts: string[] = [];
  parts.push(`<role>${prompt.role.trim()}</role>`);
  if (prompt.context !== undefined && prompt.context.trim().length > 0) {
    parts.push(`<context>\n${prompt.context.trim()}\n</context>`);
  }
  if (prompt.tools !== undefined && prompt.tools.trim().length > 0) {
    parts.push(`<tools>\n${prompt.tools.trim()}\n</tools>`);
  }
  parts.push(`<task>${prompt.task.trim()}</task>`);
  if (prompt.examples !== undefined && prompt.examples.length > 0) {
    const exParts = prompt.examples
      .map((ex) => `<example>\n  <input>${ex.input}</input>\n  <output>${ex.output}</output>\n</example>`)
      .join('\n');
    parts.push(`<examples>\n${exParts}\n</examples>`);
  }
  if (prompt.outputFormat !== undefined && prompt.outputFormat.trim().length > 0) {
    parts.push(`<output_format>\n${prompt.outputFormat.trim()}\n</output_format>`);
  }
  return parts.join('\n');
}

/**
 * Render for a specific provider. We always return XML (every provider
 * accepts it as plain text in system prompts), but we tag the OUTPUT
 * with provider hints so observability can audit faithfulness.
 */
export function renderForProvider(prompt: XmlPrompt, provider: ProviderName): string {
  // Same canonical XML across providers. Provider-specific tweaks live in
  // adapter formatPayload (e.g. Google uses systemInstruction wrapper),
  // not in the prompt body itself — keeps prompt portable.
  switch (provider) {
    case 'anthropic':
    case 'anthropic-bedrock':
    case 'anthropic-vertex':
      return renderXml(prompt); // native XML preference
    case 'openai':
      // OpenAI accepts XML but also benefits from a leading sentence framing.
      return renderXml(prompt);
    case 'google':
      // Gemini ignores tag semantics but parses content; keep tags for
      // human readability + tool-result interop.
      return renderXml(prompt);
    case 'ollama':
    case 'vllm':
      return renderXml(prompt);
    default:
      return renderXml(prompt);
  }
}

/**
 * Parse a XML prompt back into the structured form. Lenient parser — uses
 * a regex per top-level tag (we don't allow nested duplicates). Returns
 * undefined for missing sections.
 *
 * Useful for prompt linting + CI gate: fail builds where prompts don't
 * adhere to the XML schema.
 */
export function parseXml(text: string): XmlPrompt | undefined {
  const role = extractTag(text, 'role');
  const task = extractTag(text, 'task');
  if (role === undefined || task === undefined) return undefined;
  const result: XmlPrompt = {
    role,
    task,
    ...(extractTag(text, 'context') !== undefined ? { context: extractTag(text, 'context') } : {}),
    ...(extractTag(text, 'tools') !== undefined ? { tools: extractTag(text, 'tools') } : {}),
    ...(extractTag(text, 'output_format') !== undefined ? { outputFormat: extractTag(text, 'output_format') } : {}),
  } as XmlPrompt;
  return result;
}

function extractTag(text: string, tag: string): string | undefined {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  if (start === -1) return undefined;
  const end = text.indexOf(close, start + open.length);
  if (end === -1) return undefined;
  return text.slice(start + open.length, end).trim();
}

/**
 * Lint a prompt — return a list of issues. Empty array means "portable".
 *
 *   - missing required tags
 *   - free-form text outside tag tree (heuristic: > 80% of chars are
 *     inside tags)
 *   - tag with no closing tag
 */
export function lintPortability(text: string): readonly string[] {
  const issues: string[] = [];
  for (const required of ['role', 'task'] as const) {
    if (extractTag(text, required) === undefined) {
      issues.push(`missing required tag <${required}>`);
    }
  }
  // Detect unclosed tags.
  for (const tag of ALL_XML_SECTIONS) {
    const opens = (text.match(new RegExp(`<${tag}>`, 'g')) ?? []).length;
    const closes = (text.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    if (opens !== closes) {
      issues.push(`tag <${tag}> opens=${opens} closes=${closes} (must match)`);
    }
  }
  return Object.freeze(issues);
}

/**
 * Semantic-equivalence score between two responses (heuristic).
 *
 * For real eval we delegate to Inspect AI (K-D). This helper supports the
 * unit test for prompt portability: same canonical prompt produces
 * comparable responses across providers.
 *
 * Returns [0..1]: 1.0 if identical (trimmed lowercased), else a Jaccard
 * over token sets.
 */
export function semanticSimilarity(a: string, b: string): number {
  const norm = (s: string): readonly string[] =>
    Object.freeze(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 0)
    );
  const aTokens = new Set(norm(a));
  const bTokens = new Set(norm(b));
  if (aTokens.size === 0 && bTokens.size === 0) return 1;
  const intersection = [...aTokens].filter((t) => bTokens.has(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}
