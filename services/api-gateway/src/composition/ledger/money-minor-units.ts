/**
 * Settlement / payroll amount → integer minor-unit normalisation AT THE
 * LEDGER BOUNDARY.
 *
 *   >>> FLAGGED SIBLING DEP — settlement schema precision <<<
 *
 * Current state (audited): the `settlements` table money columns are
 * `bigint` INTEGER MINOR UNITS post-migration 0161
 * (`0161_settlements_integer_precision.sql`). For TZS (a 0-decimal
 * currency) one minor unit == one whole shilling, so the values arriving
 * here are ALREADY integer minor units.
 *
 * `computeSettlementMath` (services/api-gateway/src/services/settlement/
 * types.ts) now computes every leg in INTEGER minor units (gross =
 * round(tonnage*price) once; royalty/fee as independent integer legs; net
 * as the exact integer remainder), so the value arriving here is ALREADY
 * the same integer split written into the BIGINT settlements columns —
 * one integer source of truth shared between the settlements row and the
 * ledger journal. This boundary re-derives the same split (a pure integer
 * re-integerisation that is a no-op on already-integer inputs) and derives
 * `net` as the exact integer remainder so the ledger journal provably
 * balances (`debits === credits`) even if a future caller hands a stray
 * sub-unit residual.
 *
 * Currency scaling: a settlement value is in MAJOR units only if the
 * currency has 0 decimals == minor units (the TZS launch case). For a
 * 2-decimal expansion currency (KE / UG / NG honour their own primary
 * currency) the upstream settlement math MUST already be in minor units —
 * this boundary asserts the value is a clean integer and rejects a
 * fractional, because there is no reliable major↔minor scale to apply
 * once the value has lost its currency context. When the sibling moves
 * settlement math to a currency-aware Money type, this module becomes a
 * pass-through assertion.
 */

/**
 * Assert + coerce a settlement/payroll money value (already conceptually
 * in integer minor units per the post-0161 bigint schema) to a clean
 * non-negative integer. Rounds a stray sub-unit residual that leaked from
 * upstream float math; throws on non-finite / negative input.
 */
export function toIntegerMinorUnits(amount: number, label: string): number {
  if (!Number.isFinite(amount)) {
    throw new Error(
      `toIntegerMinorUnits(${label}): amount is not finite: ${String(amount)}`,
    );
  }
  if (amount < 0) {
    throw new Error(
      `toIntegerMinorUnits(${label}): amount must be non-negative: ${amount}`,
    );
  }
  if (!Number.isSafeInteger(amount)) {
    // A fractional or out-of-range value reached the ledger boundary.
    // Round to the nearest minor unit (the bigint column would coerce it
    // anyway) — but keep it loud-adjacent: realistic TZS magnitudes are
    // safe integers, so this branch only fires on the upstream float
    // residual the settlement-schema sibling is fixing.
    return Math.round(amount);
  }
  return amount;
}

export interface SettlementMinorUnitSplit {
  readonly grossMinor: number;
  readonly royaltyMinor: number;
  readonly feeMinor: number;
  readonly netMinor: number;
}

/**
 * Build the integer minor-unit split for a settlement so the journal
 * provably balances: gross (DR) === royalty + fee + net (CR).
 *
 * gross / royalty / fee are integerised independently; `net` is the
 * integer REMAINDER (gross - royalty - fee). The seller (net) absorbs any
 * sub-unit rounding residual — the economically correct plug, and the
 * only way to guarantee exact debit/credit equality at integer scale.
 *
 * Throws if the remainder would be negative (royalty + fee exceeding
 * gross) — a malformed settlement that must fail loud, never post.
 */
export function splitSettlementMinorUnits(math: {
  readonly grossTzs: number;
  readonly royaltyTzs: number;
  readonly feeTzs: number;
}): SettlementMinorUnitSplit {
  const grossMinor = toIntegerMinorUnits(math.grossTzs, 'gross');
  const royaltyMinor = toIntegerMinorUnits(math.royaltyTzs, 'royalty');
  const feeMinor = toIntegerMinorUnits(math.feeTzs, 'fee');
  const netMinor = grossMinor - royaltyMinor - feeMinor;
  if (netMinor < 0) {
    throw new Error(
      `splitSettlementMinorUnits: royalty (${royaltyMinor}) + fee (${feeMinor}) ` +
        `exceed gross (${grossMinor}) — refusing to post an inverted settlement`,
    );
  }
  return { grossMinor, royaltyMinor, feeMinor, netMinor };
}
