/**
 * Property-based tests for Money / moneyFromDecimal / addMoney /
 * subtractMoney / multiplyMoney — LITFIN parity audit gap #9
 * (Docs/LITFIN_PARITY_DEEP_AUDIT_2026-05-24.md).
 *
 * Invariants exercised on every property (100 iterations each):
 *   1. Addition is commutative + associative within a currency
 *   2. Subtraction is the inverse of addition
 *   3. Zero is the additive identity
 *   4. multiplyMoney(m, 0) === zeroMoney(m.currency)
 *   5. multiplyMoney(m, 1) === m
 *   6. Sign predicates are mutually exclusive
 *   7. Adding two different-currency Moneys throws
 *   8. moneyFromDecimal → toDecimal round-trip is identity per currency
 *   9. moneyFromDecimal monotonic on decimal input
 *
 * These catch the classes of bugs example-based tests cannot — silent
 * floating-point error, currency mixing, off-by-one in moneyFromDecimal,
 * and any commutativity break under refactor.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  Money,
  money,
  moneyFromDecimal,
  toDecimal,
  addMoney,
  subtractMoney,
  multiplyMoney,
  isPositive,
  isNegative,
  isZero,
  zeroMoney,
} from '../common/money.js';
import type { CurrencyCode } from '../common/types.js';

// ─────────────────────────────────────────────────────────────────────
// Arbitraries
// ─────────────────────────────────────────────────────────────────────

// JS safe integer range gives Number arithmetic exactness. Constrain to
// ± 2^40 so 2× and 3× additions never overflow Number.MAX_SAFE_INTEGER.
const SAFE_INT = Object.freeze({ min: -(2 ** 40), max: 2 ** 40 });

const TWO_DECIMAL_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'KES', 'INR', 'NGN', 'ZAR', 'AED',
] as const;
const ZERO_DECIMAL_CURRENCIES = [
  'JPY', 'KRW', 'TZS', 'UGX', 'RWF', 'VND', 'XOF', 'XAF',
] as const;
const ALL_TEST_CURRENCIES = [
  ...TWO_DECIMAL_CURRENCIES,
  ...ZERO_DECIMAL_CURRENCIES,
] as const;

const arbCurrency: fc.Arbitrary<CurrencyCode> = fc.constantFrom(
  ...ALL_TEST_CURRENCIES,
) as fc.Arbitrary<CurrencyCode>;

const arbMinorAmount = fc.integer(SAFE_INT);

const arbMoneyIn = (currency: CurrencyCode): fc.Arbitrary<Money> =>
  arbMinorAmount.map((a) => money(a, currency));

const arbMoneyTuple: fc.Arbitrary<{ a: Money; b: Money; c: Money; currency: CurrencyCode }> =
  arbCurrency.chain((currency) =>
    fc.tuple(arbMoneyIn(currency), arbMoneyIn(currency), arbMoneyIn(currency))
      .map(([a, b, c]) => ({ a, b, c, currency })),
  );

// ─────────────────────────────────────────────────────────────────────
// Properties
// ─────────────────────────────────────────────────────────────────────

describe('Money — property invariants (fast-check, LITFIN parity #9)', () => {
  it('addition is commutative within a currency', () => {
    fc.assert(
      fc.property(arbMoneyTuple, ({ a, b }) => {
        const ab = addMoney(a, b);
        const ba = addMoney(b, a);
        return ab.amount === ba.amount && ab.currency === ba.currency;
      }),
      { numRuns: 100 },
    );
  });

  it('addition is associative within a currency', () => {
    fc.assert(
      fc.property(arbMoneyTuple, ({ a, b, c }) => {
        const left = addMoney(addMoney(a, b), c);
        const right = addMoney(a, addMoney(b, c));
        return left.amount === right.amount && left.currency === right.currency;
      }),
      { numRuns: 100 },
    );
  });

  it('zero is the additive identity', () => {
    fc.assert(
      fc.property(arbCurrency, arbMinorAmount, (currency, amt) => {
        const m = money(amt, currency);
        const z = zeroMoney(currency);
        return addMoney(m, z).amount === m.amount;
      }),
      { numRuns: 100 },
    );
  });

  it('subtraction is the inverse of addition: (a + b) - b === a', () => {
    fc.assert(
      fc.property(arbMoneyTuple, ({ a, b }) => {
        const sum = addMoney(a, b);
        const back = subtractMoney(sum, b);
        return back.amount === a.amount && back.currency === a.currency;
      }),
      { numRuns: 100 },
    );
  });

  it('multiplyMoney(m, 0) === zeroMoney(currency)', () => {
    fc.assert(
      fc.property(arbCurrency, arbMinorAmount, (currency, amt) => {
        const m = money(amt, currency);
        const result = multiplyMoney(m, 0);
        return result.amount === 0 && result.currency === currency;
      }),
      { numRuns: 100 },
    );
  });

  it('multiplyMoney(m, 1) === m', () => {
    fc.assert(
      fc.property(arbCurrency, arbMinorAmount, (currency, amt) => {
        const m = money(amt, currency);
        const result = multiplyMoney(m, 1);
        return result.amount === m.amount && result.currency === m.currency;
      }),
      { numRuns: 100 },
    );
  });

  it('isPositive / isNegative / isZero are mutually exclusive', () => {
    fc.assert(
      fc.property(arbCurrency, arbMinorAmount, (currency, amt) => {
        const m = money(amt, currency);
        const flags = [isPositive(m), isNegative(m), isZero(m)];
        const trueCount = flags.filter(Boolean).length;
        return trueCount === 1;
      }),
      { numRuns: 100 },
    );
  });

  it('addMoney throws when currencies differ', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TWO_DECIMAL_CURRENCIES),
        fc.constantFrom(...ZERO_DECIMAL_CURRENCIES),
        arbMinorAmount,
        arbMinorAmount,
        (cA, cB, vA, vB) => {
          const a = money(vA, cA as CurrencyCode);
          const b = money(vB, cB as CurrencyCode);
          try {
            addMoney(a, b);
            return false; // should have thrown
          } catch {
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Money constructor rejects non-integer amounts', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true })
          .filter((n) => !Number.isInteger(n)),
        arbCurrency,
        (amount, currency) => {
          try {
            new Money(amount, currency);
            return false;
          } catch {
            return true;
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('moneyFromDecimal → toDecimal round-trip is identity for integer-decimal inputs (2dp currencies)', () => {
    // For 2dp currencies, any integer decimal input round-trips exactly.
    // For 0dp currencies, any integer also round-trips.
    fc.assert(
      fc.property(
        fc.constantFrom(...TWO_DECIMAL_CURRENCIES),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (currency, integerDecimal) => {
          const m = moneyFromDecimal(integerDecimal, currency as CurrencyCode);
          return toDecimal(m) === integerDecimal;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('moneyFromDecimal → toDecimal round-trip is identity for 0-decimal currencies', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZERO_DECIMAL_CURRENCIES),
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        (currency, amount) => {
          const m = moneyFromDecimal(amount, currency as CurrencyCode);
          return toDecimal(m) === amount && m.amount === amount;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('moneyFromDecimal is monotonic — bigger decimal → bigger amount', () => {
    fc.assert(
      fc.property(
        arbCurrency,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (currency, base, delta) => {
          const lo = moneyFromDecimal(base, currency);
          const hi = moneyFromDecimal(base + delta, currency);
          return hi.amount > lo.amount;
        },
      ),
      { numRuns: 100 },
    );
  });
});
