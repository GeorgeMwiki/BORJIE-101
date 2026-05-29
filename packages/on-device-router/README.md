# @borjie/on-device-router

**Status:** SHIPPED 2026-05-29 — R-FUTURE-1 closure. Real router
pipeline + lazy MiniLM loader + server fallback. The 22 MB ONNX bundle
remains an **operator-action** (OA-016) — the package ships with a
research-stub runtime that falls through to the server router whenever
the bundle is absent OR the optional dep is missing.

## Two callable seams

### 1. `routeOnDevice(text, options)` — synchronous, legacy seam

Returns `{ toolId: null, confidence: 0, inferMs: 0, modelId: 'stub' }`
so the server-side routing path stays canonical. Preserved for callers
that need a zero-await routing slot inside a React render.

### 2. `routeOnDeviceAsync(text, opts)` — the real pipeline

```ts
import { routeOnDeviceAsync } from '@borjie/on-device-router';
import { createLogger } from '@borjie/observability';

const log = createLogger({ service: 'workforce-mobile', logLevel: 'info', /* ... */ });

const decision = await routeOnDeviceAsync(prompt, {
  fallback: {
    baseUrl: process.env.BORJIE_API_URL,
    authToken: jwt,
    logger: log.getPino(),
  },
  language: 'sw',
  logger: log.getPino(),
});

if (decision.path === 'on-device') {
  // Saved a server round-trip — confidence >= 0.6.
} else {
  // Server-router decision; the on-device path was skipped or low-confidence.
}
```

Decision tree:

1. Are the four ONNX files present at `~/.borjie-models/minilm-l6-v2/`?
   - No → Pino `warn` (`reason: model-not-on-disk`), fall through to server.
2. Does `@xenova/transformers` resolve via dynamic import?
   - No → Pino `warn` (`reason: optional-dep-missing`), fall through to server.
3. Does the pipeline return `confidence >= 0.6` (configurable)?
   - No → Pino `info` (`reason: low-confidence`), fall through with `routerHint`.
4. Yes → return the on-device decision (`path: 'on-device'`).

## Operator setup (OA-016) — model bundle

Download once per device. Linux / macOS:

```bash
mkdir -p ~/.borjie-models/minilm-l6-v2
cd ~/.borjie-models/minilm-l6-v2
curl -L -o model.onnx \
  https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx
curl -L -o tokenizer.json \
  https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json
curl -L -o tokenizer_config.json \
  https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json
curl -L -o config.json \
  https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json
```

Then install the optional dep in the consuming app (NOT in this
package — kept out of the bundle graph):

```bash
pnpm -F @borjie/workforce-mobile add @xenova/transformers
```

To override the path (CI / containers), set `BORJIE_MODELS_PATH` —
the loader will look under `${BORJIE_MODELS_PATH}/minilm-l6-v2/`.

## Tests

```bash
pnpm -F @borjie/on-device-router test
```

The suite covers six paths: missing files, missing dep, on-device hit,
low-confidence hint, fetch-error, and loader cache.

## Bilingual sentinel

```ts
import { ON_DEVICE_ROUTER_STATUS } from '@borjie/on-device-router';
// { en: 'STUB. On-device routing is disabled…',
//   sw: 'STUB. Uchaguzi wa kifaa umezimwa…' }
```

The async pipeline is the canonical path going forward.

## References

- Research doc: `Docs/RESEARCH/mobile-onload-intelligence.md` §9.4
- Roadmap closure entry: `Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md` R-FUTURE-1
- Operator action: `Docs/OPS/OPERATOR_ACTION_LIST.md` OA-016
