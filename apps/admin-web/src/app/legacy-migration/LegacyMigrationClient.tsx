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
 *
 * Rendered on design-system primitives + semantic tokens. The hand-rolled
 * `role="alertdialog"` commit confirm is now a focus-trapped DS Modal.
 * SINGLE LANGUAGE PER LOCALE (canon): every user-facing string resolves to
 * the active locale via `pickByLocale`. Purely client surface — the hook
 * falls back to the project default and the post-mount effect corrects it.
 */

import { useCallback, useState } from 'react';
import { UploadCloud, FileCheck2 } from 'lucide-react';
import { Button, Card, Alert, FormField } from '@borjie/design-system';
import { ConfirmModal } from '@/components/internal/ConfirmModal';
import { api } from '@/lib/api';
import { useLocale, pickByLocale } from '@/lib/locale';

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

const S = {
  intro: {
    en: 'Upload a legacy export, review the extracted records, and commit when satisfied.',
    sw: 'Pakia uhamishaji wa zamani, kagua rekodi zilizotolewa, na thibitisha ukiridhika.',
  },
  uploadFailed: { en: 'Upload failed', sw: 'Upakiaji umeshindwa' },
  commitFailed: { en: 'Commit failed', sw: 'Uthibitishaji umeshindwa' },
  committed: { en: 'Import committed.', sw: 'Uingizaji umethibitishwa.' },
  fileLabel: { en: 'File (.csv / .json / .xml)', sw: 'Faili (.csv / .json / .xml)' },
  noFile: { en: 'No file selected', sw: 'Hakuna faili lililochaguliwa' },
  run: { en: 'Run', sw: 'Mzunguko' },
  preview: { en: 'Preview', sw: 'Onyesho la awali' },
  commit: { en: 'Commit', sw: 'Thibitisha' },
  confirmTitle: {
    en: 'Commit this import?',
    sw: 'Thibitisha uingizaji huu?',
  },
  confirmBody: {
    en: 'Commit this import? This action cannot be undone.',
    sw: 'Thibitisha uingizaji huu? Kitendo hiki hakiwezi kutenduliwa.',
  },
  confirmCommit: { en: 'Confirm commit', sw: 'Thibitisha uthibitishaji' },
  cancel: { en: 'Cancel', sw: 'Ghairi' },
  extracted: { en: 'Extracted records', sw: 'Rekodi zilizotolewa' },
  warnings: { en: 'warning(s)', sw: 'onyo(/maonyo)' },
  bytes: { en: 'bytes', sw: 'baiti' },
} as const;

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
  const locale = useLocale();
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
      setError(res.error ?? pickByLocale(locale, S.uploadFailed));
    }
  }

  async function commit(): Promise<void> {
    if (!runId) return;
    setConfirmingCommit(false);
    setCommitted(false);
    setLoading(true);
    setError(null);
    const res = await api.post<CommitResult>(`/migration/${runId}/commit`, {});
    setLoading(false);
    if (res.success && res.data?.ok) {
      setCommitted(true);
      setCommittedCounts(res.data.counts ?? null);
    } else {
      setError(res.error ?? pickByLocale(locale, S.commitFailed));
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <UploadCloud className="h-6 w-6 text-info" />
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, S.intro)}
        </p>
      </header>

      {error && <Alert variant="error">{error}</Alert>}

      {committed && (
        <Alert variant="success">
          {pickByLocale(locale, S.committed)}
          {committedCounts ? (
            <span className="ml-2">
              {Object.entries(committedCounts)
                .map(([k, v]) => `${v} ${k}`)
                .join(' · ')}
            </span>
          ) : null}
        </Alert>
      )}

      <Card className="space-y-3 rounded-2xl p-6 transition-colors hover:border-border-strong">
        <FormField label={pickByLocale(locale, S.fileLabel)} name="file">
          <input
            type="file"
            accept=".csv,.json,.xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-sunken file:px-3 file:py-1.5 file:text-sm file:text-foreground"
            data-testid="migration-upload"
          />
        </FormField>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {file
              ? `${file.name} (${file.size.toLocaleString()} ${pickByLocale(locale, S.bytes)})`
              : pickByLocale(locale, S.noFile)}
          </span>
          {runId ? (
            <span className="text-xs text-muted-foreground">
              {pickByLocale(locale, S.run)}{' '}
              <code className="text-muted-foreground">{runId}</code>
            </span>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => void doPreview()}
            disabled={!file}
            loading={loading}
          >
            {pickByLocale(locale, S.preview)}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmingCommit(true)}
            disabled={!runId || loading || confirmingCommit || committed}
          >
            {pickByLocale(locale, S.commit)}
          </Button>
        </div>
      </Card>

      <ConfirmModal
        open={confirmingCommit}
        title={pickByLocale(locale, S.confirmTitle)}
        body={pickByLocale(locale, S.confirmBody)}
        confirmLabel={pickByLocale(locale, S.confirmCommit)}
        cancelLabel={pickByLocale(locale, S.cancel)}
        tone="warn"
        busy={loading}
        onConfirm={() => void commit()}
        onCancel={() => setConfirmingCommit(false)}
      />

      {counts && (
        <Card variant="outline" className="space-y-2 p-5">
          <h3 className="flex items-center gap-2 font-display text-foreground">
            <FileCheck2 className="h-4 w-4 text-success" />{' '}
            {pickByLocale(locale, S.extracted)}
          </h3>
          <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            {Object.entries(counts).map(([k, v]) => (
              <li
                key={k}
                className="rounded bg-success-subtle p-2 text-success"
              >
                <span className="font-semibold">{v}</span> {k}
              </li>
            ))}
          </ul>
          {warnings.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer text-warning">
                {warnings.length} {pickByLocale(locale, S.warnings)}
              </summary>
              <ul className="ml-5 mt-2 list-disc">
                {warnings.map((msg, idx) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}
    </div>
  );
}
