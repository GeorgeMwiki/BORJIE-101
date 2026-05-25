# Runbook: ConstitutionRefuseClauseBurst

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `ConstitutionRefuseClauseBurst`                              |
| Severity         | ticket                                                       |
| Team             | brain-eval                                                   |
| Source PromQL    | `sum(rate(brain_constitution_refuse_total[1m])) * 60 > 10`   |
| Window           | 2m                                                           |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.brain-eval`) |

## Symptoms

- Slack ticket: `ConstitutionRefuseClauseBurst`.
- Refuse-rate > 10/min sustained ≥ 2m.
- Tenants in support: "the assistant just stopped helping me".
- Refuse-reason histogram dominated by one or two clauses.

## Suspect causes

- Recent constitution edit is over-blocking legitimate property-management
  workflows (e.g. a new clause flags "evict" but tenant comms legitimately
  use the word in contract terms).
- Coordinated abuse: a tenant is scripting prompt-injection attempts.
- Upstream model behavior changed after provider model swap (Anthropic/OpenAI
  pushed a new minor version).
- A new agent template is producing borderline prompts that trip clauses.

## Diagnostics

```sh
# 1. Which clause is firing?
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=topk(5, sum by (clause) (increase(brain_constitution_refuse_total[15m])))'

# 2. Which tenant?
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=topk(5, sum by (tenant) (increase(brain_constitution_refuse_total[15m])))'

# 3. Sample 20 recent refuse events.
psql "$DATABASE_URL" -c "
  SELECT ts, tenant_id, clause, left(prompt_text, 200) AS sample
  FROM brain_constitution_refusal
  WHERE ts > now() - interval '15 minutes'
  ORDER BY ts DESC LIMIT 20;
"

# 4. Recent constitution edits.
git -C "/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BORJIE101" \
  log --since='48 hours ago' --oneline -- packages/brain/constitution/ services/ai-gateway/policy/

# 5. Run the brain-eval suite on the suspect clause.
pnpm --filter @borjie/brain-eval run eval:constitution -- --clause <id>
```

## Immediate mitigation

1. If a recent edit is over-blocking, revert it:
   ```sh
   git revert <sha> && git push
   # CI will redeploy the constitution within ~5m
   ```
2. If a single tenant is the source (abuse), enable per-tenant strict mode
   so they hit the rate limiter instead of the constitution:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/ai/policy" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"tenant":"<id>","mode":"strict-ratelimit"}'
   ```
3. If clause is firing across many tenants on innocuous prompts, temporarily
   soften it to "warn" (logs but does not refuse):
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/brain/constitution/<clause>/mode" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"mode":"warn"}'
   ```

## Permanent fix

- Add the false-positive prompts to the brain-eval regression set so the
  bad clause edit cannot land again.
- Tighten clause matcher to the actual harmful pattern (regex too broad
  → predicate too broad).
- If model-version drift caused it, pin the model version in
  `services/ai-gateway/config.ts` until eval clears the new version.
- Document the postmortem in `Docs/COMPLIANCE/constitution-changelog.md`.

## Escalation contact

1. Brain-eval lead (`#brain-eval`).
2. Brain platform lead if mitigation 1 doesn't drop the rate within 10m.
3. Security lead if abuse pattern confirmed (prompt-injection).
