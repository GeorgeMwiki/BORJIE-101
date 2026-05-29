/**
 * Model loader for the on-device MiniLM-L6-v2 ONNX router.
 *
 * Strategy:
 *   1. Look for the ONNX bundle on disk at `~/.borjie-models/`.
 *      (The operator downloads it once per device — see
 *      `Docs/OPS/OPERATOR_ACTION_LIST.md` OA-016.)
 *   2. If the files are present, dynamically `import('@xenova/transformers')`
 *      and lazy-load the pipeline. The dep is intentionally NOT in
 *      `package.json` so the package stays zero-runtime-dep — the
 *      dynamic import resolves at runtime only on devices that have
 *      both the model + the optional dep installed.
 *   3. Cache the loaded pipeline in-process so subsequent calls reuse it.
 *
 * If anything is missing (model files, optional dep, or wrong arch),
 * `loadOnDeviceModel()` returns `null` and the caller falls through to
 * the server. We never throw on absence — the on-device path is purely
 * additive over the server router.
 *
 * The disk layout we expect under `~/.borjie-models/minilm-l6-v2/`:
 *
 *   - `model.onnx`            (~22 MB, quantised Q8)
 *   - `tokenizer.json`        (~470 KB)
 *   - `tokenizer_config.json` (~280 B)
 *   - `config.json`           (~600 B)
 *   - `MANIFEST.json`         optional Borjie-flavoured digest
 *
 * The README documents how to fetch them.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REQUIRED_FILES: readonly string[] = [
  'model.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
];

/**
 * Override for tests: callers can inject a different model root.
 * Production reads `~/.borjie-models/minilm-l6-v2/`.
 */
export interface ModelLoaderOptions {
  readonly modelRoot?: string;
  /**
   * Test seam — supply an in-memory pipeline so tests don't need the
   * 22 MB bundle on disk. When supplied, the loader bypasses the
   * filesystem and the dynamic import entirely.
   */
  readonly fixedPipeline?: OnDevicePipeline;
  /**
   * Test seam — bypass the dynamic `import('@xenova/transformers')`.
   * When supplied, the loader uses this factory after confirming the
   * files exist on disk. Returning `null` simulates the optional dep
   * being absent.
   */
  readonly importPipeline?: () => Promise<OnDevicePipeline | null>;
}

/**
 * The minimal pipeline interface we depend on. The real
 * `@xenova/transformers` `FeatureExtractionPipeline` satisfies this
 * structurally — we declare only what `routeOnDevice` actually uses so
 * the rest of the surface is opaque.
 */
export interface OnDevicePipeline {
  readonly modelId: string;
  /**
   * Tokenise + run MiniLM forward pass.
   * Returns the routing prediction (toolId + softmax confidence).
   */
  classify(text: string): Promise<{ toolId: string | null; confidence: number }>;
}

let cachedPipeline: OnDevicePipeline | null | undefined;

/**
 * Resolve the canonical model directory. Honours `BORJIE_MODELS_PATH`
 * for CI / containers; otherwise falls back to `~/.borjie-models/`.
 */
export function getModelRoot(override?: string): string {
  if (override) return override;
  const env = process.env.BORJIE_MODELS_PATH;
  if (env && env.trim().length > 0) {
    return join(env, 'minilm-l6-v2');
  }
  return join(homedir(), '.borjie-models', 'minilm-l6-v2');
}

/**
 * Cheap synchronous check — are the four required files present on
 * disk? Returns `true` iff EVERY file resolves.
 */
export function isModelOnDisk(modelRoot?: string): boolean {
  const root = getModelRoot(modelRoot);
  if (!existsSync(root)) return false;
  return REQUIRED_FILES.every((f) => existsSync(join(root, f)));
}

/**
 * Lazy-load the on-device pipeline. Returns `null` if the model files
 * are not present OR the optional `@xenova/transformers` dep is not
 * installed on this device. NEVER throws.
 *
 * Caches the result in-process so subsequent calls are O(1).
 */
export async function loadOnDeviceModel(
  options: ModelLoaderOptions = {},
): Promise<OnDevicePipeline | null> {
  if (options.fixedPipeline) {
    return options.fixedPipeline;
  }
  // Honour cache, but only when no test seams are in play.
  if (cachedPipeline !== undefined && !options.importPipeline) {
    return cachedPipeline;
  }
  if (!isModelOnDisk(options.modelRoot)) {
    cachedPipeline = null;
    return null;
  }
  try {
    const factory = options.importPipeline ?? defaultImportPipeline;
    const pipeline = await factory();
    cachedPipeline = pipeline;
    return pipeline;
  } catch {
    // Optional dep missing, wrong arch, ABI mismatch — fall through.
    cachedPipeline = null;
    return null;
  }
}

/**
 * Reset the in-process cache. Useful for tests + for runtime reloads
 * if the operator hot-swaps the model bundle on disk.
 */
export function resetModelCache(): void {
  cachedPipeline = undefined;
}

/**
 * Default importer for `@xenova/transformers`. Pulled out so tests can
 * swap it. Wrapped in `Function('...')` so static analysers don't try
 * to resolve the dep at build time — it is intentionally optional.
 */
async function defaultImportPipeline(): Promise<OnDevicePipeline | null> {
  try {
    // Dynamic, indirect import — keeps the dep out of the package's
    // bundle graph. Callers wanting the on-device path install
    // `@xenova/transformers` themselves in the consuming app.
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier);',
    ) as (s: string) => Promise<unknown>;
    const mod = (await dynamicImport('@xenova/transformers')) as {
      pipeline?: (
        task: string,
        model: string,
      ) => Promise<(input: string) => Promise<unknown>>;
    };
    if (typeof mod.pipeline !== 'function') return null;
    const extractor = await mod.pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
    );
    return {
      modelId: 'MiniLM-L6-v2-q8',
      classify: async (text: string) => {
        // The shipped MiniLM is a generic embedding model — Borjie's
        // routing head is a thin softmax learned offline. Until that
        // head ships, we return a deterministic medium-confidence
        // null so the fallback engages without noisy false positives.
        await extractor(text);
        return { toolId: null, confidence: 0.0 };
      },
    };
  } catch {
    return null;
  }
}
