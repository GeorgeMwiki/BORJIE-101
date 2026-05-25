/**
 * Shared test fixtures — a tiny realistic 3-property tenant graph.
 */
import type { Edge, Node, Subgraph } from '../types.js';

export const TENANT = 'tenant-acme';
export const OTHER_TENANT = 'tenant-other';

export function makeNode(over: Partial<Node> & Pick<Node, 'id' | 'class'>): Node {
  return {
    tenantId: TENANT,
    properties: {},
    ...over,
  } as Node;
}

export function makeEdge(over: Partial<Edge> & Pick<Edge, 'id' | 'fromId' | 'toId' | 'label'>): Edge {
  return {
    tenantId: TENANT,
    properties: {},
    ...over,
  } as Edge;
}

export function smallEstateFixture(): {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
} {
  const nodes: Node[] = [
    makeNode({ id: 'p1', class: 'Property', properties: { name: 'Karen Heights', address: 'Karen Rd, Nairobi' } }),
    makeNode({ id: 'u1', class: 'Unit', properties: { unitNumber: 'A1', monthlyRent: 60000 } }),
    makeNode({ id: 'u2', class: 'Unit', properties: { unitNumber: 'A2', monthlyRent: 65000 } }),
    makeNode({ id: 't1', class: 'Tenant', properties: { fullName: 'Asha Mwangi', phone: '+254700000111' } }),
    makeNode({ id: 't2', class: 'Tenant', properties: { fullName: 'James Otieno', phone: '+254700000222' } }),
    makeNode({ id: 'l1', class: 'Lease', properties: { startDate: '2025-01-01', rentMinor: 6000000 } }),
    makeNode({ id: 'l2', class: 'Lease', properties: { startDate: '2025-03-01', rentMinor: 6500000 } }),
    makeNode({ id: 'pay1', class: 'Payment', properties: { amountMinor: 6000000, paidAt: '2025-01-15' } }),
    makeNode({ id: 'pay2', class: 'Payment', properties: { amountMinor: 6500000, paidAt: '2025-03-10' } }),
    makeNode({ id: 'tk1', class: 'MaintenanceTicket', properties: { priority: 'high', status: 'open' } }),
    makeNode({ id: 'mgr1', class: 'EstateManager', properties: { fullName: 'Grace Wambui' } }),
    makeNode({ id: 'parcel1', class: 'Parcel', properties: { titleDeed: 'NRB/4521' } }),
    makeNode({ id: 'd1', class: 'District', properties: { name: 'Karen', jurisdiction: 'KE' } }),
  ];
  const edges: Edge[] = [
    makeEdge({ id: 'e1', fromId: 'p1', toId: 'u1', label: 'hasUnit' }),
    makeEdge({ id: 'e2', fromId: 'p1', toId: 'u2', label: 'hasUnit' }),
    makeEdge({ id: 'e3', fromId: 'u1', toId: 't1', label: 'occupiedBy' }),
    makeEdge({ id: 'e4', fromId: 'u2', toId: 't2', label: 'occupiedBy' }),
    makeEdge({ id: 'e5', fromId: 't1', toId: 'l1', label: 'signedLease' }),
    makeEdge({ id: 'e6', fromId: 't2', toId: 'l2', label: 'signedLease' }),
    makeEdge({ id: 'e7', fromId: 'l1', toId: 'u1', label: 'leaseOf' }),
    makeEdge({ id: 'e8', fromId: 'l2', toId: 'u2', label: 'leaseOf' }),
    makeEdge({ id: 'e9', fromId: 'l1', toId: 'pay1', label: 'generatesPayment' }),
    makeEdge({ id: 'e10', fromId: 'l2', toId: 'pay2', label: 'generatesPayment' }),
    makeEdge({ id: 'e11', fromId: 'pay1', toId: 't1', label: 'paidBy' }),
    makeEdge({ id: 'e12', fromId: 'pay2', toId: 't2', label: 'paidBy' }),
    makeEdge({ id: 'e13', fromId: 't1', toId: 'tk1', label: 'raisedTicket' }),
    makeEdge({ id: 'e14', fromId: 'tk1', toId: 'u1', label: 'ticketFor' }),
    makeEdge({ id: 'e15', fromId: 'p1', toId: 'mgr1', label: 'managedBy' }),
    makeEdge({ id: 'e16', fromId: 'p1', toId: 'parcel1', label: 'locatedAt' }),
    makeEdge({ id: 'e17', fromId: 'parcel1', toId: 'd1', label: 'withinDistrict' }),
  ];
  return { nodes, edges };
}

export function fixtureSubgraph(): Subgraph {
  const { nodes, edges } = smallEstateFixture();
  return { nodes, edges, tenantId: TENANT };
}
