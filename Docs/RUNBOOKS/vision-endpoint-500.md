# Runbook: Vision Endpoint 500

| Field        | Value                                            |
| ------------ | ------------------------------------------------ |
| Slug         | `vision-endpoint-500`                            |
| Severity     | P1 (photo-advisor is core to mining flow)        |
| Team         | brain + vision + api-gateway                     |
| Owner code   | `services/api-gateway/src/routes/brain.hono.ts`, `packages/vision-pipeline/*` |

## Symptoms

- Pilot user reports: "I took a photo of the rock and the app spun
  forever."
- Sentry event: `VisionEndpoint500` or `VisionAdvisor500`.
- `POST /api/v1/brain/vision/advise` returns 500 in api-gateway
  access log.
- p95 latency on vision endpoint > 30s.
- Cohort dashboard `Pilot · Photo Advisor` success rate < 80%.

## Detection

- Sentry alert "Vision endpoint error rate > 5% in 10m".
- Bridge auto-files a GitHub Issue with label
  `runbook:vision-endpoint-500`.

## Diagnosis

```sh
# 1. Which exception is dominant?
kubectl -n borjie logs deploy/api-gateway --since=15m \
  | rg 'POST /api/v1/brain/vision/advise.*(500|502|503)' \
  | rg -o 'error":"[^"]+"' | sort | uniq -c | sort -rn | head

# 2. Is the upstream model provider healthy?
curl -sf "https://api.anthropic.com/v1/health" || echo "ANTHROPIC DOWN"
curl -sf "https://api.openai.com/v1/models" -H "Authorization: Bearer $OPENAI_API_KEY" | jq '.data | length' \
  || echo "OPENAI DOWN"

# 3. Is the image upload S3 bucket reachable?
aws s3 ls "s3://${BORJIE_VISION_BUCKET}/" --max-items=1 || echo "S3 DOWN"

# 4. Brain pipeline trace for the failed request id (from Sentry tag
#    `request_id`):
psql "$DATABASE_URL" -c "
  SELECT stage, status, error_message, latency_ms
    FROM brain_pipeline_traces
   WHERE request_id = '$REQUEST_ID'
   ORDER BY started_at;
"

# 5. Tenant kill-switch state (would short-circuit to 503, not 500 —
#    but confirm anyway):
psql "$DATABASE_URL" -c "
  SELECT key, enabled, updated_at FROM kill_switches
   WHERE key LIKE '%vision%' OR key = 'photo_advisor.enabled';
"
```

## Fix

Pick by root cause:

1. **`AnthropicRateLimitError` dominant** (`x-ratelimit-remaining` =
   0):
   - Burst the rate limit window via env override (no rebuild needed):
     ```sh
     kubectl -n borjie set env deploy/api-gateway \
       VISION_RATE_BUDGET_OVERRIDE=double
     ```
   - Re-route 50% of vision traffic to the OpenAI fallback adapter
     (already in code, just flip the flag):
     ```sh
     pnpm tsx scripts/feature-flags/set.ts \
       --flag=vision.provider.split \
       --value='{"anthropic":50,"openai":50}'
     ```

2. **`ImageTooLargeError` or `UnsupportedMimeType`**:
   - Mobile is sending uncompressed images. Push hotfix to mobile
     client to compress to ≤2MB before upload (already coded as
     `mobile/src/vision/compress.ts` — verify it's actually called on
     the failing screen).
   - Server-side: enable on-the-fly resize at the gateway:
     ```sh
     kubectl -n borjie set env deploy/api-gateway \
       VISION_ACCEPT_OVERSIZED=1 VISION_RESIZE_TO_MAX=2048
     ```

3. **`BrainPipelineTimeout` at stage `vision-classify`**:
   - The classifier is taking >25s. Likely a cold-start on the model
     serving pod. Force a warm:
     ```sh
     kubectl -n borjie rollout restart deploy/vision-classifier
     kubectl -n borjie rollout status deploy/vision-classifier --timeout=120s
     ```
   - If still slow after warm, the model server is OOM. Bump memory:
     ```sh
     kubectl -n borjie set resources deploy/vision-classifier \
       --limits=memory=4Gi --requests=memory=2Gi
     ```

4. **S3 down or credentials rotated**:
   - Confirm IAM role on the gateway pod:
     ```sh
     kubectl -n borjie exec deploy/api-gateway -- env | grep AWS_
     ```
   - If `AWS_ACCESS_KEY_ID` is missing, rotate from sealed-secrets:
     ```sh
     kubectl -n borjie apply -f infra/secrets/borjie-aws-creds.yaml
     kubectl -n borjie rollout restart deploy/api-gateway
     ```

5. **All else** — fail open with a clear message instead of 500:
   ```sh
   kubectl -n borjie set env deploy/api-gateway \
     VISION_FAIL_OPEN_MESSAGE="Vision is taking longer than usual. Try in 1 minute."
   ```

## Prevention

- Add p95 SLO 6s on vision endpoint to the per-tenant SLO dashboard;
  page when violated for 2 consecutive 5m windows.
- Image-size validator runs client-side AND server-side; the
  server-side rejection returns 413 (Payload Too Large), not 500.
- Vision pipeline traces (`brain_pipeline_traces`) retain 7 days for
  pilot — extend to 30 days during pilot weeks via:
  ```sh
  kubectl -n borjie set env deploy/api-gateway \
    BRAIN_TRACE_RETENTION_DAYS=30
  ```
- Pre-warm the vision-classifier pod on every deploy via the
  post-deploy hook (`scripts/deploy/warm-vision.sh`).

## Severity

- **P1** during pilot — vision is the killer feature. SLA: ack 30m,
  mitigate (provider split / fail-open) within 2h.
- **P2** in production with graceful degradation in place.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
