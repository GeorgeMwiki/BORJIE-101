// Local type stub for `pdf-parse` — the upstream package ships no `.d.ts`.
// We declare only the surface this codebase consumes.
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  }
  function pdfParse(buf: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
