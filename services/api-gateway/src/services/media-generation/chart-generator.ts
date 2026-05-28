/**
 * Server-side chart renderer.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Renders bar / line / pie charts to SVG
 * (with PNG-compatible fallback wrapping) for embedding in PDFs, PPTX
 * slides and email-friendly HTML. No external deps: pure SVG written
 * by string composition. Output: SVG Buffer + a synthetic content-type
 * marker the caller maps to `image/svg+xml`.
 *
 * The output is deterministic for a given input — useful for tests
 * and audit replay.
 */

export type ChartKind = 'bar' | 'line' | 'pie';

export interface ChartSeries {
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}

export interface GenerateChartInput {
  readonly kind: ChartKind;
  readonly title: string;
  readonly data: ReadonlyArray<ChartSeries>;
  readonly width?: number;
  readonly height?: number;
}

export interface GenerateChartOutput {
  readonly svg: Buffer;
  readonly contentType: string;
  readonly durationMs: number;
}

const BRAND_PALETTE: ReadonlyArray<string> = [
  '#C8A24B', '#0B0D12', '#5C5F66', '#F7F5EE', '#8A6F37', '#B4944A',
];

export function generateChart(input: GenerateChartInput): GenerateChartOutput {
  const start = Date.now();
  if (!input.data || input.data.length === 0) {
    throw new Error('chart-generator: data must contain at least one series');
  }
  const w = input.width ?? 640;
  const h = input.height ?? 360;
  let chart: string;
  if (input.kind === 'bar') chart = renderBarChart(input, w, h);
  else if (input.kind === 'line') chart = renderLineChart(input, w, h);
  else chart = renderPieChart(input, w, h);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter,Helvetica,Arial,sans-serif">
  <rect width="${w}" height="${h}" fill="#FFFFFF"/>
  <text x="24" y="32" font-size="16" font-weight="700" fill="#0B0D12">${escape(input.title)}</text>
  ${chart}
  <text x="${w - 8}" y="${h - 8}" text-anchor="end" font-size="10" fill="#5C5F66">Borjie</text>
</svg>`;
  return {
    svg: Buffer.from(svg, 'utf8'),
    contentType: 'image/svg+xml',
    durationMs: Date.now() - start,
  };
}

function renderBarChart(input: GenerateChartInput, w: number, h: number): string {
  const top = 56;
  const bot = 40;
  const left = 48;
  const right = 24;
  const chartW = w - left - right;
  const chartH = h - top - bot;
  const max = Math.max(...input.data.map((d) => d.value), 1);
  const barW = chartW / input.data.length;
  const bars = input.data
    .map((d, i) => {
      const color = d.color ?? BRAND_PALETTE[i % BRAND_PALETTE.length] ?? '#C8A24B';
      const barH = (d.value / max) * chartH;
      const x = left + i * barW + barW * 0.15;
      const y = top + (chartH - barH);
      return `<rect x="${x}" y="${y}" width="${barW * 0.7}" height="${barH}" fill="${color}"/>
      <text x="${x + (barW * 0.35)}" y="${h - bot + 16}" text-anchor="middle" font-size="11" fill="#0B0D12">${escape(d.label)}</text>
      <text x="${x + (barW * 0.35)}" y="${y - 4}" text-anchor="middle" font-size="11" fill="#5C5F66">${d.value}</text>`;
    })
    .join('');
  return bars;
}

function renderLineChart(input: GenerateChartInput, w: number, h: number): string {
  const top = 56;
  const bot = 40;
  const left = 48;
  const right = 24;
  const chartW = w - left - right;
  const chartH = h - top - bot;
  const max = Math.max(...input.data.map((d) => d.value), 1);
  const stepX = input.data.length > 1 ? chartW / (input.data.length - 1) : 0;
  const pts = input.data.map((d, i) => {
    const x = left + i * stepX;
    const y = top + chartH - (d.value / max) * chartH;
    return `${x},${y}`;
  });
  const path = `M ${pts.join(' L ')}`;
  const dots = input.data
    .map((d, i) => {
      const x = left + i * stepX;
      const y = top + chartH - (d.value / max) * chartH;
      return `<circle cx="${x}" cy="${y}" r="3" fill="#C8A24B"/><text x="${x}" y="${h - bot + 16}" text-anchor="middle" font-size="11" fill="#0B0D12">${escape(d.label)}</text>`;
    })
    .join('');
  return `<path d="${path}" stroke="#C8A24B" stroke-width="2" fill="none"/>${dots}`;
}

function renderPieChart(input: GenerateChartInput, w: number, h: number): string {
  const cx = w / 2;
  const cy = (h + 16) / 2;
  const r = Math.min(w, h) / 3;
  const total = input.data.reduce((s, d) => s + d.value, 0) || 1;
  let start = -Math.PI / 2;
  const slices = input.data
    .map((d, i) => {
      const angle = (d.value / total) * Math.PI * 2;
      const end = start + angle;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = angle > Math.PI ? 1 : 0;
      const color = d.color ?? BRAND_PALETTE[i % BRAND_PALETTE.length] ?? '#C8A24B';
      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      start = end;
      return `<path d="${path}" fill="${color}" stroke="#FFFFFF" stroke-width="1"/>`;
    })
    .join('');
  return slices;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
