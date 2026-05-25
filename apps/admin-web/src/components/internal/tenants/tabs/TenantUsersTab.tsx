interface Operator {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly lastSeen: string;
}

const OPERATORS: ReadonlyArray<Operator> = [
  { id: 'op_001', name: 'Asha Mwita', role: 'Owner', lastSeen: '2m ago' },
  { id: 'op_002', name: 'Juma Nzwani', role: 'Mine manager', lastSeen: '14m ago' },
  { id: 'op_003', name: 'Grace Mbele', role: 'Compliance lead', lastSeen: '1h ago' },
  { id: 'op_004', name: 'Eliud Kasenge', role: 'Field operator', lastSeen: '3h ago' },
];

export function TenantUsersTab({ tenantId: _tenantId }: { readonly tenantId: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface divide-y divide-border">
      {OPERATORS.map((op) => (
        <div key={op.id} className="px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm text-foreground">{op.name}</p>
            <p className="text-xs text-neutral-500">{op.role}</p>
          </div>
          <span className="text-xs text-neutral-500">Last seen {op.lastSeen}</span>
        </div>
      ))}
    </div>
  );
}
