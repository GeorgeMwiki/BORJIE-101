import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { SALES_MOCK } from '@/lib/mocks/commercial';
import { fmtTzs } from '@/lib/format';

/**
 * O-W-13 — Sales & pipeline. Polished stub: net-price table per
 * buyer, payment trace. Working action is "Accept" per buyer.
 */
export default function SalesPage() {
  return (
    <>
      <ScreenHeader slug="sales" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <SectionCard title="Net-price comparison">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 text-left">Buyer</th>
                <th className="py-1 text-right">Net TZS / g</th>
                <th className="py-1 text-right">Pay</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {SALES_MOCK.buyers.map((b, idx) => (
                <tr key={b.name} className="border-t border-border">
                  <td className="py-1.5 text-foreground">
                    {b.name}
                    {idx === 0 ? (
                      <span className="ml-2 pill pill-green">top</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right font-mono text-foreground">
                    {fmtTzs(b.netTzsPerG)}
                  </td>
                  <td className="py-1.5 text-right text-xs text-neutral-400">{b.payDays}d</td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      className="rounded-md border border-warning bg-warning-subtle/30 px-2 py-0.5 text-xs text-warning hover:bg-warning-subtle/50"
                    >
                      Accept
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
        <SectionCard title="Payment trace">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 text-left">Invoice</th>
                <th className="py-1 text-right">Gross</th>
                <th className="py-1 text-right">Received</th>
                <th className="py-1 text-right">Age</th>
              </tr>
            </thead>
            <tbody>
              {SALES_MOCK.paymentTrace.map((t) => (
                <tr key={t.invoice} className="border-t border-border">
                  <td className="py-1.5 text-foreground">{t.invoice}</td>
                  <td className="py-1.5 text-right font-mono text-foreground">{fmtTzs(t.gross)}</td>
                  <td
                    className={`py-1.5 text-right font-mono ${
                      t.receivedTzs > 0 ? 'text-success' : 'text-destructive'
                    }`}
                  >
                    {fmtTzs(t.receivedTzs)}
                  </td>
                  <td className="py-1.5 text-right text-xs text-neutral-400">{t.ageDays}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </div>
    </>
  );
}
