// Finding public tutorials that guides.json doesn't list yet: sitemaps and index pages of
// docs sites already in the catalogue, GitHub wiki page lists, docs folders in product
// repositories, and a forum guides board. Each find becomes an unverified draft entry.
import { DEV_DOC, DOC_FOLDERS, GUIDE_FEEDS, NOT_A_GUIDE, SITES, WIKIS, type Part, type Site } from "./config.ts";
import { relevanceHits, themeOf } from "./classify.ts";
import { decodeEntities, parseFeed, type SourceStat, type GitHub } from "./harvest.ts";
import { SourceOriginMismatch, type Cache, type Fetcher } from "./http.ts";
import { earlierGuideUrlKeys, matchProducts, normalizeUrl, type Index } from "./project.ts";
import { listWikiPages } from "./wiki.ts";
import { readSitemap } from "./sitemap.ts";

export type Page = { url: string; lastmod: string | null; title?: string; language?: string | null };
export type Draft = {
  id: string; title: string; url: string; creator: string | null; publisher: string | null; language: string;
  kind: "article" | "video" | "docs"; published: null; covers: string[]; part: Part[]; words: string[]; answers: string[];
  review: { status: "unverified"; found_via: string; lastmod: string | null; first_seen: string; theme: string; inside: string | null; reasons: string[] };
};
export type Recheck = { guide: string; url: string; checked_on: string; lastmod: string; found_via: string };

// ---------- parsing ----------

export { parseSitemap } from "./sitemap.ts";

/** Same-site links on an index page. */
export function pageLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  const origin = new URL(base).origin;
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    try { const u = new URL(decodeEntities(href), base); if (u.origin === origin) out.add(u.origin + u.pathname); } catch {}
  }
  return [...out];
}

export function pageMeta(html: string): { title: string | null; language: string | null } {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
  const title = (og && decodeEntities(og).trim() ? og : undefined) ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const lang = html.match(/<html[^>]*\slang="([^"]+)"/i)?.[1] ?? null;
  return { title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() : null, language: lang ? lang.split("-")[0].toLowerCase() : null };
}

export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 8).join("-");
}

// ---------- drafts ----------

export function draftFor(page: Page & { title: string }, covers: string[], creator: string | null, foundVia: string, index: Index, today: string, kind: Draft["kind"] = "article"): Draft {
  const path = decodeURIComponent(new URL(page.url).pathname).replace(/[-_/]+/g, " ");
  const hay = `${page.title} ${path}`;
  const words = [...new Set(index.words.filter((w) => !w.generic && w.re.test(hay)).map((w) => w.id))];
  const products = new Set(covers);
  for (const product of matchProducts(page.title, index)) products.add(product);
  const { theme, part, why } = themeOf(page.title, path);
  // A page inside docs that guides.json already lists as a whole (a docs entry).
  const url = normalizeUrl(page.url);
  const inside = index.guides.find((g) => {
    const root = normalizeUrl(g.url);
    return g.kind === "docs" && (url === root || url.startsWith(root + "/"));
  })?.id ?? null;
  const reasons = [`listed on ${foundVia}`];
  if (why.length) reasons.push(`part from: ${why.slice(0, 4).join(", ")}`);
  if (page.lastmod) reasons.push(`page changed ${page.lastmod}`);
  const owner = covers.length === 1 ? covers[0] : null;
  return {
    id: slug(`${owner ?? "guide"} ${cleanTitle(page.title)}`),
    title: cleanTitle(page.title), url: page.url, creator, publisher: owner, language: page.language ?? "en",
    kind, published: null, covers: [...products], part: part ? [part] : [], words, answers: [],
    review: { status: "unverified", found_via: foundVia, lastmod: page.lastmod, first_seen: today, theme, inside, reasons },
  };
}

/** Keep a page when it is a likely tutorial for this site's rules. */
export function keepPath(url: string, site: { include?: string; exclude?: string }): boolean {
  const u = new URL(url);
  const path = u.pathname + u.search;
  if (path === "/" || path === "") return false;
  if (new RegExp(NOT_A_GUIDE, "i").test(path)) return false;
  if (site.include && !new RegExp(site.include, "i").test(path)) return false;
  if (site.exclude && new RegExp(site.exclude, "i").test(path)) return false;
  return true;
}

/** General sites: a page counts when its title and address show IRL signs. A strong sign counts
 *  twice; a glossary word or another catalogued product (not the site's own, not OBS) once. Two are needed. */
export function irlScore(text: string, index: Index, own: string[]): number {
  const h = relevanceHits(text);
  const words = new Set(index.words.filter((w) => !w.generic && w.re.test(text)).map((w) => w.id));
  const products = [...matchProducts(text, index)].filter((id) => !own.includes(id) && id !== "obs-studio");
  return 2 * h.strong.length + h.context.length + words.size + products.length;
}

/** Drop a trailing site name after a bar or a dash, such as " | Sample Docs". */
export function cleanTitle(title: string): string {
  const m = title.match(/^(.{12,}?)\s+[|\u2013\u2014]\s+([^|\u2013\u2014]+)$/);
  return m && /docs|guide|softvelum|openrtmp|ninja|knowledge|wiki|help/i.test(m[2]) ? m[1].trim() : title.trim();
}

/** Recover a legacy lowercased key only when the previous report identifies one exact URL. */
export function migrateGuideSeen(seen: Record<string, string>, previous: Pick<Draft, "url" | "review">[]): Record<string, string> {
  const grouped = new Map<string, Map<string, string>>();
  for (const draft of previous) {
    const key = normalizeUrl(draft.url);
    for (const legacy of earlierGuideUrlKeys(draft.url)) {
      const candidates = grouped.get(legacy) ?? new Map();
      candidates.set(key, draft.review.first_seen);
      grouped.set(legacy, candidates);
    }
  }
  const migrated = { ...seen };
  for (const [legacy, candidates] of grouped) {
    if (candidates.size !== 1) continue;
    const [key, firstSeen] = candidates.entries().next().value!;
    if (key !== legacy && (!migrated[key] || migrated[key] === firstSeen) && migrated[legacy] === firstSeen) {
      migrated[key] = firstSeen;
      delete migrated[legacy];
    }
  }
  return migrated;
}

export function guideTitleKey(url: string, origins = [new URL(url).origin]): string {
  return `guide-meta:${[...origins].sort().join(",")}:${url}`;
}

export type GuideRun = { drafts: Draft[]; rechecks: Recheck[]; stats: SourceStat[]; seen: Record<string, string> };

export async function discoverGuides(fetcher: Fetcher, cache: Cache, gh: GitHub, index: Index, today: string, previouslySeen: Record<string, string>, maxTitles = 60): Promise<GuideRun> {
  const drafts: Draft[] = [], rechecks: Recheck[] = [], stats: SourceStat[] = [];
  const seen: Record<string, string> = { ...previouslySeen };
  const guideByUrl = new Map(index.guides.map((g) => [normalizeUrl(g.url), g]));

  type Meta = ReturnType<typeof pageMeta> & { origin: string };

  async function consider(
    pages: Page[], site: Pick<Site, "name" | "covers" | "include" | "exclude" | "terms">, creator: string | null, kind: Draft["kind"],
    { titleFrom, byMaker = true, read = pages.length, sourceNote, allowedOrigins }: {
      titleFrom?: (page: Page) => string; byMaker?: boolean; read?: number; sourceNote?: string; allowedOrigins?: string[];
    } = {},
  ) {
    let kept = 0, fetched = 0, titlesRead = 0, deferred = 0, unavailable = 0, malformed = 0, stale = 0;
    const pending = [];
    const uniquePages = new Map<string, Page>();
    for (const page of pages) {
      const first = uniquePages.get(page.url);
      if (!first) uniquePages.set(page.url, page);
      else if (page.lastmod && page.lastmod > (first.lastmod ?? "")) uniquePages.set(page.url, { ...first, lastmod: page.lastmod });
    }
    for (const page of uniquePages.values()) {
      let path: string;
      try {
        path = decodeURIComponent(new URL(page.url).pathname).replace(/[-_/.]+/g, " ");
      } catch { malformed++; continue; }
      const norm = normalizeUrl(page.url);
      const listed = guideByUrl.get(norm);
      if (listed && page.lastmod && page.lastmod > listed.checked_on)
        rechecks.push({ guide: listed.id, url: page.url, checked_on: listed.checked_on, lastmod: page.lastmod, found_via: site.name });
      if (index.knownUrls.has(norm) || !keepPath(page.url, site)) continue;
      const title = titleFrom?.(page);
      const origins = allowedOrigins ?? [new URL(page.url).origin];
      const key = guideTitleKey(page.url, origins);
      const entry = title ? undefined : cache.entry<Meta | null>(key);
      const cached = entry?.value && !origins.includes(entry.value.origin) ? undefined : entry;
      const failedAt = title ? 0 : cache.entry<boolean>(`failed:${key}`)?.saved ?? 0;
      const lastAttempt = Math.max(failedAt, cached?.saved ?? 0);
      pending.push({ page, norm, path, title, cached, lastAttempt, key, origins });
    }
    // Unseen and oldest attempts go first, even if every cached title has expired.
    pending.sort((a, b) => a.lastAttempt - b.lastAttempt);
    for (const candidate of pending) {
      const { page, norm, path, cached, lastAttempt, key, origins } = candidate;
      let { title } = candidate;
      let language: string | null = null;
      if (!title) {
        let meta = cached?.value;
        let expired = !!meta?.title && Date.now() - (cached?.saved ?? 0) > 24 * 7 * 3600_000;
        const freshHours = lastAttempt > (cached?.saved ?? 0) || !meta ? 1 : 24 * 7;
        const due = Date.now() - lastAttempt > freshHours * 3600_000;
        if (!cache.offline && due && fetched < maxTitles) {
          fetched++;
          try {
            const document = await fetcher.document(page.url, { allowedOrigins: origins });
            const origin = new URL(document.url).origin;
            if (!origins.includes(origin)) throw new SourceOriginMismatch("title left the configured source");
            const parsed = pageMeta(document.text);
            if (!parsed.title) throw new Error("page has no usable title");
            meta = { ...parsed, origin };
            cache.set(key, meta);
            expired = false;
          } catch (error) {
            if (error instanceof SourceOriginMismatch) {
              meta = null;
              cache.set(key, meta);
            }
            cache.set(`failed:${key}`, true);
          }
        } else if (!cache.offline && due) {
          deferred++;
          if (!meta?.title) continue;
        }
        title = meta?.title ?? undefined;
        language = meta?.language ?? null;
        if (title) {
          titlesRead++;
          if (expired) stale++;
        }
        else unavailable++;
      }
      if (!title) continue;
      if (site.terms && irlScore(`${title} ${path}`, index, site.covers) < 2) continue;
      kept++;
      seen[norm] ??= today;
      const d = draftFor({ ...page, title, language }, site.covers, creator, site.name, index, seen[norm], kind);
      if (!byMaker) d.publisher = null;
      drafts.push(d);
    }
    const note = [
      sourceNote,
      malformed ? `${malformed} malformed page URLs ignored` : "",
      titlesRead ? `${titlesRead} page titles available` : "",
      stale ? `${stale} stale page titles reused` : "",
      unavailable ? `${unavailable} page titles unavailable` : "",
      deferred ? `${deferred} title lookups deferred` : "",
    ].filter(Boolean).join("; ");
    stats.push({ source: site.name, read, kept, note: note || undefined });
  }

  for (const site of SITES) {
    try {
      let pages: Page[] = [];
      let sourceNote: string | undefined;
      let allowedOrigins: string[] | undefined;
      if (site.sitemap) {
        allowedOrigins = [new URL(site.sitemap).origin, ...site.sitemapOrigins ?? []];
        const snapshot = await readSitemap(fetcher, cache, site.sitemap, undefined, allowedOrigins);
        pages = snapshot.pages;
        sourceNote = snapshot.note;
      } else if (site.index) {
        const url = site.index;
        const origins = [new URL(url).origin];
        const key = `index-final:${url}`;
        const legacy = cache.offline && !cache.entry(key) ? cache.get<Page[]>(`index:${url}`, 24) : undefined;
        if (legacy) sourceNote = "older HTML index cache";
        allowedOrigins = origins;
        pages = legacy ?? await cache.remember(key, 24, async () => {
          const document = await fetcher.document(url, { allowedOrigins: origins });
          return pageLinks(document.text, document.url).map((url) => ({ url, lastmod: null }));
        });
      }
      await consider(pages, site, creatorOf(site.covers, index), "article", { sourceNote, allowedOrigins });
    } catch (e) { stats.push({ source: site.name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }

  for (const wiki of WIKIS) {
    const name = `GitHub wiki ${wiki.repo}`;
    try {
      if (!gh.snapshotIsPublic(wiki.repo, Infinity)) throw new Error("GitHub wiki repository visibility withdrawn");
      const key = `wiki-tree:${wiki.repo}`;
      const legacy = cache.offline && !cache.entry(key) ? cache.entry<Page[]>(`wiki:${wiki.repo}`) : undefined;
      const pages = legacy?.value.map((page) => ({
        ...page, title: decodeURIComponent(new URL(page.url).pathname.split("/").at(-1)!).replace(/-/g, " ").trim(),
      })) ?? await cache.remember(key, 24, () => listWikiPages(fetcher, wiki.repo));
      const saved = (legacy ?? cache.entry(key))!.saved;
      if (!gh.snapshotIsPublic(wiki.repo, saved)) throw new Error("GitHub wiki repository visibility withdrawn");
      const filter = wiki.include ? new RegExp(wiki.include, "i") : null;
      const filtered = filter ? pages.filter((page) => filter.test(page.title)) : pages;
      await consider(filtered, { name, covers: wiki.covers, terms: wiki.terms }, creatorOf(wiki.covers, index), "article", { titleFrom: (page) => page.title, read: pages.length, sourceNote: [legacy ? "older wiki index cache" : undefined,
        cache.offline ? "public wiki snapshot from " + new Date(saved).toISOString().slice(0, 10) : undefined].filter(Boolean).join("; ") || undefined });
    } catch (e) { stats.push({ source: name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }

  for (const folder of DOC_FOLDERS) {
    const name = `GitHub docs ${folder.repo}`;
    try {
      // The cache keeps the whole file list; the filters run on every run so they can change.
      const key = `public-docs-tree:${folder.repo}`;
      const listing = await cache.remember(key, 24, async () => {
        const repo = await gh.rest(`/repos/${folder.repo}`);
        gh.observeVisibility(folder.repo, repo?.visibility?.toUpperCase());
        if (repo?.visibility !== "public" || repo.private !== false) throw new Error("GitHub docs repository visibility is not public");
        const tree = await gh.rest(`/repos/${folder.repo}/git/trees/${repo.default_branch}?recursive=1`);
        return { branch: repo.default_branch as string, paths: (tree.tree as any[]).filter((e) => e.type === "blob").map((e) => e.path as string) };
      });
      const saved = cache.entry(key)!.saved;
      if (!gh.snapshotIsPublic(folder.repo, saved)) throw new Error("GitHub docs repository visibility withdrawn");
      const pages = listing.paths
        .filter((p) => new RegExp(folder.include, "i").test(p) && !(folder.exclude && new RegExp(folder.exclude, "i").test(p)) && !new RegExp(DEV_DOC, "i").test(p))
        .map((p) => ({ url: `https://github.com/${folder.repo}/blob/${listing.branch}/${p}`, lastmod: null }));
      const title = (p: Page) => decodeURIComponent(p.url.split("/").slice(7).join("/")).replace(/^docs\//, "").replace(/\.mdx?$/i, "").replace(/\//g, ": ").replace(/[-_]+/g, " ").trim();
      await consider(pages, { name, covers: folder.covers }, creatorOf(folder.covers, index), "docs", { titleFrom: title, read: listing.paths.length,
        sourceNote: cache.offline ? "historical public visibility observed " + new Date(saved).toISOString().slice(0, 10) : undefined });
    } catch (e) { stats.push({ source: name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }

  for (const feed of GUIDE_FEEDS) {
    try {
      const key = `guide-feed:${feed.url}`;
      const legacy = cache.offline && !cache.entry(key) ? cache.get<(Page & { title: string })[]>(`rss:${feed.url}`, 20) : undefined;
      const items = legacy ?? await cache.remember(key, 20, async () => {
        const document = await fetcher.document(feed.url);
        return parseFeed(document.text, document.url).map((i) => ({ url: i.link, lastmod: i.date, title: i.title }));
      });
      // Forum guides are written by community members: no creator is recorded here; a reviewer fills it in.
      // The board is about OBS in general: keep only titles with a strong IRL sign.
      const relevant = items.filter((i) => relevanceHits(i.title).strong.length > 0);
      await consider(relevant, { name: feed.name, covers: feed.covers }, null, "article", { titleFrom: (p) => p.title ?? "", byMaker: false, read: items.length, sourceNote: legacy ? "older guide-feed cache" : undefined });
    } catch (e) { stats.push({ source: feed.name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }

  // One draft per page; the first source wins.
  const unique = new Map<string, Draft>();
  for (const d of drafts) if (!unique.has(normalizeUrl(d.url))) unique.set(normalizeUrl(d.url), d);
  return { drafts: [...unique.values()], rechecks, stats, seen };
}

function creatorOf(covers: string[], index: Index): string {
  return covers.map((c) => index.serviceName.get(c) ?? c).join(", ");
}
