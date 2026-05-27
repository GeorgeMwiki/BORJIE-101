# @borjie/document-composer

Thin ergonomic façade that unifies the BORJIE document/template/research/brand/render
packages into one entrypoint, with provenance + citation stamping and a tenant-isolated
hash chain on every emitted document.

## Quick start

```ts
import {
  createDocumentComposer,
  type ComposeInput,
} from '@borjie/document-composer';

const composer = createDocumentComposer({
  templateRegistry,  // wrap @borjie/document-templates here
  brandResolver,     // wrap @borjie/content-studio / @borjie/report-engine here
  renderer,          // wrap @borjie/report-engine / presentation-engine / etc.
  ocsfEmitter,       // optional: wrap @borjie/ocsf-emitter
});

const input: ComposeInput = {
  templateId: 'tpl_quarterly_brief',
  brandProfileId: 'brand_mwikila',
  renderTarget: 'pdf',
  persona: 'Mr. Mwikila',
  tenantId: 'tenant_mwikila',
  researchSources: [
    {
      uri: 'https://nemc.go.tz/regs/2025-q4',
      title: 'NEMC Q4 2025 environmental filing rules',
      content: 'Filings must include mineral rights citation per s.14.',
    },
  ],
};

const doc = await composer.composeDocument(input);

doc.id;            // uuid
doc.content;       // rendered output (pdf/docx/pptx/html/md string)
doc.provenance;    // ProvenanceStamp (composer version, tenant, persona, target)
doc.citations;     // Citation[] each with contentHash for tamper-evidence
doc.hashChain;     // 2-row chain sealed via @borjie/audit-hash-chain
```

## Architecture

- **Ports, not packages.** Every wrapped engine is reached through a `Port`
  interface (`TemplateRegistryPort`, `BrandResolverPort`, `RendererPort`,
  `OcsfEmitterPort`). The composer pins zero heavyweight runtime deps; callers
  wire real adapters at construction time.
- **Boundary validation.** Inputs are parsed with Zod
  (`ComposeInputSchema`); malformed payloads raise `InvalidComposeInputError`.
- **Tenant isolation.** Every call carries `tenantId`. Brand-profile resolution
  checks that the brand's `tenantId` matches the caller; cross-tenant access
  raises `BrandLockViolationError`.
- **Provenance.** Each citation records `sourceUri`, `sourceTitle`, `accessedAt`,
  and `contentHash = sha256(content)`. The full document is sealed into a
  two-row hash chain (provenance row + content row) via
  `@borjie/audit-hash-chain`. The chain entries are returned on
  `ComposedDocument.hashChain` so callers can persist them in their audit table.
- **OCSF emission.** When an `OcsfEmitterPort` is supplied, the composer fires
  one `document.composed` event per call (success or failure). Emission
  failures are swallowed so the SIEM bus cannot crash the compose path.

## Render targets

Closed set: `pdf | docx | pptx | html | md`. The renderer port is free to
implement only the subset the caller needs — anything missing returns a
renderer error that surfaces with stage `render` on the OCSF channel.

## Errors

| Error | Code | When |
|---|---|---|
| `MissingTemplateError` | `document_composer.missing_template` | Template registry returns `undefined` or throws. |
| `BrandLockViolationError` | `document_composer.brand_lock_violation` | Brand profile not found OR belongs to a different tenant. |
| `CitationNotFoundError` | `document_composer.citation_not_found` | A research source has empty content. |
| `InvalidComposeInputError` | `document_composer.invalid_input` | `ComposeInput` fails Zod validation. |
