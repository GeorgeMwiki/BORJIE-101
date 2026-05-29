/**
 * Borjie owner-web — artifact renderers public surface.
 *
 * Wave ARTIFACT-RICHNESS. Every cockpit surface that hosts a server-
 * rendered artifact (drafts, briefs, scans, decision journals,
 * inspection narratives, compliance exports, plan-DAGs, blackboards,
 * settlement statements, RFB confirmations, receipts) mounts the
 * same `ArtifactRenderer` so the chrome (header band, classification
 * badge, footer with audit hash, loading skeleton, empty-state copy,
 * print + dark-mode behaviour) is consistent across the product.
 *
 * Companion CSS lives in `artifact-renderer.css` and is imported by
 * the page that hosts the renderer (the Next.js layout pattern).
 */

export { ArtifactRenderer } from './ArtifactRenderer.js';
export type {
  ArtifactRendererProps,
  ArtifactClassification,
  ArtifactLanguage,
} from './ArtifactRenderer.js';
