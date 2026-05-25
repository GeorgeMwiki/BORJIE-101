# @borjie/document-intelligence

Document ingestion pipeline: scan (`ScannerCamera` output), OCR, embeddings, and RAG chat. Provider adapters stub out Textract / OpenAI until credentials land.

## Run

```bash
pnpm --filter @borjie/document-intelligence dev
```

Key services: `src/scan/`, `src/services/embedding-service.ts`, `src/services/document-chat.service.ts`.
