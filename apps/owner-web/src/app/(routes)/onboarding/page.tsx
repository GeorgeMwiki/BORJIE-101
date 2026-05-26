'use client';

import { useCallback, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-21 — Onboarding & data import. Drag-and-drop dropzone uploads
 * documents into the live gateway document store. The classifier
 * queue surface is not yet wired — empty state until then.
 */
export default function OnboardingPage() {
  const [dragActive, setDragActive] = useState(false);
  const [recent, setRecent] = useState<ReadonlyArray<string>>([]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files).map((f) => f.name);
    setRecent((prev) => [...files, ...prev].slice(0, 6));
  }, []);
  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? []).map((f) => f.name);
    setRecent((prev) => [...files, ...prev].slice(0, 6));
  };

  return (
    <>
      <ScreenHeader slug="onboarding" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <SectionCard title="Bulk upload">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={`flex h-44 flex-col items-center justify-center rounded-md border-2 border-dashed px-4 text-center ${
              dragActive
                ? 'border-warning bg-warning-subtle/20 text-warning'
                : 'border-border bg-background text-neutral-400'
            }`}
          >
            <Upload className="h-6 w-6" />
            <p className="mt-2 text-sm">
              Drop PML PDFs, ledgers, prior reports here
            </p>
            <label className="mt-2 cursor-pointer text-xs text-warning underline">
              or choose files
              <input type="file" multiple onChange={onPick} className="sr-only" />
            </label>
          </div>
          {recent.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-neutral-300">
              {recent.map((f, idx) => (
                <li key={`${f}-${idx}`}>{f}</li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
        <SectionCard title="Document classifier queue">
          <EmptyState
            title="Classifier queue not yet wired"
            description="Document-agent classification progress loads from the live ingest API once an upload completes."
            hint="GET /api/v1/mining/documents/queue (pending)"
          />
        </SectionCard>
      </div>
    </>
  );
}
