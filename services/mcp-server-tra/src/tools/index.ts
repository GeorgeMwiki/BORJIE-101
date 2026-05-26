/**
 * Tool registry — barrel-exports the 5 TRA tools.
 *
 * Order mirrors the TRA-portal user flow: identity (TIN) -> liability
 * computation (royalty, CIT) -> filing (VAT return) -> arrears query.
 */
import { lookupTinTool } from './lookup_tin.js';
import { computeRoyaltyTool } from './compute_royalty.js';
import { computeCorporateTaxTool } from './compute_corporate_tax.js';
import { submitVatReturnTool } from './submit_vat_return.js';
import { fetchOutstandingTool } from './fetch_outstanding.js';
import type { AnyTraTool } from '../types.js';

export {
  lookupTinTool,
  computeRoyaltyTool,
  computeCorporateTaxTool,
  submitVatReturnTool,
  fetchOutstandingTool,
};

export const TRA_TOOLS: ReadonlyArray<AnyTraTool> = Object.freeze([
  lookupTinTool as AnyTraTool,
  computeRoyaltyTool as AnyTraTool,
  computeCorporateTaxTool as AnyTraTool,
  submitVatReturnTool as AnyTraTool,
  fetchOutstandingTool as AnyTraTool,
]);

export function findTraTool(name: string): AnyTraTool | undefined {
  return TRA_TOOLS.find((tool) => tool.name === name);
}

export const TRA_TOOL_NAMES = Object.freeze({
  LOOKUP_TIN: 'tra.lookup_tin',
  COMPUTE_ROYALTY: 'tra.compute_royalty',
  COMPUTE_CIT: 'tra.compute_corporate_tax',
  SUBMIT_VAT: 'tra.submit_vat_return',
  FETCH_OUTSTANDING: 'tra.fetch_outstanding',
} as const);
