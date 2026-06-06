'use client';

/**
 * Legacy data migration — Migration Wizard client.
 *
 * Wired to the live gateway migration router (services/api-gateway/
 * src/routes/migration.router.ts, mounted at /api/v1/migration):
 *
 *   POST /migration/upload          — multipart file → stages a
 *                                      MigrationRun, returns { runId,
 *                                      bundle, warnings }
 *   POST /migration/:runId/commit   — executes the staged run, returns
 *                                      { ok, runId, counts, skipped }
 *
 * The old LPMS endpoints (/lpms/preview-schema, /lpms/import) were
 * deleted in the mining hard-fork — there is no preview-schema endpoint
 * and no JSON import mode. Upload now stages the run server-side and the
 * returned bundle IS the preview; commit then applies it by runId.
 */

import { useCallback, useState } from 'react';
import { UploadCloud, Loader2, FileCheck2 } from 'lucide-react';
import { api } from '@/lib/api';

interface ExtractedBundle {
  readonly properties: ReadonlyArray<unknown>;
  readonly units: ReadonlyArray<unknown>;
  readonly tenants: ReadonlyArray<unknown>;
  readonly employees: ReadonlyArray<unknown>;
  readonly departments: ReadonlyArray<unknown>;
  readonly teams: ReadonlyArray<unknown>;
}

interface UploadResult {
  readonly runId: string;
  readonly bundle: ExtractedBundle;
  readonly warnings?: readonly string[];
}

interface CommitResult {
  readonly ok: boolean;
  readonly runId: string;
  readonly counts?: Record<string, number>;
  readonly skipped?: Record<string, number>;
}

/** Count the rows in each bundle collection for the preview grid. */
function bundleCounts(bundle: ExtractedBundle): Record<string, number> {
  return {
    properties: bundle.properties.length,
    units: bundle.units.length,
    tenants: bundle.tenants.length,
    employees: bundle.employees.length,
    departments: bundle.departments.length,
    teams: bundle.teams.length,
  };
}

export function LegacyMigrationClient() {
  const [file, setFile] = useState<File | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [committedCounts, setCommittedCounts] = useState<Record<
    string,
    number
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);
  const [confirmingCommit, setConfirmingCommit] = useState(false);

  const handleFile = useCallback((picked: File): void => {
    setFile(picked);
    // A fresh file invalidates any staged run.
    setRunId(null);
    setCounts(null);
    setWarnings([]);
    setCommitted(false);
    setCommittedCounts(null);
    setError(null);
  }, []);

  async function doPreview(): Promise<void> {
    if (!file) return;
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    const res = await api.postForm<UploadResult>('/migration/upload', form);
    setLoading(false);
    if (res.success && res.data) {
      setRunId(res.data.runId);
      setCounts(bundleCounts(res.data.bundle));
      setWarnings(res.data.warnings ?? []);
    } else {
      setError(res.error ?? 'Upload failed');
    }
  }

  async function commit(): Promise<void> {
    if (!runId) return;
    setConfirmingCommit(false);
    setCommitted(false);
    setLoading(true);
    setError(null);
    const res = await api.post<CommitResult>(
      `/migration/${runId}/commit`,
      {},
    );
    setLoading(false);
    if (res.success && res.data?.ok) {
      setCommitted(true);
      setCommittedCounts(res.data.counts ?? null);
    } else {
      setError(res.error ?? 'Commit failed');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <UploadCloud className="h-6 w-6 text-indigo-400" />
        <p className="text-sm text-neutral-400">
          Upload a legacy export, review the extracted records, and commit
          when satisfied.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300"
        >
          {error}
        </div>
      )}

      {committed && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300"
        >
          Import committed.
          {committedCounts ? (
            <span className="ml-2 text-emerald-200">
              {Object.entries(committedCounts)
                .map(([k, v]) => `${v} ${k}`)
                .join(' · ')}
            </span>
          ) : null}
        </div>
      )}

      <section className="platform-card space-y-3">
        <label className="block text-sm">
          <span className="text-neutral-300">File (.csv / .json / .xml)</span>
          <input
            type="file"
            accept=".csv,.json,.xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="mt-1 w-full text-sm text-foreground"
            data-testid="migration-upload"
          />
        </label>

        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500">
            {file
              ? `${file.name} (${file.size.toLocaleString()} bytes)`
              : 'No file selected'}
          </span>
          {runId ? (
            <span className="text-xs text-neutral-500">
              Run <code className="text-neutral-400">{runId}</code>
            </span>
          ) : null}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void doPreview()}
            disabled={!file || loading}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            ) : null}
            Preview
          </button>
          <button
            type="button"
            onClick={() => setConfirmingCommit(true)}
            disabled={!runId || loading || confirmingCommit || committed}
            className="rounded border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-300 disabled:opacity-50"
          >
            Commit
          </button>
        </div>

        {confirmingCommit && (
          <div
            role="alertdialog"
            aria-labelledby="migration-commit-confirm-title"
            className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
          >
            <p id="migration-commit-confirm-title" className="font-medium">
              Commit this import? This action cannot be undone.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void commit()}
                disabled={loading}
                className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Confirm commit
              </button>
              <button
                type="button"
                onClick={() => setConfirmingCommit(false)}
                disabled={loading}
                className="rounded border border-amber-500/40 px-3 py-1 text-xs text-amber-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {counts && (
        <section className="rounded-xl border border-emerald-500/30 bg-surface p-5 space-y-2">
          <h3 className="flex items-center gap-2 font-display text-foreground">
            <FileCheck2 className="h-4 w-4 text-emerald-400" /> Extracted records
          </h3>
          <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            {Object.entries(counts).map(([k, v]) => (
              <li
                key={k}
                className="rounded bg-emerald-500/10 p-2 text-emerald-300"
              >
                <span className="font-semibold">{v}</span> {k}
              </li>
            ))}
          </ul>
          {warnings.length > 0 && (
            <details className="text-xs text-neutral-400">
              <summary className="cursor-pointer text-amber-400">
                {warnings.length} warning(s)
              </summary>
              <ul className="ml-5 mt-2 list-disc">
                {warnings.map((msg, idx) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
