# AI Agent Security — SOTA 2026 (SEC-4 / Mr. Mwikila)

**Owner:** SEC-4 (Mr. Mwikila persona)
**Status:** Active — `@borjie/agent-security-guard` package live, migration `0054_agent_security.sql` applied
**Last updated:** 2026-05-26

This document is the authoritative threat model and defense surface for every AI-agent attack vector inside Borjie. It is intentionally deeper than the OWASP top-line lists — Mr. Mwikila has T0/T1/T2 authority tiers, ambient listening, ephemeral software generation, MCP outbound, multi-tenant data — *every* one of those is an attack surface.

---

## 1. Research citations

All deep references used to construct this spec. Every entry is `URL — Title — Date`.

1. `https://genai.owasp.org/llm-top-10/` — *OWASP Top 10 for Large Language Model Applications v2025* — Nov 2024 (covers LLM01–LLM10 2025 revision)
2. `https://atlas.mitre.org/` — *MITRE ATLAS — Adversarial Threat Landscape for Artificial-Intelligence Systems* — accessed 2026-05
3. `https://www.nist.gov/itl/ai-risk-management-framework` — *NIST AI Risk Management Framework (AI RMF 1.0)* — Jan 2023 (+ Generative AI Profile NIST AI 600-1, Jul 2024)
4. `https://www.anthropic.com/news/anthropics-responsible-scaling-policy` — *Anthropic Responsible Scaling Policy* — Sep 2023 (v2 Oct 2024)
5. `https://openai.com/policies/usage-policies/` and `https://openai.com/index/our-approach-to-ai-safety/` — *OpenAI Usage Policies + Approach to AI Safety* — Apr 2023, refreshed 2024–2025
6. `https://ai.google/responsibility/principles/` and `https://blog.google/technology/safety-security/google-ai-cybersecurity-summit/` — *Google AI Principles + Safe AI Framework (SAIF)* — Jun 2023 / refreshed 2025
7. `https://arxiv.org/abs/2302.12173` — *Greshake et al., "Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection"* — 23 Feb 2023 (the foundational indirect-injection paper)
8. `https://simonwillison.net/2023/Apr/14/worst-that-can-happen/` — *Simon Willison, "The Dual LLM pattern for building AI assistants that can resist prompt injection"* — 14 Apr 2023 (chronicles ChatGPT Markdown-image exfiltration vector)
9. `https://arxiv.org/abs/2404.02151` — *Anil et al., "Many-shot Jailbreaking"* (Anthropic) — Apr 2024
10. `https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback` — *Bai et al., Constitutional AI* — Dec 2022 (RLAIF)
11. `https://arxiv.org/abs/2305.14387` — *Carlini et al., "Extracting Training Data from Large Language Models"* — USENIX 2021, follow-ups 2023
12. `https://arxiv.org/abs/2310.13345` — *Pasquini et al., "Neural Exec: Learning (and Learning from) Execution Triggers for Prompt Injection Attacks"* — Oct 2023
13. `https://arxiv.org/abs/2402.06363` — *Wei et al., "Jailbroken: How Does LLM Safety Training Fail?"* — Feb 2024
14. `https://embracethered.com/blog/posts/2023/markdown-image-prompt-injection-exfil/` — *Johann Rehberger, "Markdown Image Prompt Injection Exfiltration in ChatGPT"* — Apr 2023 (the canonical Markdown-image data-exfil incident write-up)
15. `https://arxiv.org/abs/2307.15043` — *Zou et al., "Universal and Transferable Adversarial Attacks on Aligned Language Models"* (GCG) — Jul 2023

Supplementary primary sources consulted: Cohere "Tool-use safety" tech note (2024-06); LangChain "Security best practices" guide (2025-02); Microsoft "Prompt shields" (Azure AI Studio, GA 2024-04); LLM-Guard project (Protect AI, 2024-2025).

---

## 2. Threat model per Borjie surface

| Surface | Trust boundary | Adversary | Primary STRIDE | Primary OWASP LLM |
|---|---|---|---|---|
| `chat-ui` text input | Untrusted user | Anyone with valid session | Tampering, Info disclosure | LLM01 Prompt Injection |
| `ambient-listener` audio | Untrusted environment | Anyone within mic range | Spoofing, Info disclosure | LLM01 (indirect via voice) |
| `mcp` outbound calls | Half-trusted external system | Compromised MCP server | Tampering, Elevation | LLM07 System-Prompt Leakage, LLM08 Vector/Embedding |
| `internal-software-generator` (ephemeral SW) | Server-side, T2-authority | Crafted user request triggering code-gen | Elevation, Tampering | LLM05 Improper Output Handling |
| Tool-use (any) | Server-side | Prompt-injected upstream | Elevation, Tampering | LLM06 Excessive Agency |
| `file-ingest` / `document-analysis` | Untrusted documents | Adversarial PDF / HTML | Tampering, Info disclosure | LLM01 indirect, LLM04 Data Poisoning |
| `language-self-improve` ingest | Curated, but sourced from user input | Tenant submitting poisoned utterances | Tampering | LLM04 Data and Model Poisoning |
| `graph-rag-router` retrieval | Mixed-trust | Poisoned KB doc | Info disclosure, Tampering | LLM08 Vector/Embedding Weaknesses |
| Cross-tenant boundary | Hard isolation | Privilege escalation via prompt | Info disclosure | LLM02 Sensitive Info, LLM06 Excessive Agency |
| `persona-runtime` (Mr. Mwikila) | Trusted but high-privilege | Operator coercion via prompt | Elevation | LLM07 System-Prompt Leakage |

---

## 3. OWASP LLM Top 10 (2025) — coverage matrix

| ID | Name | Borjie surfaces | Defense package | Status |
|---|---|---|---|---|
| **LLM01** | Prompt Injection (direct + indirect) | chat, voice, file-ingest, mcp, ambient | `agent-security-guard/detect/prompt-injection-detector.ts` + `indirect-injection-detector.ts` | covered |
| **LLM02** | Sensitive Information Disclosure | chat output, mcp, ephemeral-sw | `agent-security-guard/filter/output-filter.ts` (PII scrubber) + `data-protection` package | covered |
| **LLM03** | Supply Chain | Model weights, MCP servers, embeddings | `ai-bom.json` + `mcp` allow-list + Trivy + AI-BOM CI | covered (pre-existing) |
| **LLM04** | Data and Model Poisoning | language-self-improve, file-ingest, graph-rag | `agent-security-guard` (input scoring) + `bias-handling` + `fairness-eval` | covered (this wave adds detection) |
| **LLM05** | Improper Output Handling | ephemeral-sw, dynamic-ui, mcp | `output-filter.ts` (Markdown-image strip, code-fence whitelist) | covered |
| **LLM06** | Excessive Agency | Any agent calling tools | `sandbox/tool-use-validator.ts` (authority tier + tenant policy) | covered |
| **LLM07** | System-Prompt Leakage | All channels | `output-filter.ts` (system-prompt regex) + persona prompt sealing | covered |
| **LLM08** | Vector / Embedding Weaknesses | graph-rag, cognitive-memory | `indirect-injection-detector.ts` (scans retrieved chunks) | covered |
| **LLM09** | Misinformation (hallucination) | chat, report-engine, executive-brief | `conformal-calibration-online` + `extended-reasoning` verifiers | covered (pre-existing) |
| **LLM10** | Unbounded Consumption | All channels | `llm-budget-governor` + per-tenant token caps | covered (pre-existing) |

---

## 4. MITRE ATLAS technique coverage

ATLAS techniques mapped onto our scenario corpus (`packages/agent-security-guard/src/redteam/builtin-scenarios.ts`):

| ATLAS ID | Technique | Scenario |
|---|---|---|
| AML.T0040 | ML Model Inference API Access | `mcp_unauthorized_tool_call` |
| AML.T0043 | Craft Adversarial Data | `craft_adversarial_swahili_pii_exfil` |
| AML.T0048 | Erode ML Model Integrity | `data_poisoning_via_ingest` |
| AML.T0050 | Command and Scripting Interpreter | `code_execution_request` |
| AML.T0051 | LLM Prompt Injection: Direct | `direct_ignore_previous_instructions` |
| AML.T0051.001 | LLM Prompt Injection: Indirect | `indirect_html_comment_instruction` |
| AML.T0053 | LLM Plugin Compromise | `mcp_plugin_compromise_simulation` |
| AML.T0054 | LLM Jailbreak | `many_shot_jailbreak` + `dan_persona` |
| AML.T0055 | Unsecured Credentials | `system_prompt_extraction` |
| AML.T0056 | Backdoor ML Model | `backdoor_trigger_phrase_detection` |
| AML.T0057 | LLM Data Leakage | `markdown_image_exfil` |

---

## 5. NIST AI RMF (1.0) mapping

NIST AI RMF functions: **Govern, Map, Measure, Manage**.

- **Govern** — `Docs/SECURITY/AI_AGENT_SECURITY_SOTA_2026.md` (this doc), `autonomy-governance` package, `ethics-framework` package, `FOUNDER_LOCKED_DECISIONS_2026_05_26.md`.
- **Map** — `agent-security-guard/redteam/builtin-scenarios.ts` enumerates surfaces × OWASP × ATLAS.
- **Measure** — `red_team_runs` table records `attacks_attempted / blocked / succeeded` per run, daily CI workflow surfaces in GitHub Step Summary.
- **Manage** — `agent_security_signals` table feeds the `dispatch-router` package and SEV-1 alerts; `output_filter_blocks` + `tool_use_violations` provide tamper-evident audit chain (audit_hash + prev_hash where applicable).

The Generative AI Profile (NIST AI 600-1) GV/MP/MS/MG-specific control families covered: GV-1.1 (policies), MP-1.1 (context), MS-2.7 (security-incident detection), MG-2.4 (incident response).

---

## 6. Defense layers per OWASP category

### LLM01 — Prompt Injection

**Direct:**
- Pattern detector against known-attack list (45 patterns covering "ignore previous instructions", role-play override, system-prompt extraction, base64-encoded injection, language-switch attack, etc.).
- LLM-judge ensemble (gated; uses `brain-llm-router` cheap-tier when enabled).
- Severity grading → critical patterns auto-block; medium/low patterns logged + flagged for review.

**Indirect:**
- `indirect-injection-detector.ts` scans every tool output + every retrieved doc chunk for:
  - HTML comments containing imperative verbs
  - Hidden `<style>` / `<script>` blocks
  - Zero-width-character payloads (U+200B/C/D)
  - Markdown links to credential-style endpoints
  - "AI: ignore" / "Assistant:" injection markers
- Detected payloads are **stripped** before the content is presented to the model. The redaction is preserved with diffs in `prompt_injection_attempts.redacted_input`.

### LLM02 — Sensitive Information Disclosure
- Output filter integrates with `data-protection` package PII scrubber.
- No raw `process.env` ever serialised into model context.
- `mcp` calls log only redacted argument shape (zod schema, no values).

### LLM05 — Improper Output Handling
- Markdown image URLs allow-listed (e.g. own CDN). Any other image domain is stripped *before* render — this is the canonical defense against the Markdown-image exfil attack (Rehberger 2023, citation 14).
- Code blocks in chat-ui are *displayed as text*, never executed. `internal-software-generator` outputs must go through a separate signed-pipeline.

### LLM06 — Excessive Agency
- Every tool call passes through `sandbox/tool-use-validator.ts`:
  1. Validate the tool name exists in `capability-catalogue`.
  2. Validate the user's authority tier (T0 = read-only; T1 = mutate within tenant; T2 = cross-tenant or money movement) matches the tool's required tier.
  3. Validate arguments through `argument-sanitizer.ts` zod schema.
  4. If destructive + amount over policy threshold → **require-confirmation** (return `requireConfirmation` decision; runtime must collect human ack).
- Violations recorded in `tool_use_violations` table.

### LLM07 — System-Prompt Leakage
- Output filter regex strips known system-prompt patterns ("You are Mr. Mwikila…", `<<<persona>>>`, etc.).
- The full persona system prompt is *never* allowed in chat output. Detected leak triggers severity=high signal.

### LLM08 — Vector/Embedding Weaknesses
- Same `indirect-injection-detector.ts` runs over every chunk retrieved by `graph-rag-router`.
- Suspicious chunks are removed from the context window pre-prompt, surface a `vector_chunk_blocked` signal.

### LLM10 — Unbounded Consumption
- `llm-budget-governor` (pre-existing) enforces per-tenant, per-user, per-hour caps; the new package emits a `consumption_anomaly` signal if a session spikes 10× its 24-hr rolling baseline.

---

## 7. Jailbreak defenses (LLM01-adjacent)

- **Many-shot detection** (`jailbreak/jailbreak-detector.ts`): triggers when ≥8 fake-turn delimiters ("User:", "Assistant:", "###") appear in a single user message — the Anil et al. 2024 attack vector.
- **DAN-style detection**: pattern match against canonical DAN ("Do Anything Now"), STAN, DUDE persona-override seed prompts.
- **GCG-suffix detection**: nonsensical token suffixes >40 chars without natural-language structure → flagged (Zou et al. 2023).
- **Universal jailbreak detection**: code-execution + role-play stacking.

All jailbreak hits → `prompt_injection_attempts` with `attack_kind='jailbreak'` and severity `high`.

---

## 8. Tool-use sandbox

Authority tier matrix:

| Tier | Description | Example tools |
|---|---|---|
| T0 | Read-only, in-tenant | `search_documents`, `read_user_profile` |
| T1 | Mutate within own tenant | `create_task`, `send_message`, `update_record` |
| T2 | Cross-tenant or money / external commit | `transfer_funds`, `execute_contract_action`, `delete_user` |

Rules:
1. User cannot escalate beyond their assigned tier — checked against `authz-policy` package.
2. T2 tool calls always require a confirmation step + audit signature.
3. Argument values must match the tool's zod schema *exactly*; any unknown field is a violation.
4. Recursive tool calls (tool whose output spawns another tool) are bounded to depth = 4 + width = 6.

---

## 9. Data poisoning (LLM04) defenses for `language-self-improve` ingest

The Wave 19K self-improvement loop ingests user utterances and trains LoRA adapters. Poisoning vector: tenant submits 10 000 utterances all redefining a regulatory term wrongly.

Defenses:
- Per-tenant + per-user submission caps (rate-limit at ingest).
- Outlier detection against the base 200-entry gauntlet — any tenant whose pair-distribution diverges >3 σ from baseline triggers a `data_poisoning_signal`.
- Adapter promotion requires gauntlet regression test pass (already in Wave 19K).
- Quarantine policy: a flagged tenant's adapter is `staged` only, never auto-promoted.

---

## 10. Ephemeral software generation (`internal-software-generator`)

Surface: Mr. Mwikila can generate ephemeral TypeScript code that the runtime executes. Highest-risk surface.

Defenses:
- All generated code runs in a vm2/isolate sandbox — no `process`, `fs`, `child_process`, `require` of disallowed modules.
- Output filter blocks any code that calls `eval`, `Function(`, network egress to non-allow-list, or filesystem outside the sandbox tmpdir.
- AST scan via a built-in linter rule (already enforced by `eslint-rules`).
- Every ephemeral execution emits `agent_security_signals` row with `signal_kind='ephemeral_exec'`.

---

## 11. Red-team scenarios (acceptance criteria)

The runner exercises 30+ scenarios, grouped:

- **OWASP LLM01 — direct**: 6 scenarios (ignore-instructions, role-play, base64-injection, language-switch, mid-token-split, system-prompt-leak request)
- **OWASP LLM01 — indirect**: 4 (HTML comment, hidden CSS, zero-width injection, retrieved-doc instruction)
- **OWASP LLM02 — sensitive info**: 3 (PII fishing, credential extraction, environment-variable dump)
- **OWASP LLM04 — poisoning**: 2 (low-quality dump, distribution-shift)
- **OWASP LLM05 — output handling**: 3 (markdown-image exfil, JS-in-output, JSON-injection)
- **OWASP LLM06 — excessive agency**: 4 (T2-from-T0, missing-confirmation, recursive-tool-bomb, cross-tenant)
- **OWASP LLM07 — system prompt leakage**: 2 (direct ask, role-play ask)
- **OWASP LLM08 — vector poisoning**: 2 (poisoned KB, repeated-injection vector)
- **OWASP LLM10 — consumption**: 2 (token bomb, recursion bomb)
- **Jailbreaks**: 3 (many-shot, DAN, GCG suffix)

**Acceptance**: zero HIGH or CRITICAL scenario succeeds. CI fails build if `attacks_succeeded > 0` at severity ≥ high.

---

## 12. SOTA 2026 defense techniques referenced

- **Constitutional AI / RLAIF** (Bai et al. 2022, citation 10) — used implicitly via Anthropic + OpenAI safety-trained base models. The persona-runtime overlays a per-tenant constitution from `ethics-framework` package.
- **Debate models** (Irving et al. 2018; refreshed via property-voices-debate package in this repo) — for high-stakes decisions, two adversarial Mr. Mwikila instances cross-examine before commit.
- **Recursive reward modeling** — `post-training-rlvr` package implements rejection sampling + verifier ensembles.
- **Output certification** — `conformal-calibration-online` provides distribution-free output confidence intervals; below-threshold outputs route to a human.
- **Dual LLM pattern** (Willison, citation 8) — privileged LLM is firewalled from untrusted content; untrusted content goes through quarantined LLM, only sanitized summaries cross the boundary.

---

## 13. Operating runbook

1. Daily: red-team CI workflow runs `red_team_runs` against staging. Failures page on-call.
2. Per-PR: `borjie-semgrep.yml` + `borjie-codeql.yml` run static analysis incl. injection patterns.
3. On signal: severity ≥ high in `agent_security_signals` triggers a `dispatch-router` notify with the offending `audit_hash`.
4. Quarterly: rotate the prompt-injection pattern corpus from public CVE feeds + ATLAS updates.
5. On CRITICAL incident: invoke SEV-1 playbook from `Docs/operations/`, freeze the affected surface flag in `feature-flags-adapter`, kick a forensic replay against the `worm-audit-log` chain.

---

End of spec. SEC-4 / Mr. Mwikila — 2026-05-26.
