'use client';

/**
 * OwnerOSDraftsPanel — list available draft templates and one-tap
 * compose. Renders the resulting markdown inline; the existing
 * `/api/v1/mining/drafts/:id/render` route can be wired for PDF later.
 *
 * Wave OWNER-OS. Templates resolve to the four spec-named forms:
 *   royalty-return · nemc-eia-cover · bot-gold-export · brela-renewal.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { FileSignature, Sparkles } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

interface TemplateRow {
  readonly id: string;
  readonly slug: string;
  readonly kind: string;
  readonly titleSw: string;
  readonly titleEn: string;
}

interface DraftRow {
  readonly draftId: string;
  readonly templateId: string;
  readonly status: string;
  readonly contentMd: string;
  readonly titleEn?: string | null;
  readonly titleSw?: string | null;
  readonly createdAt?: string;
}

export interface OwnerOSDraftsPanelProps {
  readonly languagePreference: 'sw' | 'en';
}

export function OwnerOSDraftsPanel({
  languagePreference,
}: OwnerOSDraftsPanelProps): ReactElement {
  const [templates, setTemplates] = useState<ReadonlyArray<TemplateRow>>([]);
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<{ templates: ReadonlyArray<TemplateRow> }>(
          `/api/v1/owner/forms/templates`,
        );
        setTemplates(res.templates ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Load failed');
      }
    })();
  }, []);

  async function compose(templateId: string): Promise<void> {
    setDrafting(templateId);
    setError(null);
    try {
      const res = await apiRequest<DraftRow>(`/api/v1/owner/forms/draft`, {
        method: 'POST',
        body: {
          templateId,
          language: languagePreference,
          fillVars: {},
        },
      });
      setDraft(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Draft failed');
    } finally {
      setDrafting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="owner-os-drafts-panel">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-warning">
          {languagePreference === 'sw' ? 'Andika fomu' : 'Draft a form'}
        </h2>
        <span className="text-tiny text-neutral-500">
          {languagePreference === 'sw'
            ? 'Mr. Mwikila atatumia muktadha wako wa hivi karibuni'
            : 'Mr. Mwikila will use your recent context'}
        </span>
      </header>

      {error ? (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-tiny text-destructive">
          {error}
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {templates.map((t) => (
          <li
            key={t.id}
            data-testid={`owner-os-form-${t.id}`}
            className="flex items-center justify-between gap-3 rounded border border-border bg-surface/40 px-3 py-2"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <FileSignature aria-hidden="true" className="h-4 w-4 text-warning" />
              <p className="truncate text-sm">
                {languagePreference === 'sw' ? t.titleSw : t.titleEn}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void compose(t.id)}
              disabled={drafting === t.id}
              className="inline-flex items-center gap-1 rounded border border-warning bg-warning/10 px-2 py-1 text-tiny font-medium text-warning hover:bg-warning/20 disabled:opacity-50"
            >
              <Sparkles aria-hidden="true" className="h-3 w-3" />
              {drafting === t.id
                ? languagePreference === 'sw'
                  ? 'Inaandika…'
                  : 'Drafting…'
                : languagePreference === 'sw'
                  ? 'Andika'
                  : 'Draft'}
            </button>
          </li>
        ))}
      </ul>

      {draft ? (
        <article
          data-testid="owner-os-draft-preview"
          className="rounded border border-warning/40 bg-warning/5 p-3"
        >
          <header className="mb-2 text-xs font-semibold text-warning">
            {languagePreference === 'sw' ? draft.titleSw : draft.titleEn}
          </header>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground">
            {draft.contentMd}
          </pre>
        </article>
      ) : null}
    </div>
  );
}
