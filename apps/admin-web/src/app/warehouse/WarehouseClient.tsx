'use client';

/**
 * Warehouse inventory — migrated from
 * apps/admin-portal/src/pages/Warehouse.tsx.
 *
 *   GET    /api/v1/warehouse/items
 *   POST   /api/v1/warehouse/items
 *   GET    /api/v1/warehouse/items/:id/movements
 *   POST   /api/v1/warehouse/items/:id/movements
 */

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Plus, Loader2, ArrowRightLeft } from 'lucide-react';
import { api } from '@/lib/api';

interface Item {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  readonly quantity: number;
  readonly condition: string;
  readonly warehouseLocation?: string;
  readonly unitOfMeasure?: string;
}

interface Movement {
  readonly id: string;
  readonly movementType: string;
  readonly quantityDelta: number;
  readonly reason?: string;
  readonly createdAt: string;
}

export function WarehouseClient() {
  const [items, setItems] = useState<readonly Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'create' | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [movements, setMovements] = useState<readonly Movement[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await api.get<readonly Item[]>('/warehouse/items');
    if (res.success && res.data) setItems(res.data);
    else setError(res.error ?? 'Failed to load items');
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectItem = useCallback(async (item: Item) => {
    setSelected(item);
    const res = await api.get<readonly Movement[]>(
      `/warehouse/items/${encodeURIComponent(item.id)}/movements`,
    );
    if (res.success && res.data) setMovements(res.data);
    else setMovements([]);
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Boxes className="h-6 w-6 text-blue-400" />
          <p className="text-sm text-neutral-400">
            Maintenance / hardware inventory across the platform.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDrawer('create')}
          className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> Add item
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

      {!loading && items.length === 0 && !error && (
        <div className="platform-card text-sm text-neutral-400">
          No items yet.
        </div>
      )}

      {!loading && items.length > 0 && (
        <section className="platform-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.id}
                  className="border-t border-border/40 text-neutral-200"
                >
                  <td className="px-3 py-2 font-mono text-xs">{i.sku}</td>
                  <td className="px-3 py-2">{i.name}</td>
                  <td className="px-3 py-2">{i.category}</td>
                  <td className="px-3 py-2">{i.quantity}</td>
                  <td className="px-3 py-2">{i.condition}</td>
                  <td className="px-3 py-2">{i.warehouseLocation ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void selectItem(i)}
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                    >
                      <ArrowRightLeft className="h-3 w-3" /> History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {selected && (
        <section className="platform-card">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-foreground">
              Movements for {selected.name}
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-neutral-500"
            >
              Close
            </button>
          </div>
          {movements.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-400">No movements.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {movements.map((m) => (
                <li
                  key={m.id}
                  className="flex justify-between py-1 text-neutral-200"
                >
                  <span>
                    {m.movementType}{' '}
                    <span
                      className={
                        m.quantityDelta < 0
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }
                    >
                      {m.quantityDelta > 0 ? '+' : ''}
                      {m.quantityDelta}
                    </span>
                    {m.reason && (
                      <span className="text-neutral-500"> · {m.reason}</span>
                    )}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {drawer === 'create' && (
        <CreateItemDrawer
          onClose={() => setDrawer(null)}
          onCreated={() => {
            setDrawer(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

interface CreateFormState {
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  readonly quantity: string;
  readonly warehouseLocation: string;
}

const EMPTY_FORM: CreateFormState = {
  sku: '',
  name: '',
  category: '',
  quantity: '0',
  warehouseLocation: '',
};

function CreateItemDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const res = await api.post('/warehouse/items', {
      sku: form.sku,
      name: form.name,
      category: form.category,
      quantity: Number(form.quantity) || 0,
      warehouseLocation: form.warehouseLocation || undefined,
    });
    setSaving(false);
    if (res.success) {
      onCreated();
    } else {
      setError(res.error ?? 'Failed to create item');
    }
  }

  return (
    <section className="platform-card max-w-lg space-y-3">
      <h3 className="font-display text-foreground">New item</h3>
      {(['sku', 'name', 'category', 'quantity', 'warehouseLocation'] as const).map(
        (field) => (
          <label key={field} className="block text-sm">
            <span className="text-neutral-300">{field}</span>
            <input
              type={field === 'quantity' ? 'number' : 'text'}
              // eslint-disable-next-line security/detect-object-injection -- field is a TS-typed literal-union key from FORM_FIELDS
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              className="mt-1 w-full rounded border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
            />
          </label>
        ),
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Create'}
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
