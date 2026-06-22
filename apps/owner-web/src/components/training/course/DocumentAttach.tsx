'use client';

/**
 * <DocumentAttach> — step 3 (optional) of the create-course flow.
 *
 * The operator can attach grounding documents (a licence, a contract, a report)
 * so the generated course leans on their real context. Each row is plain
 * metadata the gateway forwards to the generator as `documentContext`; no file
 * upload happens here. The operator can skip entirely. owner-web dark-theme
 * house style; all copy through `coursesT` (zero Swahili literals).
 */

import { useState } from 'react';
import { Plus, X, FileText } from 'lucide-react';
import { Button, Input, Textarea } from '@borjie/design-system';
import type { CourseLanguage } from '@borjie/api-client/courses-types';
import { coursesT } from '@/i18n/strings/courses';
import { StepActions } from './StepActions';

export interface AttachedDocument {
  readonly documentId: string;
  readonly documentName: string;
  readonly documentType: string;
  readonly summary: string;
}

interface DocumentAttachProps {
  readonly locale: CourseLanguage;
  readonly generating: boolean;
  readonly onBack: () => void;
  readonly onContinue: (documents: ReadonlyArray<AttachedDocument>) => void;
}

interface DraftRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly summary: string;
}

/** Stable client-side id for a draft row (crypto when available). */
function rowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function DocumentAttach({
  locale,
  generating,
  onBack,
  onContinue,
}: DocumentAttachProps) {
  const tr = coursesT(locale);
  const [rows, setRows] = useState<ReadonlyArray<DraftRow>>([]);

  const addRow = () =>
    setRows((prev) => [...prev, { id: rowId(), name: '', type: '', summary: '' }]);

  const updateRow = (id: string, patch: Partial<Omit<DraftRow, 'id'>>) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const submit = () => {
    // Forward only rows the operator actually named (immutable mapping).
    const documents: ReadonlyArray<AttachedDocument> = rows
      .filter((r) => r.name.trim().length > 0)
      .map((r) => ({
        documentId: r.id,
        documentName: r.name.trim(),
        documentType: r.type.trim(),
        summary: r.summary.trim(),
      }));
    onContinue(documents);
  };

  const namedCount = rows.filter((r) => r.name.trim().length > 0).length;

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface/40 p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {tr.t('documentsTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{tr.t('documentsHint')}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          {tr.t('noDocuments')}
        </p>
      ) : (
        <ul className="space-y-3" role="list">
          {rows.map((row) => (
            <li
              key={row.id}
              className="space-y-2 rounded-xl border border-border bg-background p-3"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="text"
                  value={row.name}
                  maxLength={300}
                  onChange={(e) => updateRow(row.id, { name: e.target.value })}
                  aria-label={tr.t('documentNameLabel')}
                  placeholder={tr.t('documentNamePlaceholder')}
                  className="min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  aria-label={tr.t('removeDocument')}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <Input
                type="text"
                value={row.type}
                maxLength={200}
                onChange={(e) => updateRow(row.id, { type: e.target.value })}
                aria-label={tr.t('documentTypeLabel')}
                placeholder={tr.t('documentTypePlaceholder')}
              />
              <Textarea
                value={row.summary}
                rows={2}
                maxLength={4000}
                onChange={(e) => updateRow(row.id, { summary: e.target.value })}
                aria-label={tr.t('documentSummaryLabel')}
                placeholder={tr.t('documentSummaryPlaceholder')}
                className="resize-y"
              />
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        {tr.t('addDocument')}
      </Button>

      <StepActions
        locale={locale}
        onBack={onBack}
        onNext={submit}
        nextKey={namedCount > 0 ? 'generate' : 'skipAndGenerate'}
        busy={generating}
      />
    </section>
  );
}
