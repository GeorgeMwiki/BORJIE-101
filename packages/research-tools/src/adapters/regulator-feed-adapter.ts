/**
 * Regulator feed adapter — Tumemadini / NEMC / TRA / BoT / GePG.
 *
 * DEEP_RESEARCH_SPEC §5.7: official Tanzanian regulators. Tumemadini
 * (Mining Commission) — RSS where available; otherwise scheduled scrape.
 * NEMC + TRA — gazette scrape. BoT — fx + monetary policy feed.
 *
 * Behaviour:
 *   - No API key required (public endpoints). Each regulator's base
 *     URL is env-overridable for tenant-specific scraping proxies.
 *   - Cache TTL: 1 hour (regulatory diffs aren't second-by-second).
 *   - Source class always classified as `tz_official` since every URI
 *     resolves to a .go.tz / .gov.tz host.
 *   - Returns one ResearchArtifact per feed item.
 *
 * @module @borjie/research-tools/adapters/regulator-feed-adapter
 */

import type {
  ResearchArtifact,
  ToolAdapter,
  ToolContext,
} from '../types.js';
import {
  buildArtifact,
  deriveArtifactId,
  pickLogger,
  readCache,
  readEnvKey,
  reserveBudget,
  safeFetch,
  writeCache,
} from './shared.js';

export const REGULATOR_NAME = 'regulator-feed';
export const REGULATOR_VERSION = '1.0.0';
export const REGULATOR_COST_CENTS = 0;
export const REGULATOR_TTL_SECONDS = 60 * 60;

export type RegulatorKind = 'tumemadini' | 'nemc' | 'tra' | 'bot' | 'gepg';

const DEFAULT_FEED_URLS: Readonly<Record<RegulatorKind, string>> = {
  tumemadini: 'https://www.tumemadini.go.tz/feed',
  nemc: 'https://www.nemc.or.tz/feed',
  tra: 'https://www.tra.go.tz/feed',
  bot: 'https://www.bot.go.tz/feed',
  gepg: 'https://www.gepg.go.tz/feed',
};

const ENV_OVERRIDE_KEYS: Readonly<Record<RegulatorKind, string>> = {
  tumemadini: 'TUMEMADINI_FEED_URL',
  nemc: 'NEMC_FEED_URL',
  tra: 'TRA_FEED_URL',
  bot: 'BOT_FEED_URL',
  gepg: 'GEPG_FEED_URL',
};

export interface RegulatorFeedInput {
  readonly regulator: RegulatorKind;
  readonly limit?: number;
  readonly since?: string; // ISO; filter items newer than this
}

export interface RegulatorFeedAdapterConfig {
  readonly feedUrls?: Partial<Record<RegulatorKind, string>>;
}

// ---------------------------------------------------------------------------
// Tiny dependency-free RSS / Atom parser
// ===========================================================================

interface FeedItem {
  readonly title: string;
  readonly link: string;
  readonly description: string;
  readonly pubDate: string | null;
}

/**
 * Parse a minimal subset of RSS 2.0 + Atom 1.0. Handles <item> + <entry>
 * tags. Robust enough for government feeds; never throws on malformed
 * XML — returns [] instead.
 *
 * Intentionally regex-based rather than pulling in a heavy XML
 * dependency: the package stays light, and the feed shapes are stable
 * enough that the regex is reliable in practice.
 */
export function parseFeed(xml: string): ReadonlyArray<FeedItem> {
  if (!xml || typeof xml !== 'string') return [];
  const out: Array<FeedItem> = [];

  const itemBlocks = extractBlocks(xml, ['item', 'entry']);
  for (const block of itemBlocks) {
    const title = extractFirstTag(block, ['title']) ?? '';
    const link = extractLink(block);
    const description =
      extractFirstTag(block, ['description', 'summary', 'content']) ?? '';
    const pubDate = extractFirstTag(block, ['pubDate', 'published', 'updated']);
    if (title.length === 0 && link.length === 0) continue;
    out.push({
      title: decodeXml(title),
      link,
      description: decodeXml(description),
      pubDate: pubDate ? pubDate.trim() : null,
    });
  }

  return out;
}

function extractBlocks(
  xml: string,
  tags: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const blocks: Array<string> = [];
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const content = m[1];
      if (typeof content === 'string') {
        blocks.push(content);
      }
    }
  }
  return blocks;
}

function extractFirstTag(
  block: string,
  tags: ReadonlyArray<string>,
): string | null {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = re.exec(block);
    if (m && typeof m[1] === 'string') {
      return stripCdata(m[1]).trim();
    }
  }
  return null;
}

function extractLink(block: string): string {
  // RSS: <link>https://...</link>
  const rss = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(block);
  if (rss && typeof rss[1] === 'string') {
    const text = stripCdata(rss[1]).trim();
    if (text.length > 0) return text;
  }
  // Atom: <link href="..." />
  const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  if (atom && typeof atom[1] === 'string') return atom[1];
  return '';
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// Adapter
// ===========================================================================

export function createRegulatorFeedAdapter(
  config: RegulatorFeedAdapterConfig = {},
): ToolAdapter<RegulatorFeedInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: REGULATOR_NAME,
    version: REGULATOR_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: REGULATOR_COST_CENTS,
    async invoke(
      input: RegulatorFeedInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const overrideUrl = config.feedUrls?.[input.regulator];
      const envUrl = readEnvKey(ENV_OVERRIDE_KEYS[input.regulator]);
      const url = overrideUrl ?? envUrl ?? DEFAULT_FEED_URLS[input.regulator];

      const cacheParams: Readonly<Record<string, unknown>> = {
        r: input.regulator,
        limit: input.limit ?? 25,
        since: input.since ?? '',
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: REGULATOR_NAME,
        params: cacheParams,
        ttl_seconds: REGULATOR_TTL_SECONDS,
      });
      if (cached) {
        logger.info('regulator: cache hit', { regulator: input.regulator });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: REGULATOR_COST_CENTS,
        logger,
        adapter: REGULATOR_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      const fetchResult = await safeFetch({
        url,
        init: { method: 'GET', headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } },
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(REGULATOR_COST_CENTS);
        logger.warn('regulator: fetch failed', {
          regulator: input.regulator,
          reason: fetchResult.reason,
        });
        return [];
      }

      const items = parseFeed(fetchResult.bodyText);
      const limit = Math.max(1, input.limit ?? 25);
      const sinceMs = input.since ? Date.parse(input.since) : null;
      const filtered = items
        .filter((it) => {
          if (sinceMs === null || !it.pubDate) return true;
          const ms = Date.parse(it.pubDate);
          return Number.isNaN(ms) ? true : ms >= sinceMs;
        })
        .slice(0, limit);

      const retrieved_at = new Date().toISOString();
      const artifacts: ReadonlyArray<ResearchArtifact> = filtered.map(
        (it, idx) => {
          const safeUri =
            it.link.length > 0 ? it.link : `${url}#item-${idx}`;
          const id = deriveArtifactId(ctx.step_id, safeUri, idx);
          const content = `${it.title}\n\n${it.description}`;
          const buildInput: Parameters<typeof buildArtifact>[0] = {
            id,
            step_id: ctx.step_id,
            source_uri: safeUri,
            source_kind: 'feed',
            title: it.title,
            content,
            excerpt: it.description.slice(0, 500),
            tool_name: REGULATOR_NAME,
            cost_usd_cents: 0,
            retrieved_at,
            is_fast_moving_topic: true,
            ...(it.pubDate ? { published_at: it.pubDate } : {}),
          };
          return buildArtifact(buildInput);
        },
      );

      await ctx.cost_tracker.commit(REGULATOR_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: REGULATOR_NAME,
          params: cacheParams,
          ttl_seconds: REGULATOR_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('regulator: ok', {
        regulator: input.regulator,
        items: artifacts.length,
      });
      return artifacts;
    },
  };
}
