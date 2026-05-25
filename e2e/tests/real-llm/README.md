# Real-LLM E2E Suite

These tests run against a real Anthropic / ElevenLabs / OpenAI backend — no
mocks. They exist to catch drift between our prompts and the providers' models.

## Opt-in

All specs under this directory check `process.env.E2E_REAL_LLM === 'true'`
and `.skip()` otherwise. CI defaults to skip.

```bash
# Local dev:
E2E_REAL_LLM=true \
ANTHROPIC_API_KEY=sk-ant-... \
ELEVENLABS_API_KEY=... \
OPENAI_API_KEY=... \
BASE_URL=http://localhost:3003 \
E2E_GATEWAY_URL=http://localhost:4000 \
pnpm --filter=e2e test real-llm/
```

## Cost discipline

Each spec is budgeted to ≤ $0.10 per run (input + output + voice). Avoid
adding free-form long-context prompts here.

## What belongs here vs. mocked specs

- Mocked specs = UI behavior, SSE plumbing, selectors, state transitions.
- Real-LLM specs = prompt quality, provider compatibility, end-to-end
  semantic assertions ("response mentions X, Y, Z").
