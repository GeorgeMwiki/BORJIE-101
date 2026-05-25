import type { DecisionTree, ToTContext } from '../types.js';

/**
 * Vendor selection tree.
 *
 * Reads facts:
 *   - is_emergency (boolean) — plumbing burst, gas leak, etc.
 *   - has_preferred_vendor (boolean) — vendor on retainer for this category
 *   - in_warranty (boolean)
 *   - quote_collected (boolean)
 *   - quote_under_threshold (boolean) — under owner's auto-approve limit
 *   - tenant_can_pay (boolean) — for tenant-attributable damage
 */

const bool = (ctx: ToTContext, key: string): boolean => ctx.facts[key] === true;

export const VENDOR_SELECTION_TREE: DecisionTree = {
  id: 'vendor.v1',
  rootNodeId: 'q_emergency',
  nodes: {
    q_emergency: {
      id: 'q_emergency',
      question: 'Is this an emergency?',
      edges: [
        { label: 'yes', when: (c) => bool(c, 'is_emergency'), toNodeId: 'q_preferred' },
        { label: 'no', when: (c) => !bool(c, 'is_emergency'), toNodeId: 'q_warranty' },
      ],
    },
    q_preferred: {
      id: 'q_preferred',
      question: 'Do we have a preferred emergency vendor?',
      edges: [
        { label: 'yes', when: (c) => bool(c, 'has_preferred_vendor'), toNodeId: 'out_dispatch_preferred' },
        { label: 'no', when: (c) => !bool(c, 'has_preferred_vendor'), toNodeId: 'out_dispatch_first_available' },
      ],
    },
    q_warranty: {
      id: 'q_warranty',
      question: 'Is the item under warranty?',
      edges: [
        { label: 'yes', when: (c) => bool(c, 'in_warranty'), toNodeId: 'out_warranty_claim' },
        { label: 'no', when: (c) => !bool(c, 'in_warranty'), toNodeId: 'q_quote' },
      ],
    },
    q_quote: {
      id: 'q_quote',
      question: 'Have we collected a quote yet?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'quote_collected'), toNodeId: 'out_collect_quote' },
        { label: 'yes', when: (c) => bool(c, 'quote_collected'), toNodeId: 'q_threshold' },
      ],
    },
    q_threshold: {
      id: 'q_threshold',
      question: 'Is the quote under the auto-approve threshold?',
      edges: [
        { label: 'yes', when: (c) => bool(c, 'quote_under_threshold'), toNodeId: 'q_attribution' },
        { label: 'no', when: (c) => !bool(c, 'quote_under_threshold'), toNodeId: 'out_request_owner_approval' },
      ],
    },
    q_attribution: {
      id: 'q_attribution',
      question: 'Is the cost attributable to the tenant?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'tenant_can_pay'), toNodeId: 'out_dispatch_preferred' },
        { label: 'yes', when: (c) => bool(c, 'tenant_can_pay'), toNodeId: 'out_dispatch_with_tenant_billback' },
      ],
    },
    out_dispatch_preferred: { id: 'out_dispatch_preferred', question: '', outcome: 'dispatch-preferred' },
    out_dispatch_first_available: { id: 'out_dispatch_first_available', question: '', outcome: 'dispatch-first-available' },
    out_warranty_claim: { id: 'out_warranty_claim', question: '', outcome: 'warranty-claim' },
    out_collect_quote: { id: 'out_collect_quote', question: '', outcome: 'collect-quote' },
    out_request_owner_approval: { id: 'out_request_owner_approval', question: '', outcome: 'request-owner-approval' },
    out_dispatch_with_tenant_billback: { id: 'out_dispatch_with_tenant_billback', question: '', outcome: 'dispatch-with-tenant-billback' },
  },
};
