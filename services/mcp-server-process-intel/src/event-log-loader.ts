/**
 * Event-log loader — converts BORJIE event-bus messages into the
 * shape pm4py expects (either XES-style XML or a flat CSV with the
 * canonical `case:concept:name` / `concept:name` / `time:timestamp`
 * columns).
 *
 * The loader is pure (no I/O of its own) — it accepts a batch of
 * `EventLogRecord`s and returns either a CSV string or a structured
 * JSON envelope ready to ship to the sidecar over stdin.
 *
 * Why CSV-by-default: pm4py's CSV importer is far cheaper to parse than
 * XES for tenant-scoped slices (typically <100k rows), and it keeps the
 * sidecar memory-footprint predictable.
 */

import type { EventLogBatch, EventLogRecord } from './types.js';

export interface NormalisedEventLog {
  readonly tenantId: string;
  readonly processId: string;
  readonly format: 'csv';
  readonly payload: string;
  readonly caseCount: number;
  readonly eventCount: number;
}

const CSV_HEADER = [
  'case:concept:name',
  'concept:name',
  'time:timestamp',
  'org:resource',
] as const;

export function normaliseEventLog(batch: EventLogBatch): NormalisedEventLog {
  if (!batch.tenantId) {
    throw new Error('normaliseEventLog: tenantId required');
  }
  if (!batch.processId) {
    throw new Error('normaliseEventLog: processId required');
  }

  const events = batch.events ?? [];
  const cases = new Set<string>();
  const attributeKeys = collectAttributeKeys(events);
  const header = [...CSV_HEADER, ...attributeKeys];
  const rows: string[] = [header.join(',')];

  for (const event of events) {
    validateEvent(event);
    cases.add(event.caseId);
    const row = [
      csvEscape(event.caseId),
      csvEscape(event.activity),
      csvEscape(event.timestamp),
      csvEscape(event.resource ?? ''),
      ...attributeKeys.map((k) =>
        csvEscape(formatAttr(event.attributes?.[k])),
      ),
    ];
    rows.push(row.join(','));
  }

  return Object.freeze({
    tenantId: batch.tenantId,
    processId: batch.processId,
    format: 'csv' as const,
    payload: rows.join('\n'),
    caseCount: cases.size,
    eventCount: events.length,
  });
}

function validateEvent(event: EventLogRecord): void {
  if (!event.caseId) {
    throw new Error('event-log-loader: caseId is required on every event');
  }
  if (!event.activity) {
    throw new Error('event-log-loader: activity is required on every event');
  }
  if (!event.timestamp) {
    throw new Error('event-log-loader: timestamp is required on every event');
  }
  if (Number.isNaN(Date.parse(event.timestamp))) {
    throw new Error(
      `event-log-loader: invalid ISO timestamp "${event.timestamp}"`,
    );
  }
}

function collectAttributeKeys(
  events: ReadonlyArray<EventLogRecord>,
): ReadonlyArray<string> {
  const set = new Set<string>();
  for (const event of events) {
    const attrs = event.attributes;
    if (!attrs) continue;
    for (const key of Object.keys(attrs)) set.add(key);
  }
  return [...set].sort();
}

function formatAttr(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function csvEscape(raw: string): string {
  if (raw === '') return '';
  const needsQuoting = /[",\n\r]/.test(raw);
  const escaped = raw.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}
