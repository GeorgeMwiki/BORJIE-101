'use client';

/**
 * TabSnapshotShell — what an asleep / waking tab looks like.
 *
 * Wave OWNER-OS-DYNAMIC Phase 2.
 *
 * When a tab is asleep, this shell renders a low-weight placeholder that
 * mirrors the panel's previous shape (pulled from the snapshot in
 * localStorage). Borjie DNA: navy bg-card, hairline border, gold accent,
 * cream text — never LitFin orange.
 *
 * Three modes:
 *   - sleeping (default): static placeholder.
 *   - waking: same shape with a tiny "Waking up" caption + subtle pulse.
 *
 * Snapshots are advisory. When none exists (first sleep), we render a
 * generic 3-row skeleton so the strip never collapses to zero height.
 */

import type { ReactElement } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

import type { TabSnapshotData } from './useTabSnapshot';

type Accent = 'navy' | 'gold' | 'cream';

const accentRing: Record<Accent, string> = {
  navy: 'border-border',
  gold: 'border-warning/40',
  cream: 'border-border',
};

const accentDot: Record<Accent, string> = {
  navy: 'bg-neutral-500',
  gold: 'bg-warning',
  cream: 'bg-neutral-400',
};

export interface TabSnapshotShellProps {
  readonly title: string;
  readonly languagePreference: 'sw' | 'en';
  readonly snapshot: TabSnapshotData | null;
  readonly accent: Accent;
  readonly mode?: 'sleeping' | 'waking';
}

function captionFor(
  lang: 'sw' | 'en',
  mode: 'sleeping' | 'waking',
): string {
  if (mode === 'waking') {
    return lang === 'sw' ? 'Inarudisha mtazamo…' : 'Restoring view…';
  }
  return lang === 'sw'
    ? 'Imepumzika, data ya nyuma inabaki kwa Bw. Mwikila'
    : 'Asleep — Mr. Mwikila still tracks this tab in the background';
}

function snapshotLines(
  snapshot: TabSnapshotData | null,
): ReadonlyArray<{ label: string; value?: string }> {
  if (!snapshot) {
    return [
      { label: '——————' },
      { label: '————————————' },
      { label: '——————————' },
    ];
  }
  const payload = snapshot.payload;
  if (payload['truncated']) {
    return [{ label: '———————————————' }];
  }
  const lines: Array<{ label: string; value?: string }> = [];
  for (const [key, value] of Object.entries(payload).slice(0, 4)) {
    if (typeof value === 'string' || typeof value === 'number') {
      lines.push({ label: key, value: String(value) });
    } else if (Array.isArray(value)) {
      lines.push({ label: key, value: `${value.length} item${value.length === 1 ? '' : 's'}` });
    }
  }
  return lines.length > 0 ? lines : [{ label: 'snapshot' }];
}

export function TabSnapshotShell({
  title,
  languagePreference,
  snapshot,
  accent,
  mode = 'sleeping',
}: TabSnapshotShellProps): ReactElement {
  const lines = snapshotLines(snapshot);
  return (
    <Card
      variant="outline"
      padding="md"
      className={`${accentRing[accent]} ${mode === 'waking' ? 'animate-pulse' : ''}`}
      data-testid="owner-os-tab-snapshot"
      aria-hidden={mode === 'sleeping'}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${accentDot[accent]}`}
            aria-hidden="true"
          />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-xs text-neutral-400">
          {lines.map((line, idx) => (
            <li
              key={`${line.label}-${idx}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate">{line.label}</span>
              {line.value ? (
                <span className="tabular-nums text-neutral-300">{line.value}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-tiny text-neutral-500">
          {captionFor(languagePreference, mode)}
        </p>
      </CardContent>
    </Card>
  );
}
