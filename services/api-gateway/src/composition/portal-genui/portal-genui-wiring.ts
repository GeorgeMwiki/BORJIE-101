/**
 * Portal-GenUI composition wiring — closes the "infinite dynamic tabs" gap.
 *
 * The `@borjie/portal-genui` engine is built + unit-tested but was
 * disconnected at four seams: the router was never mounted, the engine was
 * never constructed, the `portal_tabs` table did not exist, and nothing
 * rendered a generated tab. This file is seam #2: it CONSTRUCTS the engine
 * and exposes it for mounting.
 *
 * What it wires
 * -------------
 *   - persistence: `createDrizzleTabRegistry({ db })` over the live
 *     `getDb()` Drizzle client. The engine's adapter speaks plain
 *     parameterised SQL ($1..$N) against the `portal_tabs` table (migration
 *     0170), so we forward postgres-js's low-level handle (`db.$client`,
 *     exposed by Drizzle) as the narrow `DbExecutor.query(sql, params)` port
 *     — the same `$client` boundary `llm-budget-postgres-wiring.ts` uses.
 *     RLS (FORCE on `app.current_tenant_id`) is enforced by the DB; the GUC
 *     is bound per-request by api-gateway middleware, so no app-side
 *     double-filtering.
 *   - brain: an OPTIONAL single-shot completion port (classify + generate)
 *     backed by `AnthropicProvider` when `ANTHROPIC_API_KEY` is set. When no
 *     key is configured the port is omitted and the engine degrades to
 *     heuristic-only intent detection + the deterministic fallback generator
 *     (still fully usable; that is the mode the unit tests exercise).
 *
 * Exposure
 * --------
 * `buildPortalGenuiWiring()` returns `{ engine, router }`. The orchestrator
 * (`services/api-gateway/src/index.ts`) attaches the engine onto the service
 * registry slot the router reads (`services.portalGenUIEngine`) and mounts
 * the router at `/api/v1/portal-genui`. This module NEVER calls into
 * `index.ts` and NEVER reads `process.env` outside the provider key probe
 * (which mirrors every other LLM wiring in this directory).
 *
 * Security: the generated tab is zod-validated inside the engine
 * (`PortalTabSchema.parse`) before it can persist; the router enforces
 * tenant/actor from the JWT and never trusts the request body. No raw HTML
 * is emitted here — the renderer (owner-web `GenUITabHost`) DOMPurifies. Pino
 * is the only logger.
 */

import {
  AnthropicProvider,
  ANTHROPIC_MODELS,
} from '@borjie/ai-copilot/providers';
import {
  createGenUIEngine,
  createDrizzleTabRegistry,
  createDrizzleRecordStore,
  createInMemoryRecordStore,
  DEFAULT_ALLOWED_MEDIA_HOSTS,
  type UrlEgressPolicy,
  type GenUIEngine,
  type GenUIEngineBrainPort,
  type DbExecutor,
  type RecordStore,
} from '@borjie/portal-genui';
import {
  createSupabaseStorageAdapter,
  createInMemoryStorageAdapter,
  type StorageAdapter,
} from '@borjie/storage-adapter';
import { createSupabaseAdminClient } from '@borjie/supabase-client';

import { getDb } from '../db-client.js';
import { logger } from '../../utils/logger.js';
import portalGenUIRouter from '../../routes/portal-genui/portal-genui.router.js';

// ────────────────────────────────────────────────────────────────────
// DbExecutor adapter — postgres-js `$client.unsafe(sql, params)` returns
// the row array directly. We forward Drizzle's low-level handle as the
// narrow query port the engine's persistence adapter consumes.
// ────────────────────────────────────────────────────────────────────

/** postgres-js low-level handle shape we depend on (just `unsafe`). */
interface PostgresUnsafeClient {
  unsafe<Row = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<Row>>;
}

function makeDbExecutor(
  db: NonNullable<ReturnType<typeof getDb>>,
): DbExecutor {
  // Drizzle on postgres-js exposes the tagged-template handle via `$client`.
  // The cast is the single boundary between the Drizzle namespace shape and
  // the duck-typed SQL port (same pattern as llm-budget-postgres-wiring.ts).
  const client = (db as unknown as { $client: PostgresUnsafeClient }).$client;
  return {
    async query<Row = Record<string, unknown>>(
      sql: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<ReadonlyArray<Row>> {
      const rows = await client.unsafe<Row>(sql, params ?? []);
      return rows;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Brain port — single-shot completion adapter. Both the intent classifier
// and the schema generator are single-shot text completions, so one
// `AnthropicProvider.complete()` call satisfies both `classify` and
// `generate`. Null when no Anthropic key is configured — the engine then
// runs heuristic intent + deterministic fallback generation.
// ────────────────────────────────────────────────────────────────────

function buildBrainPort(): GenUIEngineBrainPort | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    logger.info(
      { wiring: 'portal-genui' },
      'portal-genui: no ANTHROPIC_API_KEY — engine runs heuristic intent + deterministic generator',
    );
    return undefined;
  }

  const provider = new AnthropicProvider({ apiKey });

  /**
   * One single-shot completion used by both ports. `maxTokens` is generous
   * for `generate` (a full PortalTab JSON) and harmless for `classify` (one
   * JSON line). Temperature is low for deterministic, parseable output.
   */
  async function complete(
    system: string,
    userMessage: string,
    maxTokens: number,
  ): Promise<{ text: string; modelId?: string }> {
    // The provider only reads prompt.systemPrompt / userPrompt / modelConfig
    // for a single-shot completion; the rest of CompiledPrompt (promptId,
    // guardrails, …) is irrelevant here. We build the fields it consumes and
    // cast the request — the same boundary multi-llm-brain-adapter.ts uses.
    const result = await provider.complete({
      prompt: {
        promptId: 'portal-genui',
        version: '1.0.0',
        systemPrompt: system,
        userPrompt: userMessage,
        modelConfig: {
          modelId: ANTHROPIC_MODELS.SONNET_4_6,
          maxTokens,
          temperature: 0.1,
        },
      },
    } as never);
    if (result.success === false) {
      throw new Error(
        `portal-genui brain: completion failed: ${result.error.message}`,
      );
    }
    return {
      text: result.data.content,
      modelId: String(result.data.modelId),
    };
  }

  return {
    async classify(call) {
      return complete(call.system, call.userMessage, 512);
    },
    async generate(call) {
      return complete(call.system, call.userMessage, 4096);
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// StorageAdapter — tenant-uploads bucket for file/image/audio fields.
// Supabase-backed in production; in-memory degrade in dev/test so the
// gateway still boots without Supabase creds.
// ────────────────────────────────────────────────────────────────────

function buildStorageAdapter(): StorageAdapter {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const environment =
    process.env.SUPABASE_ENVIRONMENT?.trim() ??
    process.env.NODE_ENV?.trim() ??
    'development';

  if (supabaseUrl && serviceRoleKey) {
    try {
      const supabase = createSupabaseAdminClient({
        url: supabaseUrl,
        serviceRoleKey,
      });
      logger.info(
        { wiring: 'portal-genui-storage', mode: 'supabase', environment },
        'portal-genui: storage adapter bound to Supabase tenant-uploads bucket',
      );
      return createSupabaseStorageAdapter({ supabase, environment });
    } catch (err) {
      logger.warn(
        {
          wiring: 'portal-genui-storage',
          error: err instanceof Error ? err.message : String(err),
        },
        'portal-genui: Supabase storage init failed — falling back to in-memory adapter',
      );
    }
  }

  logger.info(
    { wiring: 'portal-genui-storage', mode: 'in-memory' },
    'portal-genui: using in-memory storage adapter (Supabase env unset)',
  );
  return createInMemoryStorageAdapter();
}

// ────────────────────────────────────────────────────────────────────
// Engine construction + public build fn.
// ────────────────────────────────────────────────────────────────────

export interface PortalGenuiWiring {
  /** The constructed engine — attach to `services.portalGenUIEngine`. */
  readonly engine: GenUIEngine;
  /** The router to mount at `/api/v1/portal-genui`. */
  readonly router: typeof portalGenUIRouter;
  /**
   * The generated-tab RECORD store (K1a) — attach to
   * `services.portalGenUIRecordStore` so the `/tabs/:id/records` endpoints can
   * persist + read submissions validated against each tab's own field schema.
   */
  readonly recordStore: RecordStore;
  /**
   * Tenant-uploads StorageAdapter — attach to
   * `services.portalGenUIStorageAdapter` so the `/tabs/:id/upload` endpoint
   * can store file bytes to the `tenant-uploads` bucket and return a signed URL.
   * Supabase-backed when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
   * are set; otherwise in-memory (dev/test honest-degrade, no crash).
   */
  readonly storageAdapter: StorageAdapter;
  /** True when a live Postgres-backed persistence layer was wired. */
  readonly persistent: boolean;
}

/**
 * Resolve the render-egress URL allowlist for generated tabs. Combines the
 * package defaults with the live Supabase storage host (so first-party uploads
 * render) and any comma-separated extras in `BORJIE_GENUI_MEDIA_ALLOWLIST`.
 * Read at the composition bootstrap seam, mirroring the rest of this file.
 */
function resolveUrlEgressPolicy(): UrlEgressPolicy {
  const hosts = new Set<string>(DEFAULT_ALLOWED_MEDIA_HOSTS);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    try {
      hosts.add(new URL(supabaseUrl).hostname.toLowerCase());
    } catch {
      /* malformed URL — ignore, defaults still apply */
    }
  }

  const extra = process.env.BORJIE_GENUI_MEDIA_ALLOWLIST?.trim();
  if (extra) {
    for (const h of extra.split(',')) {
      const host = h.trim().toLowerCase();
      if (host) hosts.add(host);
    }
  }

  return { allowedHosts: Object.freeze([...hosts]) };
}

/**
 * Construct the portal-genui engine + return it together with its router for
 * the orchestrator to mount. Pure factory — no side effects, never touches
 * `index.ts`, never starts a server.
 *
 * Degraded mode (no DATABASE_URL): the engine still constructs with an
 * in-memory registry so /detect + /generate work; persistence simply isn't
 * durable. That keeps the gateway booting in test/dev/smoke environments,
 * matching every other wiring in this directory.
 */
export function buildPortalGenuiWiring(): PortalGenuiWiring {
  const db = getDb();
  const brain = buildBrainPort();

  const persistence = db ? createDrizzleTabRegistry({ db: makeDbExecutor(db) }) : undefined;

  // K1a — the generated-tab record store. Postgres-backed when a DB is wired,
  // else an in-memory store so the records endpoints stay usable in dev/test.
  const recordStore = db
    ? createDrizzleRecordStore({ db: makeDbExecutor(db) })
    : createInMemoryRecordStore();

  // Tenant-uploads storage adapter for the /tabs/:id/upload endpoint.
  const storageAdapter = buildStorageAdapter();

  if (!persistence) {
    logger.warn(
      { wiring: 'portal-genui' },
      'portal-genui: DATABASE_URL unset — using in-memory tab registry (generated tabs will not survive restart)',
    );
  }

  const urlEgressPolicy = resolveUrlEgressPolicy();

  const engine = createGenUIEngine({
    ...(brain !== undefined ? { brain } : {}),
    ...(persistence !== undefined ? { persistence } : {}),
    urlEgressPolicy,
  });

  logger.info(
    {
      wiring: 'portal-genui',
      brain: brain ? 'live' : 'heuristic-only',
      persistence: persistence ? 'postgres' : 'in-memory',
      egressAllowedHosts: urlEgressPolicy.allowedHosts.length,
    },
    'portal-genui: engine constructed',
  );

  return {
    engine,
    router: portalGenUIRouter,
    recordStore,
    storageAdapter,
    persistent: Boolean(persistence),
  };
}
