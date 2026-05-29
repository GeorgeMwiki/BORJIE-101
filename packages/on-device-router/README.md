# @borjie/on-device-router

**Status:** STUB — Roadmap R4. **DO NOT BUILD UNTIL Q4 2026.**

Pre-network intent router stub. `routeOnDevice(prompt)` returns
`{ toolId: null, confidence: 0 }` so callers can wire the routing
slot today without behaviour change. The real ONNX implementation
ships when the pilot SLO data justifies the bundle-size cost.

See `Docs/research/ON_DEVICE_MINILM_ROUTER.md` for the architecture,
model selection matrix, and gate criterion.
