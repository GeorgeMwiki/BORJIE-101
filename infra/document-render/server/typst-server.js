// Typst HTTP wrapper — accepts a source path or inline source +
// inputs, spawns `typst compile`, streams the PDF back.
//
// Contract (matches TypstRenderer.serverRender):
//   POST /compile
//     body  { source: string, inputs?: Record<string, unknown> }
//             — `source` is either an absolute path to a `.typ` file
//               inside the templates volume, or the inline source code
//               (auto-detected: starts with `/` → path, else inline).
//             — `inputs` are exposed to the template as `sys.inputs.*`.
//     200   application/pdf
//     5xx   text/plain typst stderr
//   GET  /health   → 200 ok (liveness — process is up)
//   GET  /readyz   → 200 ok if `typst --version` succeeded at boot, 503 otherwise
//   GET  /metrics  → Prometheus exposition (same port; K8s ServiceMonitor scrapes it)
//
// Refs:
//   - https://typst.app/docs/reference/foundations/sys/
//   - https://github.com/typst/typst (CLI)

import express from 'express';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  attachMetricsEndpoint,
  attachMetricsMiddleware,
  createMetricsRegistry,
} from './metrics.js';

const TYPST_BIN = process.env.TYPST_BINARY ?? '/usr/local/bin/typst';

/**
 * Probe the typst binary once at boot. Returns a frozen state object
 * describing whether the binary is usable. We cache the result so the
 * /readyz probe doesn't shell out on every K8s scrape (every 5–10s).
 */
export function probeTypstBinary(binary = TYPST_BIN) {
  try {
    const result = spawnSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    if (result.error) {
      return { ready: false, reason: `spawn error: ${result.error.message}` };
    }
    if (result.status !== 0) {
      return {
        ready: false,
        reason: `typst --version exit ${result.status}: ${result.stderr?.trim() ?? ''}`,
      };
    }
    return { ready: true, version: result.stdout.trim() };
  } catch (err) {
    return { ready: false, reason: `probe threw: ${err.message ?? String(err)}` };
  }
}

/**
 * Build (without binding) the typst server. Tests inject `readyState`
 * to drive the /readyz branch without needing the binary on disk.
 */
export function buildTypstApp(opts = {}) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const metrics = createMetricsRegistry('typst');
  attachMetricsMiddleware(app, metrics);

  // Boot-time probe. Tests pass `opts.readyState` to skip the real
  // binary call when typst isn't installed in the test environment.
  const readyState = opts.readyState ?? probeTypstBinary();

  app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'typst' }));

  app.get('/readyz', (_req, res) => {
    if (readyState.ready) {
      return res.status(200).json({
        ready: true,
        service: 'typst',
        version: readyState.version,
      });
    }
    return res.status(503).json({
      ready: false,
      service: 'typst',
      reason: readyState.reason ?? 'unknown',
    });
  });

  attachMetricsEndpoint(app, metrics);

  app.post('/compile', async (req, res) => {
    const { source, inputs } = req.body ?? {};
    if (typeof source !== 'string' || source.length === 0) {
      return res.status(400).type('text/plain').send('missing source');
    }

    const tempDir = await mkdtemp(path.join(tmpdir(), 'typst-'));
    let inputPath = source;
    try {
      if (!source.startsWith('/')) {
        // Inline source — write to a temp file so `typst compile` can find it.
        inputPath = path.join(tempDir, 'in.typ');
        await writeFile(inputPath, source, 'utf8');
      }

      const args = ['compile', inputPath, '-'];
      if (inputs && typeof inputs === 'object') {
        for (const [k, v] of Object.entries(inputs)) {
          args.push('--input', `${k}=${JSON.stringify(v)}`);
        }
      }

      const child = spawn(TYPST_BIN, args, { cwd: tempDir });
      const stdoutChunks = [];
      const stderrChunks = [];
      child.stdout.on('data', (c) => stdoutChunks.push(c));
      child.stderr.on('data', (c) => stderrChunks.push(c));
      child.on('error', (err) => {
        res.status(500).type('text/plain').send(`spawn failed: ${err.message}`);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          return res
            .status(500)
            .type('text/plain')
            .send(Buffer.concat(stderrChunks).toString('utf8') || `exit ${code}`);
        }
        res
          .status(200)
          .type('application/pdf')
          .end(Buffer.concat(stdoutChunks));
      });
    } finally {
      // Tidy up the temp dir async — don't block the response.
      rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return { app, metrics, readyState };
}

export function startTypst(port) {
  const { app, readyState } = buildTypstApp();
  if (!readyState.ready) {
    console.warn(
      `[typst] readyz will return 503 until restart — boot probe failed: ${readyState.reason}`,
    );
  }
  return app.listen(port, () => {
    console.log(`[typst] listening on :${port}`);
  });
}
