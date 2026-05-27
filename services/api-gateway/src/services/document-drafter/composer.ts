/**
 * Composer — fills a template (or pair of templates for bilingual)
 * with the supplied `fillVars` and resolves every `{{semantic:*}}`
 * block via the injected SemanticBlockGenerator.
 *
 * The composer is *pure* on the data-flow path; the only side effect
 * is the SemanticBlockGenerator call. Tests can swap a deterministic
 * generator for the LLM-backed one used in production.
 *
 * Placeholder syntax:
 *   {{plainVar}}                – substituted from `fillVars`
 *   {{semantic:scopeOfWork}}    – passed through the generator
 *   {{unknownVar}}              – left as `[unknownVar]` (visible
 *                                 marker for the reviewer)
 */

import { loadTemplateContent, findTemplate } from './templates/index.js';
import { SEMANTIC_PROMPTS, buildRevisionPrompt } from './prompts.js';
import type { DraftKind, DraftLanguage } from '@borjie/database';

const PLACEHOLDER_REGEX = /\{\{([a-zA-Z0-9_.:-]+)\}\}/g;

export interface SemanticBlockGenerator {
  generate(input: {
    readonly kind: DraftKind;
    readonly language: DraftLanguage;
    readonly key: string;
    readonly context: Record<string, unknown>;
    readonly systemPrompt: string;
    readonly userPrompt: string;
  }): Promise<string>;
}

/**
 * Deterministic, LLM-free fallback. Returns a structured placeholder
 * that names the requested semantic block, so the resulting markdown
 * is still reviewable when no LLM is wired (tests, brownouts).
 */
export const placeholderSemanticGenerator: SemanticBlockGenerator = {
  async generate({ key, language }) {
    if (language === 'sw') {
      return `> _[Sehemu ya \`${key}\` — itajazwa na ubongo wa Borjie wakati LLM imefunguliwa]_`;
    }
    if (language === 'en') {
      return `> _[Section \`${key}\` — to be filled by the Borjie brain once an LLM is wired]_`;
    }
    return `> _[Sehemu ya \`${key}\` / Section \`${key}\` — bilingual placeholder]_`;
  },
};

export interface ComposeInput {
  readonly kind: DraftKind;
  readonly templateSlug: string;
  readonly language: DraftLanguage;
  readonly fillVars: Record<string, unknown>;
  readonly generator?: SemanticBlockGenerator;
}

export interface ComposeOutput {
  readonly contentMd: string;
  readonly missingPlaceholders: readonly string[];
  readonly semanticBlocks: readonly string[];
}

/**
 * Compose the final markdown document. `language='bilingual'`
 * concatenates the Swahili rendering followed by a horizontal rule
 * and the English rendering.
 */
export async function compose(input: ComposeInput): Promise<ComposeOutput> {
  const def = findTemplate(input.templateSlug);
  if (!def) {
    throw new Error(`composer: unknown template slug "${input.templateSlug}"`);
  }
  const generator = input.generator ?? placeholderSemanticGenerator;
  const sources = loadTemplateContent(input.templateSlug, input.language);

  if (input.language === 'sw') {
    const result = await renderSingle(
      sources.sw,
      input.kind,
      'sw',
      input.fillVars,
      generator,
    );
    return result;
  }
  if (input.language === 'en') {
    return renderSingle(sources.en, input.kind, 'en', input.fillVars, generator);
  }
  // Bilingual: render both and stitch.
  const swRender = await renderSingle(
    sources.sw,
    input.kind,
    'bilingual',
    input.fillVars,
    generator,
  );
  const enRender = await renderSingle(
    sources.en,
    input.kind,
    'bilingual',
    input.fillVars,
    generator,
  );
  const merged = `${swRender.contentMd}\n\n---\n\n${enRender.contentMd}`;
  return {
    contentMd: merged,
    missingPlaceholders: dedupe([
      ...swRender.missingPlaceholders,
      ...enRender.missingPlaceholders,
    ]),
    semanticBlocks: dedupe([
      ...swRender.semanticBlocks,
      ...enRender.semanticBlocks,
    ]),
  };
}

async function renderSingle(
  templateRaw: string,
  kind: DraftKind,
  language: DraftLanguage,
  fillVars: Record<string, unknown>,
  generator: SemanticBlockGenerator,
): Promise<ComposeOutput> {
  const semanticBlocks: string[] = [];
  const missing: string[] = [];

  // First pass: resolve every semantic block (async) and capture
  // their substitutions.
  const semanticSubs = new Map<string, string>();
  const semanticKeys = collectSemanticKeys(templateRaw);
  for (const key of semanticKeys) {
    const promptDef = SEMANTIC_PROMPTS[key];
    if (!promptDef) {
      missing.push(`semantic:${key}`);
      semanticSubs.set(key, `[semantic:${key}]`);
      continue;
    }
    semanticBlocks.push(key);
    const out = await generator.generate({
      kind,
      language,
      key,
      context: fillVars,
      systemPrompt: promptDef.system(language),
      userPrompt: promptDef.user(kind, fillVars, language),
    });
    semanticSubs.set(key, out);
  }

  // Second pass: synchronous placeholder replacement.
  const rendered = templateRaw.replace(PLACEHOLDER_REGEX, (_match, name) => {
    if (typeof name !== 'string') return _match;
    if (name.startsWith('semantic:')) {
      const key = name.slice('semantic:'.length);
      return semanticSubs.get(key) ?? `[semantic:${key}]`;
    }
    if (!(name in fillVars)) {
      missing.push(name);
      return `[${name}]`;
    }
    const raw = fillVars[name];
    return formatValue(raw);
  });

  return {
    contentMd: rendered,
    missingPlaceholders: dedupe(missing),
    semanticBlocks,
  };
}

function collectSemanticKeys(template: string): readonly string[] {
  const keys = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_REGEX)) {
    const name = match[1];
    if (typeof name === 'string' && name.startsWith('semantic:')) {
      keys.add(name.slice('semantic:'.length));
    }
  }
  return Array.from(keys);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function dedupe<T>(arr: readonly T[]): readonly T[] {
  return Array.from(new Set(arr));
}

/**
 * Apply a revision instruction to an existing markdown body.
 * The generator typically delegates to the LLM; the fallback merely
 * appends an "edit history" footer so the chain remains traceable.
 */
export async function reviseContent(input: {
  readonly originalContent: string;
  readonly instruction: string;
  readonly language: DraftLanguage;
  readonly generator?: SemanticBlockGenerator;
}): Promise<string> {
  const generator = input.generator ?? placeholderSemanticGenerator;
  const { system, user } = buildRevisionPrompt(
    input.language,
    input.originalContent,
    input.instruction,
  );
  const revised = await generator.generate({
    kind: 'memo',
    language: input.language,
    key: 'revision',
    context: { instruction: input.instruction },
    systemPrompt: system,
    userPrompt: user,
  });
  // If the generator is the placeholder (no LLM), append the
  // instruction as a tracked-changes footer rather than overwriting
  // the original — this keeps deterministic test output reviewable.
  if (revised.startsWith('> _[')) {
    return [
      input.originalContent.trimEnd(),
      '',
      '---',
      '',
      input.language === 'sw'
        ? '## Maelekezo ya Marekebisho (yatatekelezwa)'
        : '## Revision Instruction (pending LLM)',
      '',
      `> ${input.instruction}`,
    ].join('\n');
  }
  return revised;
}
