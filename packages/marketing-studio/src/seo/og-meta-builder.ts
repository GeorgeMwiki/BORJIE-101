/**
 * OpenGraph + Twitter Card meta builder. Returns the raw `<meta>` tag
 * block to be embedded in the HTML head.
 */

export interface OgMetaArgs {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly image?: string;
  readonly site_name?: string;
  readonly twitter_handle?: string;
  readonly type?: 'website' | 'article';
}

export function buildOgMeta(args: OgMetaArgs): string {
  const lines: Array<string> = [];
  const push = (property: string, content: string): void => {
    if (content.length === 0) return;
    lines.push(`<meta property="${escapeAttr(property)}" content="${escapeAttr(content)}" />`);
  };
  const pushTw = (name: string, content: string): void => {
    if (content.length === 0) return;
    lines.push(`<meta name="${escapeAttr(name)}" content="${escapeAttr(content)}" />`);
  };

  push('og:title', args.title);
  push('og:description', args.description);
  push('og:url', args.url);
  push('og:type', args.type ?? 'website');
  if (args.site_name !== undefined) push('og:site_name', args.site_name);
  if (args.image !== undefined) push('og:image', args.image);

  pushTw('twitter:card', args.image !== undefined ? 'summary_large_image' : 'summary');
  pushTw('twitter:title', args.title);
  pushTw('twitter:description', args.description);
  if (args.twitter_handle !== undefined) {
    pushTw('twitter:site', args.twitter_handle);
  }
  if (args.image !== undefined) {
    pushTw('twitter:image', args.image);
  }

  return lines.join('\n');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
