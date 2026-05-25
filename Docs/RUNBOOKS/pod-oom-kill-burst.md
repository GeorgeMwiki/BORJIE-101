# Runbook: PodOOMKillBurst

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `PodOOMKillBurst`                                            |
| Severity         | page                                                         |
| Team             | sre                                                          |
| Source PromQL    | `sum by (deployment, namespace) (increase(kube_pod_container_status_terminated_reason{reason="OOMKilled"}[10m])) > 3` |
| Window           | 10m                                                          |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.platform`) |

## Symptoms

- PagerDuty page: `PodOOMKillBurst deployment=<name>`.
- `kubectl get pods` shows repeated `CrashLoopBackOff` with last state
  `OOMKilled`.
- Service may have elevated 5xx (see `APIErrorRateHigh`).
- Node memory pressure events on the same node(s).

## Suspect causes

- Heap leak in a service shipped within the last 24h.
- Missing stream backpressure (large blob loaded fully into RAM).
- Unbounded in-memory cache (LRU misconfigured, no max size).
- Resource limits set too low for current traffic.
- Sidecar (otel-collector, fluent-bit) leaking and counted against pod limit.

## Diagnostics

```sh
# 1. Confirm the OOMKill count and last-state.
kubectl -n <ns> get pods -l app=<deployment> \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[0].lastState.terminated.reason}{"\n"}{end}'

# 2. Last 200 lines from a recently killed pod (use --previous).
kubectl -n <ns> logs <pod> --previous --tail=200

# 3. Pod memory limits + requests.
kubectl -n <ns> get deployment <deployment> -o yaml \
  | yq '.spec.template.spec.containers[] | {name: .name, limits: .resources.limits, requests: .resources.requests}'

# 4. Memory usage trend.
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  "query=container_memory_working_set_bytes{namespace=\"<ns>\",pod=~\"<deployment>.*\"}"

# 5. Recent deploys?
kubectl -n <ns> rollout history deployment/<deployment> | tail -5
```

## Immediate mitigation

1. If a deploy landed within the OOM window, roll back:
   ```sh
   kubectl -n <ns> rollout undo deployment/<deployment>
   ```
2. Temporarily raise the memory limit (only if rollback is not an option):
   ```sh
   kubectl -n <ns> set resources deployment/<deployment> \
     --limits=memory=2Gi --requests=memory=1Gi
   ```
3. If a sidecar is the culprit (e.g. otel-collector), restart it:
   ```sh
   kubectl -n <ns> exec <pod> -c otel-collector -- kill 1
   ```
4. If a single request is the trigger (large blob), enable a hard body-size
   limit at the gateway:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/limits" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"max_body_kb":2048}'
   ```

## Permanent fix

- Grab a heap snapshot from a running pod (`kill -USR2 <pid>` for Node;
  `jcmd <pid> GC.heap_dump` for JVM) and analyze with a heap viewer.
- Replace the unbounded cache with `lru-cache` sized to ≤ 10% of pod limit.
- Refactor large-blob handlers to stream (`pipeline()` from `stream`).
- Right-size requests/limits using `kubectl top` p95 over 7 days.
- Add a memory-leak smoke test to CI for high-risk services.

## Escalation contact

1. SRE on-call (`sre-primary`).
2. Owning service team (look up CODEOWNERS for the deployment).
3. After 30 minutes: engineering lead.
