'use client';

import { useCallback, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { ONBOARDING_MOCK } from '@/lib/mocks/commercial';

/**
 * O-W-21 — Onboarding & data import. Polished stub with a real
 * drag-and-drop dropzone (working action) and the queue showing how
 * the Document agent classifies and extracts each file.
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
                <li key={`${f}-${idx}`}>· {f}</li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
        <SectionCard title="Document classifier queue">
          <ul className="space-y-2 text-sm">
            {ONBOARDING_MOCK.uploadQueue.map((q) => (
              <li
                key={q.file}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
              >
                <div>
                  <div className="text-foreground">{q.file}</div>
                  <div className="text-xs text-neutral-500">
                    {q.type} · {q.confidence === null ? 'queued' : `confidence ${(q.confidence * 100).toFixed(0)}%`}
                  </div>
                </div>
                <span
                  className={`pill ${
                    q.status === 'classified' || q.status === 'extracted'
                      ? 'pill-green'
                      : 'pill-amber'
                  }`}
                >
                  {q.status}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
