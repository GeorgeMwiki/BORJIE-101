---
name: lease-renewal
description: Use ONLY when a tenant lease is within 90 days of expiry and the tenant is in good standing. NEVER auto-send the renewal — always present the draft for human approval.
allowed-tools: Read, Bash
disable-model-invocation: false
priority: high
---

# Lease renewal

1. Verify the tenant is in good standing (no unresolved arrears, no
   open eviction prep, no unresolved maintenance complaints).
2. Compute the renewal terms per the property's renewal-policy file.
3. Draft the renewal letter via document-studio.
4. STOP — present the draft for human approval. Do NOT send.
