'use client';

/**
 * Legacy LPMS migration — migrated from
 * apps/admin-portal/src/pages/LegacyMigration.tsx.
 *
 *   POST /api/v1/lpms/import         — preview / commit
 *   GET  /api/v1/lpms/preview-schema
 */

import { useCallback, useEffect, useState } from 'react';
import { UploadCloud, Loader2, FileCheck2 } from 'lucide-react';
import { api } from '@/lib/api';

type Format = 'csv' | 'json' | 'xml';

interface PreviewResult {
  readonly format: Format;
  readonly tenantId: string;
  readonly counts: Record<string, number>;
  readonly issues?: readonly string[];
}

export function LegacyMigrationClient() {
  const [format, setFormat] = useState<Format>('csv');
  const [content, setContent] = useState('');
  const [schema, setSchema] = useState<unknown>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);
  const [confirmingCommit, setConfirmingCommit] = useState(false);

  useEffect(() => {
    api.get<unknown>('/lpms/preview-schema').then((res) => {
      if (res.success) setSchema(res.data);
    });
  }, []);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    const text = await file.text();
    setContent(text);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv' || ext === 'json' || ext === 'xml') setFormat(ext);
  }, []);

  async function doPreview(): Promise<void> {
    if (!content) return;
    setLoading(true);
    setError(null);
    const res = await api.post<PreviewResult>('/lpms/import', {
      format,
      content,
      commit: false,
      bestEffort: true,
    });
    setLoading(false);
    if (res.success && res.data) setPreview(res.data);
    else setError(res.error ?? 'Preview failed');
  }

  async function commit(): Promise<void> {
    if (!content) return;
    setConfirmingCommit(false);
    setCommitted(false);
    setLoading(true);
    setError(null);
    const res = await api.post<PreviewResult>('/lpms/import', {
      format,
      content,
      commit: true,
    });
    setLoading(false);
    if (res.success && res.data) {
      setPreview(res.data);
      setCommitted(true);
    } else {
      setError(res.error ?? 'Commit failed');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <UploadCloud className="h-6 w-6 text-indigo-400" />
        <p className="text-sm text-neutral-400">
          Upload a legacy LPMS export, preview the inferred records, and commit
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
              if (f) void handleFile(f);
            }}
            className="mt-1 w-full text-sm text-foreground"
            data-testid="lpms-upload"
          />
        </label>

        <div className="flex items-center gap-3">
          <label className="text-sm text-neutral-300">
            Format:
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
              className="ml-2 rounded border border-border bg-surface-sunken px-2 py-1 text-sm text-foreground"
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="xml">XML</option>
            </select>
          </label>
          <span className="text-xs text-neutral-500">
            {content
              ? `${content.length.toLocaleString()} characters loaded`
              : 'No file selected'}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void doPreview()}
            disabled={!content || loading}
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
            disabled={!content || loading || !preview || confirmingCommit}
            className="rounded border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-300 disabled:opacity-50"
          >
            Commit
          </button>
        </div>

        {confirmingCommit && (
          <div
            role="alertdialog"
            aria-labelledby="lpms-commit-confirm-title"
            className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
          >
            <p id="lpms-commit-confirm-title" className="font-medium">
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

      {preview && (
        <section className="rounded-xl border border-emerald-500/30 bg-surface p-5 space-y-2">
          <h3 className="flex items-center gap-2 font-display text-foreground">
            <FileCheck2 className="h-4 w-4 text-emerald-400" /> Preview
          </h3>
          <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            {Object.entries(preview.counts).map(([k, v]) => (
              <li
                key={k}
                className="rounded bg-emerald-500/10 p-2 text-emerald-300"
              >
                <span className="font-semibold">{v}</span> {k}
              </li>
            ))}
          </ul>
          {preview.issues && preview.issues.length > 0 && (
            <details className="text-xs text-neutral-400">
              <summary className="cursor-pointer text-amber-400">
                {preview.issues.length} issue(s)
              </summary>
              <ul className="ml-5 mt-2 list-disc">
                {preview.issues.map((msg, idx) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {schema !== null && (
        <details className="platform-card text-sm text-neutral-300">
          <summary className="cursor-pointer font-medium">Target schema</summary>
          <pre className="mt-3 overflow-x-auto text-xs text-neutral-400">
            {JSON.stringify(schema, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
