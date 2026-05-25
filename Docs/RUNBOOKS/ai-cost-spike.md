# Runbook: AICostSpike

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `AICostSpike`                                                |
| Severity         | ticket                                                       |
| Team             | brain                                                        |
| Source PromQL    | `((sum by (tenant) (increase(ai_cost_usd_total[1h]))) - avg_over_time(ai_cost_usd_hourly_baseline[30d])) / stddev_over_time(ai_cost_usd_hourly_baseline[30d]) > 3` |
| Window           | 15m                                                          |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.ai`) |

## Symptoms

- Slack ticket: `AICostSpike tenant=<id>`.
- The tenant's hourly AI spend is > 3σ above its 30-day baseline.
- Anthropic/OpenAI usage dashboard shows the same tenant tag spiking.
- May coincide with `ConstitutionRefuseClauseBurst` if the tenant is in a
  retry loop that keeps tripping safety filters.

## Suspect causes

- Prompt loop: an agent retries on its own output without back-off.
- Model fallback misconfig: a "cheap-tier" tenant is hitting a premium
  model.
- Bulk workload not capacity-planned (mass-import, generation campaign).
- Tenant abuse (scripted/synthetic traffic against `/api/v1/ai/chat`).
- Recent prompt-template change inflated token counts.

## Diagnostics

```sh
# 1. Top tenants in the last hour.
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=topk(10, sum by (tenant) (increase(ai_cost_usd_total[1h])))'

# 2. Model split for the offending tenant.
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  "query=sum by (model) (increase(ai_cost_usd_total{tenant=\"$TENANT\"}[1h]))"

# 3. Inspect their recent traces.
curl -s "$PROD_URL/api/v1/admin/ai/traces?tenant=$TENANT&limit=20" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.[] | {ts,model,prompt_len,output_len,cost_usd}'

# 4. Compare to baseline.
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  "query=avg_over_time(ai_cost_usd_hourly_baseline{tenant=\"$TENANT\"}[30d])"

# 5. Loop detector: identical prompts in the last 10m.
psql "$DATABASE_URL" -c "
  SELECT count(*) AS dupes, left(prompt_hash, 16) AS h
  FROM ai_trace
  WHERE tenant_id = '$TENANT' AND created_at > now() - interval '10 minutes'
  GROUP BY h HAVING count(*) > 20 ORDER BY dupes DESC;
"
```

## Immediate mitigation

1. Cap the tenant's per-hour spend (soft):
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/ai/budget" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"tenant":"'"$TENANT"'","hourly_usd":5}'
   ```
2. If a prompt-loop is confirmed, flip the per-tenant kill-switch:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/ai/killswitch" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"tenant":"'"$TENANT"'","reason":"loop suspected"}'
   ```
3. Force tenant to cheap-tier model fallback:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/ai/model-pin" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"tenant":"'"$TENANT"'","model":"haiku-4-5"}'
   ```

## Permanent fix

- Add backoff with jitter to the agent loop that produced the dupes.
- Tighten the per-tier model-allowlist in `services/ai-gateway/policy.ts`.
- Add a daily `ai_cost_usd_hourly_baseline` recomputation cron.
- File a billing review with finance if the tenant is on a tier that
  cannot recoup the spend.

## Escalation contact

1. Brain team on-call (`brain-primary`).
2. Brain platform lead (`#brain-platform`).
3. FinOps lead if monthly budget burn > 25% in one day.
