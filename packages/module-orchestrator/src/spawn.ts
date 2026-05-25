/**
 * spawn.ts — entry points for creating new modules.
 *
 *   spawnModuleFromTemplate(tenantId, templateSlug, …)
 *     The well-trodden path: clone a built-in template, compile its
 *     spec, persist DRAFT module + DRAFT spec, return both ids.
 *     Lifecycle proceeds: DRAFT → PROPOSED on compile success →
 *     APPROVED (K5 four-eye) → LIVE (apply via MigrationApplyPort).
 *
 *   spawnModuleFromPrompt(tenantId, prompt, persona, …)
 *     The LLM-generated path. The LLM emits a JSON spec (NEVER SQL).
 *     The orchestrator validates → compiles → persists DRAFT for
 *     review. Same approval gates apply.
 *
 * Both entry points return synchronously; the actual K5 + apply
 * happens via separate `applyModuleSpec(...)` calls.
 */

import {
  compileSpec,
  validateSpec,
  type ModuleSpec,
} from '@borjie/module-spec-engine';
import type { OrchestratorDeps } from './ports.js';

export interface SpawnFromTemplateInput {
  readonly tenantId: string;
  readonly templateSlug: string;
  readonly moduleSlug: string;
  readonly title: string;
  readonly titleSw: string | null;
  readonly scopedToolIds: readonly string[];
  readonly createdByUserId: string | null;
}

export interface SpawnFromPromptInput {
  readonly tenantId: string;
  readonly persona: string;
  readonly moduleSlug: string;
  readonly title: string;
  readonly titleSw: string | null;
  readonly scopedToolIds: readonly string[];
  readonly createdByUserId: string | null;
  /**
   * The LLM's output, parsed but UNVALIDATED. The orchestrator runs
   * `validateSpec` before persisting; rejection returns errors here.
   */
  readonly candidateSpec: unknown;
}

export interface SpawnResult {
  readonly ok: boolean;
  readonly moduleId: string | undefined;
  readonly specId: string | undefined;
  readonly migrationSql: string;
  readonly errors: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────
// Spawn from a built-in template.
// ─────────────────────────────────────────────────────────────────────

export async function spawnModuleFromTemplate(
  input: SpawnFromTemplateInput,
  deps: OrchestratorDeps,
): Promise<SpawnResult> {
  const template = await deps.templates.findTemplate(input.templateSlug);
  if (!template) {
    return failure([`unknown template slug: ${input.templateSlug}`]);
  }
  const candidate = template.defaultSpec as ModuleSpec;
  return persistModuleAndSpec({
    tenantId: input.tenantId,
    moduleSlug: input.moduleSlug,
    title: input.title,
    titleSw: input.titleSw,
    templateId: template.id,
    scopedToolIds: input.scopedToolIds,
    createdByUserId: input.createdByUserId,
    spec: candidate,
    deps,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Spawn from an LLM-emitted candidate spec.
// ─────────────────────────────────────────────────────────────────────

export async function spawnModuleFromPrompt(
  input: SpawnFromPromptInput,
  deps: OrchestratorDeps,
): Promise<SpawnResult> {
  const v = validateSpec(input.candidateSpec);
  if (!v.ok || !v.spec) {
    return failure(v.errors);
  }
  return persistModuleAndSpec({
    tenantId: input.tenantId,
    moduleSlug: input.moduleSlug,
    title: input.title,
    titleSw: input.titleSw,
    templateId: null,
    scopedToolIds: input.scopedToolIds,
    createdByUserId: input.createdByUserId,
    spec: v.spec,
    deps,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Shared persistence routine.
// ─────────────────────────────────────────────────────────────────────

interface PersistArgs {
  readonly tenantId: string;
  readonly moduleSlug: string;
  readonly title: string;
  readonly titleSw: string | null;
  readonly templateId: string | null;
  readonly scopedToolIds: readonly string[];
  readonly createdByUserId: string | null;
  readonly spec: ModuleSpec;
  readonly deps: OrchestratorDeps;
}

async function persistModuleAndSpec(args: PersistArgs): Promise<SpawnResult> {
  // Compile FIRST so we never persist a module whose spec doesn't compile.
  const compiled = compileSpec(args.spec, args.tenantId);
  if (!compiled.ok) {
    return failure(compiled.errors);
  }

  const moduleId = args.deps.ids.newId('mod');
  const specId = args.deps.ids.newId('mspec');
  const vectorNamespace = `tnt:${args.tenantId}:mod:${moduleId}`;

  await args.deps.modules.createModule({
    id: moduleId,
    tenantId: args.tenantId,
    slug: args.moduleSlug,
    title: args.title,
    titleSw: args.titleSw,
    templateId: args.templateId,
    vectorNamespace,
    scopedToolIds: args.scopedToolIds,
    createdByUserId: args.createdByUserId,
  });

  await args.deps.specs.createSpec({
    id: specId,
    moduleId,
    tenantId: args.tenantId,
    version: 1,
    specJsonb: args.spec as unknown as Readonly<Record<string, unknown>>,
    generatedMigrationSql: compiled.migrationSql,
    generatedZodValidators: compiled.zodValidators as Readonly<
      Record<string, unknown>
    >,
  });

  // Transition DRAFT → PROPOSED (compile succeeded).
  await args.deps.modules.setLifecycleState({
    tenantId: args.tenantId,
    id: moduleId,
    state: 'PROPOSED',
    specId,
  });

  return Object.freeze({
    ok: true,
    moduleId,
    specId,
    migrationSql: compiled.migrationSql,
    errors: [],
  });
}

function failure(errors: readonly string[]): SpawnResult {
  return Object.freeze({
    ok: false,
    moduleId: undefined,
    specId: undefined,
    migrationSql: '',
    errors,
  });
}
