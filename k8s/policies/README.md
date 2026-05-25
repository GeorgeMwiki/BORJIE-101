# BORJIE k8s NetworkPolicies

## `networkpolicy-strict.yaml`

Default-deny egress + explicit block of cloud-provider IMDS endpoints
(AWS, Azure, GCP, AWS Fargate, Alibaba). Defends against the
Capital-One-2019 class: a compromised pod or adversarial LLM tool call
reading instance metadata to steal IAM credentials.

### Threat covered

- **SSRF/IMDS credential theft** (LLM01 indirect prompt injection ⇒
  exfiltration via tool that fetches arbitrary URLs).
- **Lateral movement to cloud control plane** through stolen tokens.

### Coverage matrix

| Provider | IMDS endpoint(s) | Status |
|----------|------------------|--------|
| AWS      | `169.254.169.254` (IMDSv1/v2) | DENY |
| AWS Fargate | `169.254.170.2` (task IAM) | DENY |
| Azure    | `169.254.169.254`, `169.254.169.123` (managed identity) | DENY |
| GCP      | `169.254.169.254` (metadata.google.internal) | DENY |
| Alibaba  | `100.100.100.200` | DENY |
| All clouds | `169.254.0.0/16` (link-local entire range) | DENY |

### How to apply

```bash
kubectl apply -n borjie-prod -f k8s/policies/networkpolicy-strict.yaml
kubectl apply -n borjie-staging -f k8s/policies/networkpolicy-strict.yaml
```

Repeat for every namespace running tenant workloads.

### Verifying the block

From a pod in the affected namespace:

```bash
# Should TIMEOUT (not return data):
curl -m 3 http://169.254.169.254/latest/meta-data/iam/security-credentials/

# Should TIMEOUT:
curl -m 3 http://169.254.170.2/v2/credentials/

# Should resolve cluster DNS:
nslookup kubernetes.default.svc.cluster.local
```

### Cilium companion policy

The base NetworkPolicy is additive at the K8s API: a later, broader
allow can re-open the IMDS path. When the cluster CNI is Cilium, also
install the `CiliumClusterwideNetworkPolicy` from the bottom of
`networkpolicy-strict.yaml` — `egressDeny` is strictly enforced and
cannot be reversed by a later additive allow.

### Why the RFC1918 deny?

External egress to private CIDRs (10/8, 172.16/12, 192.168/16) is also
denied so a malicious URL that resolves to a private network can't
reach internal infrastructure. In-cluster pod-to-pod traffic still
works because rule #2 above whitelists BORJIE workload namespaces.
