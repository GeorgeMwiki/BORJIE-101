/**
 * Hono `ContextVariableMap` augmentation indirection — scrub-5a (2026-05-27).
 *
 * The actual augmentation lives in `src/types/hono-augmentation.d.ts`,
 * which is auto-included by `tsconfig.json` (`include: src/star-star/star`).
 * This file is a colocated, runtime-safe sibling of `typed-context.ts`
 * so route files can keep the typed-context import pair adjacent:
 *
 *   import { ok, err } from '../lib/typed-context';
 *   // Augmentation is auto-loaded — no runtime import required.
 *
 * If `include` ever narrows below the workspace glob, restore the
 * explicit triple-slash reference below.
 *
 * Source of truth for `c.set/c.get` keys:
 *   services/api-gateway/src/types/hono-augmentation.d.ts
 *
 * Cluster 1 retirement plan: see `Docs/TYPE_DEBT.md`.
 */

/// <reference path="../types/hono-augmentation.d.ts" />

export {};
