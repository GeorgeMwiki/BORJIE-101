'use client';

/**
 * Ore-stockpile warehouse — Borjie mining domain.
 *
 * Reshaped from the property maintenance/hardware inventory to the mining
 * ore-stockpile capability backed by `ore_stockpiles` + `ore_grade_snapshots`:
 *
 *   GET    /api/v1/warehouse/stockpiles
 *   POST   /api/v1/warehouse/stockpiles
 *   GET    /api/v1/warehouse/stockpiles/:id/transfers   (custody history)
 *   POST   /api/v1/warehouse/stockpiles/:id/transfers   (custody hand-over)
 *
 * Mass is tonnage (kg), not money — so it is NEVER rendered via
 * formatCurrency; grade is a headline percentage from the latest snapshot.
 */

import { useCallback, useEffect, useState } from 'react';
import { Mountain, Plus, Loader2, ArrowRightLeft } from 'lucide-react';
import { api } from '@/lib/api';

type LocationKind = 'site' | 'warehouse' | 'in_transit';

const LOCATION_KINDS: readonly LocationKind[] = [
  'site',
  'warehouse',
  'in_transit',
];

const LOCATION_LABEL: Record<LocationKind, string> = {
  site: 'On site',
  warehouse: 'External warehouse',
  in_transit: 'In transit',
};

interface Stockpile {
  readonly id: string;
  readonly parcelId: string;
  readonly siteId: string | null;
  readonly locationKind: LocationKind;
  readonly locationRef: string | null;
  readonly quantityKg: number;
  readonly custodianUserId: string | null;
  readonly gradePct: number | null;
  readonly targetCustomerFit: string | null;
  readonly storedAt: string;
}

interface CustodyEvent {
  readonly id: string;
  readonly ts: string;
  readonly fromUserId: string | null;
  readonly toUserId: string | null;
  readonly toLocationKind: string | null;
  readonly toLocationRef: string | null;
}

/** Render tonnage (kg). Mass is not currency — locale digits only. */
function formatKg(kg: number): string {
  return `${new Intl.NumberFormat('en', {
    maximumFractionDigits: 0,
  }).format(kg)} kg`;
}

function formatGrade(gradePct: number | null): string {
  if (gradePct == null) return '—';
  return `${new Intl.NumberFormat('en', {
    maximumFractionDigits: 2,
  }).format(gradePct)}%`;
}

export function WarehouseClient() {
  const [stockpiles, setStockpiles] = useState<readonly Stockpile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'create' | 'transfer' | null>(null);
  const [selected, setSelected] = useState<Stockpile | null>(null);
  const [events, setEvents] = useState<readonly CustodyEvent[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await api.get<readonly Stockpile[]>('/warehouse/stockpiles');
    if (res.success && res.data) setStockpiles(res.data);
    else setError(res.error ?? 'Failed to load stockpiles');
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectStockpile = useCallback(async (pile: Stockpile) => {
    setSelected(pile);
    const res = await api.get<readonly CustodyEvent[]>(
      `/warehouse/stockpiles/${encodeURIComponent(pile.id)}/transfers`,
    );
    if (res.success && res.data) setEvents(res.data);
    else setEvents([]);
  }, []);

  const totalKg = stockpiles.reduce((sum, p) => sum + (p.quantityKg ?? 0), 0);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mountain className="h-6 w-6 text-amber-400" />
          <div>
            <p className="text-sm text-neutral-400">
              Ore stockpiles across every site, external warehouse, and
              in-transit lot — tonnage, grade, and chain of custody.
            </p>
            {!loading && stockpiles.length > 0 && (
              <p className="mt-0.5 text-xs text-neutral-500">
                {stockpiles.length} stockpile
                {stockpiles.length === 1 ? '' : 's'} · {formatKg(totalKg)} total
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDrawer('create')}
          className="inline-flex items-center gap-2 rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> Register stockpile
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && stockpiles.length === 0 && !error && (
        <div className="platform-card text-sm text-neutral-400">
          No stockpiles yet.
        </div>
      )}

      {!loading && stockpiles.length > 0 && (
        <section className="platform-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-2">Parcel</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Ref</th>
                <th className="px-3 py-2">Tonnage</th>
                <th className="px-3 py-2">Grade</th>
                <th className="px-3 py-2">Best-fit buyer</th>
                <th className="px-3 py-2">Custodian</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {stockpiles.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-border/40 text-neutral-200"
                >
                  <td className="px-3 py-2 font-mono text-xs">{p.parcelId}</td>
                  <td className="px-3 py-2">
                    {LOCATION_LABEL[p.locationKind] ?? p.locationKind}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">
                    {p.locationRef ?? '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatKg(p.quantityKg)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatGrade(p.gradePct)}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">
                    {p.targetCustomerFit ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                    {p.custodianUserId ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(p);
                          setDrawer('transfer');
                        }}
                        className="text-xs text-amber-400 hover:underline"
                      >
                        Transfer
                      </button>
                      <button
                        type="button"
                        onClick={() => void selectStockpile(p)}
                        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                      >
                        <ArrowRightLeft className="h-3 w-3" /> Custody
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {selected && drawer !== 'transfer' && (
        <section className="platform-card">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-foreground">
              Chain of custody — parcel {selected.parcelId}
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-neutral-500"
            >
              Close
            </button>
          </div>
          {events.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-400">
              No custody hand-overs recorded yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex justify-between py-1 text-neutral-200"
                >
                  <span>
                    <span className="font-mono text-xs text-neutral-400">
                      {e.fromUserId ?? '∅'}
                    </span>
                    {' → '}
                    <span className="font-mono text-xs text-neutral-200">
                      {e.toUserId ?? '∅'}
                    </span>
                    {e.toLocationKind && (
                      <span className="text-neutral-500">
                        {' · '}
                        {LOCATION_LABEL[e.toLocationKind as LocationKind] ??
                          e.toLocationKind}
                        {e.toLocationRef ? ` (${e.toLocationRef})` : ''}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {new Date(e.ts).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {drawer === 'create' && (
        <CreateStockpileDrawer
          onClose={() => setDrawer(null)}
          onCreated={() => {
            setDrawer(null);
            void reload();
          }}
        />
      )}

      {drawer === 'transfer' && selected && (
        <TransferDrawer
          stockpile={selected}
          onClose={() => {
            setDrawer(null);
            setSelected(null);
          }}
          onTransferred={() => {
            setDrawer(null);
            setSelected(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Register stockpile drawer
// ----------------------------------------------------------------------------

interface CreateFormState {
  readonly parcelId: string;
  readonly siteId: string;
  readonly locationKind: LocationKind;
  readonly locationRef: string;
  readonly quantityKg: string;
}

const EMPTY_CREATE: CreateFormState = {
  parcelId: '',
  siteId: '',
  locationKind: 'site',
  locationRef: '',
  quantityKg: '0',
};

function CreateStockpileDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateFormState>(EMPTY_CREATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const res = await api.post('/warehouse/stockpiles', {
      parcelId: form.parcelId,
      siteId: form.siteId || null,
      locationKind: form.locationKind,
      locationRef: form.locationRef || null,
      quantityKg: Number(form.quantityKg) || 0,
    });
    setSaving(false);
    if (res.success) onCreated();
    else setError(res.error ?? 'Failed to register stockpile');
  }

  return (
    <section className="platform-card max-w-lg space-y-3">
      <h3 className="font-display text-foreground">New ore stockpile</h3>

      <label className="block text-sm">
        <span className="text-neutral-300">Parcel ID</span>
        <input
          type="text"
          value={form.parcelId}
          onChange={(e) => setForm({ ...form, parcelId: e.target.value })}
          className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>

      <label className="block text-sm">
        <span className="text-neutral-300">Site ID (optional)</span>
        <input
          type="text"
          value={form.siteId}
          onChange={(e) => setForm({ ...form, siteId: e.target.value })}
          className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>

      <label className="block text-sm">
        <span className="text-neutral-300">Location kind</span>
        <select
          value={form.locationKind}
          onChange={(e) =>
            setForm({ ...form, locationKind: e.target.value as LocationKind })
          }
          className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        >
          {LOCATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {LOCATION_LABEL[k]}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="text-neutral-300">
          Location ref (section / warehouse code / truck plate)
        </span>
        <input
          type="text"
          value={form.locationRef}
          onChange={(e) => setForm({ ...form, locationRef: e.target.value })}
          className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>

      <label className="block text-sm">
        <span className="text-neutral-300">Tonnage (kg)</span>
        <input
          type="number"
          min={0}
          value={form.quantityKg}
          onChange={(e) => setForm({ ...form, quantityKg: e.target.value })}
          className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !form.parcelId}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Register'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-4 py-2 text-sm text-foreground"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------
// Custody-transfer drawer
// ----------------------------------------------------------------------------

interface TransferFormState {
  readonly toUserId: string;
  readonly toLocationKind: LocationKind;
  readonly toLocationRef: string;
}

function TransferDrawer({
  stockpile,
  onClose,
  onTransferred,
}: {
  stockpile: Stockpile;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [form, setForm] = useState<TransferFormState>({
    toUserId: '',
    toLocationKind: stockpile.locationKind,
    toLocationRef: stockpile.locationRef ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const res = await api.post(
      `/warehouse/stockpiles/${encodeURIComponent(stockpile.id)}/transfers`,
      {
        toUserId: form.toUserId,
        toLocationKind: form.toLocationKind,
        toLocationRef: form.toLocationRef || null,
      },
    );
    setSaving(false);
    if (res.success) onTransferred();
    else setError(res.error ?? 'Failed to record transfer');
  }

  return (
    <section className="platform-card max-w-lg space-y-3">
      <h3 className="font-display text-foreground">
        Hand over custody — parcel {stockpile.parcelId}
      </h3>
      <p className="text-xs text-neutral-500">
        Currently {LOCATION_LABEL[stockpile.locationKind]} with{' '}
        {stockpile.custodianUserId ?? 'no recorded custodian'}.
      </p>

      <label className="block text-sm">
        <span className="text-neutral-300">New custodian (user ID)</span>
        <input
          type="text"
          value={form.toUserId}
          onChange={(e) => setForm({ ...form, toUserId: e.target.value })}
          className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>

      <label className="block text-sm">
        <span className="text-neutral-300">Destination kind</span>
        <select
          value={form.toLocationKind}
          onChange={(e) =>
            setForm({ ...form, toLocationKind: e.target.value as LocationKind })
          }
          className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        >
          {LOCATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {LOCATION_LABEL[k]}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="text-neutral-300">Destination ref</span>
        <input
          type="text"
          value={form.toLocationRef}
          onChange={(e) => setForm({ ...form, toLocationRef: e.target.value })}
          className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !form.toUserId}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Record transfer'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-4 py-2 text-sm text-foreground"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
