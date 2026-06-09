'use client';

/**
 * GenUIRecordsList — renders the persisted records for a generated tab as a
 * compact, generative table.
 *
 * Driven by `useGenuiRecords(tabId)` (the K1a `/records` contract). Columns
 * are derived from the union of payload keys across the returned records, so a
 * brand-new generated tab lists its own records with zero per-tab code. Honest
 * loading / empty / error states; all literal copy flows through `t()`
 * (owner-web locale-purity).
 */

import { type ReactElement } from 'react';
import type { TFn } from '@/i18n/resolve';

import { useGenuiRecords, type GenuiRecord } from '@/lib/queries/genui-records';
import { toSafeText } from './sanitize';

interface GenUIRecordsListProps {
  readonly tabId: string;
  readonly t: TFn;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return toSafeText(String(value));
}

/** Union of payload keys across all records → stable column order. */
function deriveColumns(records: ReadonlyArray<GenuiRecord>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record.payload)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

export function GenUIRecordsList({
  tabId,
  t,
}: GenUIRecordsListProps): ReactElement {
  const query = useGenuiRecords(tabId);

  if (query.isLoading) {
    return (
      <p className="text-sm text-neutral-400">{t('genuiTab.recordsLoading')}</p>
    );
  }
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">{t('genuiTab.recordsError')}</p>
    );
  }
  const records = query.data ?? [];
  if (records.length === 0) {
    return (
      <p className="text-sm text-neutral-400">{t('genuiTab.recordsEmpty')}</p>
    );
  }

  const columns = deriveColumns(records);
  return (
    <div className="flex flex-col gap-2" data-testid="genui-records-list">
      <h4 className="text-sm font-semibold text-foreground">
        {t('genuiTab.recordsHeading')}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="border-b border-border px-2 py-1 font-medium text-neutral-300"
                >
                  {toSafeText(col)}
                </th>
              ))}
              <th className="border-b border-border px-2 py-1 font-medium text-neutral-300">
                {t('genuiTab.recordCreatedAt', { at: '' }).trim()}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id} className="border-b border-border/50">
                {columns.map((col) => (
                  <td key={col} className="px-2 py-1 text-neutral-200">
                    {cellText(record.payload[col])}
                  </td>
                ))}
                <td className="px-2 py-1 text-neutral-400">
                  {cellText(record.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
