import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { INVENTORY_MOCK } from '@/lib/mocks/operations';

/**
 * O-W-10 — Inventory & procurement. Polished stub: consumption
 * timeline per SKU with auto-PO suggestion and ITC compliance check
 * on suppliers. Working action is "Auto-PO" for SKUs under reorder.
 */
export default function InventoryPage() {
  return (
    <>
      <ScreenHeader slug="inventory" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <SectionCard title="Reorder timeline">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 text-left">SKU</th>
                <th className="py-1 text-right">Days cover</th>
                <th className="py-1 text-right">Reorder</th>
              </tr>
            </thead>
            <tbody>
              {INVENTORY_MOCK.consumables.map((c) => {
                const tone =
                  c.daysCover < c.reorderAtDays
                    ? 'red'
                    : c.daysCover < c.reorderAtDays + 7
                      ? 'amber'
                      : 'green';
                return (
                  <tr key={c.sku} className="border-t border-border">
                    <td className="py-1.5 text-foreground">{c.label}</td>
                    <td className="py-1.5 text-right">
                      <StatusPill tone={tone} label={`${c.daysCover}d`} />
                    </td>
                    <td className="py-1.5 text-right text-xs text-neutral-500">
                      at {c.reorderAtDays}d
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button
            type="button"
            className="mt-3 rounded-md border border-warning bg-warning-subtle/30 px-3 py-1.5 text-sm text-warning hover:bg-warning-subtle/50"
          >
            Auto-PO for diesel + NaCN
          </button>
        </SectionCard>
        <SectionCard title="Supplier ITC compliance">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 text-left">Supplier</th>
                <th className="py-1 text-left">TIN</th>
                <th className="py-1 text-right">ITC</th>
              </tr>
            </thead>
            <tbody>
              {INVENTORY_MOCK.suppliers.map((s) => (
                <tr key={s.name} className="border-t border-border">
                  <td className="py-1.5 text-foreground">{s.name}</td>
                  <td className="py-1.5 font-mono text-xs text-neutral-400">{s.tin}</td>
                  <td className="py-1.5 text-right">
                    <StatusPill
                      tone={s.itcStatus === 'valid' ? 'green' : 'red'}
                      label={s.itcStatus}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </div>
    </>
  );
}
