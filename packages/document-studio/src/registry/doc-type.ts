/**
 * @borjie/document-studio — doc-type registry.
 *
 * The registry is the open-ended catalogue of document types the studio
 * can emit. Each entry pairs:
 *
 *   - a stable `id` (machine key, e.g. `royalty_statement`),
 *   - a Zod `schema` that validates the raw request data,
 *   - a `binder` that maps raw data → a render-ready view model
 *     (the "document model"), and
 *   - an `engineHint` (which renderer family to use) + `defaultFormats`.
 *
 * "Infinite types beyond fixed templates" is achieved two ways:
 *
 *   1. CLOSED SET — hand-verified types registered at boot
 *      (`registerCoreDocTypes`). Fast, audited, regulator-grade.
 *   2. AUTHORED TYPES — any number of bespoke types registered at
 *      runtime via `registry.register(spec)` from an upstream recipe
 *      author. The registry does not care whether a type was authored
 *      by a human or an LLM — it only requires the four contracts.
 *
 * The registry is a PURE in-memory port. Persistence (which authored
 * types a tenant has) lives upstream; this package stays dependency-light
 * (zod only) and never reaches a database.
 */

import { z } from 'zod';
import type { DocFormat } from '../types.js';

/**
 * Which renderer family a doc type compiles through. Selecting an engine
 * is the registry's job; the actual renderer instances are injected at
 * the pipeline boundary so this package never hard-binds a transport.
 *
 *   - `typst`   → regulator/legal PDF (default, reproducible).
 *   - `carbone` → Office template → DOCX / XLSX / PDF (multi-format).
 *   - `html-pdf`→ pixel-perfect HTML → PDF fallback (Puppeteer/Playwright).
 */
export const ENGINE_HINTS = ['typst', 'carbone', 'html-pdf'] as const;
export type EngineHint = (typeof ENGINE_HINTS)[number];

/**
 * The render-ready document model a binder produces. Renderers consume
 * `view` (the JSON injected into the template) and the studio threads
 * `locale` / `currencyCode` / `citations` / `templateRef` through the
 * pipeline for the localisation + citation + archival gates.
 */
export interface DocumentModel<TView = Record<string, unknown>> {
  /** Template the renderer resolves (e.g. `royalty-statement/template.typ`). */
  readonly templateRef: string;
  /** The exact JSON the template consumes. */
  readonly view: TView;
  /** Absolute language toggle — the whole doc renders in exactly one. */
  readonly locale: 'en' | 'sw';
  /** ISO-4217 currency every monetary figure was formatted in. */
  readonly currencyCode: string;
}

/**
 * A binder maps validated raw data → a `DocumentModel`. It is the
 * data-binding layer: it joins ledger / corpus / entity facts into the
 * shape the template addresses. Binders are pure + synchronous so they
 * are trivially testable and deterministic.
 */
export type DocBinder<TData = unknown, TView = Record<string, unknown>> = (
  data: TData,
) => DocumentModel<TView>;

/**
 * One registered document type. `schema` validates raw input; `binder`
 * turns the parsed value into the render model.
 */
export interface DocTypeSpec<TData = unknown, TView = Record<string, unknown>> {
  /** Stable machine key — unique within the registry. */
  readonly id: string;
  /** Human label (single-language is the caller's concern, not the key). */
  readonly title: string;
  /**
   * Zod schema validating the raw request data. Input is `unknown` so a
   * schema with `.default()`/`.optional()` fields (whose input type
   * differs from its output `TData`) still satisfies the contract — the
   * studio always feeds untrusted `unknown` data in.
   */
  readonly schema: z.ZodType<TData, z.ZodTypeDef, unknown>;
  /** Pure data-binding transform → render model. */
  readonly binder: DocBinder<TData, TView>;
  /** Which renderer family compiles this type. */
  readonly engineHint: EngineHint;
  /** Formats the type emits when the caller does not specify. */
  readonly defaultFormats: ReadonlyArray<DocFormat>;
  /**
   * How the citation gate verifies this type's figures:
   *   - `inline` (default) — narrative prose; each figure needs an inline
   *     `[ID]` marker (the `verifyDocumentCitations` model).
   *   - `structured` — tabular/worksheet; each monetary figure must be
   *     COVERED by a citation whose `claim` contains it (no inline tag).
   */
  readonly citationMode?: 'inline' | 'structured';
  /** True when authored at runtime (LLM/bespoke) vs a core hand-verified type. */
  readonly authored?: boolean;
}

export interface DocTypeRegistry {
  /**
   * Register a doc type. Re-registering an existing `id` throws unless
   * `{ overwrite: true }` — authored types may shadow a draft but the
   * core set is otherwise immutable within a process.
   */
  register<TData, TView>(
    spec: DocTypeSpec<TData, TView>,
    options?: { overwrite?: boolean },
  ): void;
  /** Look up a type by id; `undefined` when not registered. */
  get(id: string): DocTypeSpec | undefined;
  /** True when a type is registered. */
  has(id: string): boolean;
  /** All registered ids, sorted for deterministic listing. */
  ids(): ReadonlyArray<string>;
  /** All specs (frozen snapshot). */
  list(): ReadonlyArray<DocTypeSpec>;
}

/**
 * Build a fresh, empty registry. Callers seed it with the core set via
 * `registerCoreDocTypes(registry)` and/or authored types at runtime.
 */
export function createDocTypeRegistry(): DocTypeRegistry {
  const byId = new Map<string, DocTypeSpec>();

  return {
    register(spec, options) {
      if (spec.id.trim().length === 0) {
        throw new Error('doc-type registry: spec.id must be non-empty');
      }
      if (byId.has(spec.id) && options?.overwrite !== true) {
        throw new Error(
          `doc-type registry: '${spec.id}' already registered ` +
            '(pass { overwrite: true } to replace)',
        );
      }
      // Store as the erased base type — the typed generic is a
      // call-site convenience; internally everything is `unknown`.
      byId.set(spec.id, spec as unknown as DocTypeSpec);
    },
    get(id) {
      return byId.get(id);
    },
    has(id) {
      return byId.has(id);
    },
    ids() {
      return Object.freeze([...byId.keys()].sort());
    },
    list() {
      return Object.freeze([...byId.values()]);
    },
  };
}
