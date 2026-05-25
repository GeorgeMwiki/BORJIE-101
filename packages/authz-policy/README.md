# @borjie/authz-policy

Authorization policy engine. Declarative role/permission matrix evaluated at the API-gateway boundary and inside domain services that cross tenant trust zones.

## Usage

```ts
import { evaluate } from '@borjie/authz-policy'

const allowed = evaluate({
  principal: { userId, orgId, roles },
  action: 'leases.approve',
  resource: { orgId: lease.orgId }
})
```

Policies live in `src/policies/`.
