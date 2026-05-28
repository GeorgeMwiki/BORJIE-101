/**
 * Brain-tool wrappers for media generation.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Registered alongside the drafter brain
 * tools so Mr. Mwikila can call them mid-chat:
 *
 *   mining.media.generate_image       — natural-language → PNG/URL
 *   mining.media.generate_chart       — data + kind → PNG/SVG
 *   mining.media.generate_diagram     — nodes + edges → SVG
 *   mining.media.generate_infographic — slots[] → SVG
 *
 * The handlers return base64-encoded payloads when no hosted URL is
 * available so the chat renderer can inline them directly.
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import { generateImage } from './image-generator.js';
import { generateChart } from './chart-generator.js';
import { generateDiagram } from './diagram-generator.js';
import { composeInfographic } from './infographic-composer.js';

function bufToBase64(buf: Buffer): string {
  return buf.toString('base64');
}

export function buildMediaGenerationTools(): readonly ToolHandler[] {
  const imageTool: ToolHandler = {
    name: 'mining.media.generate_image',
    description:
      'Generate an AI image from a natural-language prompt. Returns either a hosted URL or a base64 PNG.',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        size: { type: 'string', enum: ['512x512', '1024x1024', '1024x1792', '1792x1024'] },
        aspectRatio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:5'] },
        intent: { type: 'string', description: 'Why the image is needed (drives provider choice).' },
      },
    },
    async execute(params) {
      const prompt = typeof params['prompt'] === 'string' ? (params['prompt'] as string) : '';
      try {
        const out = await generateImage({
          prompt,
          ...(typeof params['size'] === 'string' ? { size: params['size'] as never } : {}),
          ...(typeof params['aspectRatio'] === 'string' ? { aspectRatio: params['aspectRatio'] as never } : {}),
          ...(typeof params['intent'] === 'string' ? { intent: params['intent'] as string } : {}),
        });
        return {
          ok: true,
          data: {
            url: out.url,
            base64: out.url ? null : bufToBase64(out.blob),
            mimeType: 'image/png',
            providerLabel: out.providerLabel,
            durationMs: out.durationMs,
          },
          evidenceSummary: `Generated image (${out.providerLabel}, ${out.durationMs}ms)`,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const chartTool: ToolHandler = {
    name: 'mining.media.generate_chart',
    description: 'Render a bar / line / pie chart server-side and return SVG.',
    parameters: {
      type: 'object',
      required: ['kind', 'data', 'title'],
      properties: {
        kind: { type: 'string', enum: ['bar', 'line', 'pie'] },
        title: { type: 'string' },
        data: { type: 'array', description: 'Array of {label, value, color?} entries.' },
      },
    },
    async execute(params) {
      try {
        const out = generateChart({
          kind: (typeof params['kind'] === 'string' ? params['kind'] : 'bar') as 'bar' | 'line' | 'pie',
          title: typeof params['title'] === 'string' ? (params['title'] as string) : 'Chart',
          data: Array.isArray(params['data']) ? (params['data'] as never) : [],
        });
        return {
          ok: true,
          data: {
            base64: bufToBase64(out.svg),
            mimeType: out.contentType,
            durationMs: out.durationMs,
          },
          evidenceSummary: `Generated ${typeof params['kind'] === 'string' ? params['kind'] : 'bar'} chart`,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const diagramTool: ToolHandler = {
    name: 'mining.media.generate_diagram',
    description: 'Render a small flow / org / process diagram from nodes + edges.',
    parameters: {
      type: 'object',
      required: ['nodes', 'edges'],
      properties: {
        kind: { type: 'string', enum: ['flow', 'org', 'process'] },
        nodes: { type: 'array' },
        edges: { type: 'array' },
        title: { type: 'string' },
      },
    },
    async execute(params) {
      try {
        const out = generateDiagram({
          kind: (typeof params['kind'] === 'string' ? params['kind'] : 'flow') as 'flow' | 'org' | 'process',
          nodes: Array.isArray(params['nodes']) ? (params['nodes'] as never) : [],
          edges: Array.isArray(params['edges']) ? (params['edges'] as never) : [],
          ...(typeof params['title'] === 'string' ? { title: params['title'] as string } : {}),
        });
        return {
          ok: true,
          data: {
            base64: bufToBase64(out.svg),
            mimeType: out.contentType,
            durationMs: out.durationMs,
          },
          evidenceSummary: 'Generated diagram',
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const infographicTool: ToolHandler = {
    name: 'mining.media.generate_infographic',
    description: 'Compose a 1-page infographic from labelled slots (hero, kpi, stat, callout).',
    parameters: {
      type: 'object',
      required: ['title', 'slots'],
      properties: {
        title: { type: 'string' },
        slots: { type: 'array' },
        footer: { type: 'string' },
      },
    },
    async execute(params) {
      try {
        const out = composeInfographic({
          title: typeof params['title'] === 'string' ? (params['title'] as string) : 'Infographic',
          slots: Array.isArray(params['slots']) ? (params['slots'] as never) : [],
          ...(typeof params['footer'] === 'string' ? { footer: params['footer'] as string } : {}),
        });
        return {
          ok: true,
          data: {
            base64: bufToBase64(out.svg),
            mimeType: out.contentType,
            durationMs: out.durationMs,
          },
          evidenceSummary: 'Generated infographic',
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [imageTool, chartTool, diagramTool, infographicTool];
}
