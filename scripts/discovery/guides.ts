// Finding public tutorials that guides.json doesn't list yet: sitemaps and index pages of
// docs sites already in the catalogue, GitHub wiki page lists, docs folders in product
// repositories, and a forum guides board. Each find becomes an unverified draft entry.
import { DEV_DOC, DOC_FOLDERS, GUIDE_FEEDS, NOT_A_GUIDE, SITES, WIKIS, type Part, type Site } from "./config.ts";
import { relevanceHits, themeOf } from "./classify.ts";
import { decodeEntities, parseRss, type SourceStat, type GitHub } from "./harvest.ts";
import type { Cache, Fetcher } from "./http.ts";
import { normalizeUrl, type Index } from "./project.ts";

export type Page = { url: string; lastmod: string | null; title?: string; language?: string | null };
export type Draft = {
  id: string; title: string; url: string; creator: string | null; publisher: string | null; language: string;
  kind: "article" | "video" | "docs"; published: null; covers: string[]; part: Part[]; words: string[]; answers: string[];
  review: { status: "unverified"; found_via: string; lastmod: string | null; first_seen: string; theme: string; inside: string | null; reasons: string[] };
};
export type Recheck = { guide: string; url: string; checked_on: string; lastmod: string; found_via: string };

// ---------- parsing ----------

export function parseSitemap(xml: string): { pages: Page[]; sitemaps: string[] } {
  const pages: Page[] = [], sitemaps: string[] = [];
  for (const [, block] of xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/g)) {
    const loc = decodeEntities(block.match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1] ?? "");
    const lastmod = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1]?.slice(0, 10) ?? null;
    if (!loc) continue;
    if (/<sitemapindex/.test(xml)) sitemaps.push(loc); else pages.push({ url: loc, lastmod });
  }
  return { pages, sitemaps };
}

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
  const title = og ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
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
  for (const p of index.products) if (p.re.test(page.title)) products.add(p.id);
  const { theme, part, why } = themeOf(page.title, path);
  // A page inside docs that guides.json already lists as a whole (a docs entry).
  const inside = index.guides.find((g) => g.kind === "docs" && normalizeUrl(page.url).startsWith(normalizeUrl(g.url.replace(/#.*$/, ""))))?.id ?? null;
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
  const products = new Set(index.products.filter((p) => !own.includes(p.id) && p.id !== "obs-studio" && p.re.test(text)).map((p) => p.id));
  return 2 * h.strong.length + h.context.length + words.size + products.size;
}

/** Drop a trailing site name after a bar or a dash, such as " | Sample Docs". */
export function cleanTitle(title: string): string {
  const m = title.match(/^(.{12,}?)\s+[|\u2013\u2014]\s+([^|\u2013\u2014]+)$/);
  return m && /docs|guide|softvelum|openrtmp|ninja|knowledge|wiki|help/i.test(m[2]) ? m[1].trim() : title.trim();
}

export type GuideRun = { drafts: Draft[]; rechecks: Recheck[]; stats: SourceStat[]; seen: Record<string, string> };

export async function discoverGuides(fetcher: Fetcher, cache: Cache, gh: GitHub, index: Index, today: string, previouslySeen: Record<string, string>, maxTitles = 60): Promise<GuideRun> {
  const drafts: Draft[] = [], rechecks: Recheck[] = [], stats: SourceStat[] = [];
  const seen: Record<string, string> = { ...previouslySeen };
  const guideByUrl = new Map(index.guides.map((g) => [normalizeUrl(g.url), g]));

  const meta = (url: string) => cache.remember(`meta:${url}`, 24 * 7, async () => pageMeta(await fetcher.text(url)));

  async function consider(pages: Page[], site: Pick<Site, "name" | "covers" | "include" | "exclude" | "terms">, creator: string | null, kind: Draft["kind"], titleFrom?: (p: Page) => string, byMaker = true) {
    let read = 0, kept = 0, fetched = 0;
    for (const page of pages) {
      read++;
      const norm = normalizeUrl(page.url);
      const listed = guideByUrl.get(norm);
      if (listed && page.lastmod && page.lastmod > listed.checked_on)
        rechecks.push({ guide: listed.id, url: page.url, checked_on: listed.checked_on, lastmod: page.lastmod, found_via: site.name });
      if (index.knownUrls.has(norm) || !keepPath(page.url, site)) continue;
      const path = decodeURIComponent(new URL(page.url).pathname).replace(/[-_/.]+/g, " ");
      let title = titleFrom?.(page), language: string | null = null;
      // General sites: only pages whose address (or given title) names an IRL term or product.
      if (site.terms && irlScore(`${title ?? ""} ${path}`, index, site.covers) < 2) continue;
      if (!title) {
        if (fetched >= maxTitles) continue;
        fetched++;
        try { const m = await meta(page.url); title = m.title ?? undefined; language = m.language; } catch { continue; }
      }
      if (!title) continue;
      if (site.terms && irlScore(`${title} ${path}`, index, site.covers) < 2) continue;
      kept++;
      seen[norm] ??= today;
      const d = draftFor({ ...page, title, language }, site.covers, creator, site.name, index, seen[norm], kind);
      if (!byMaker) d.publisher = null;
      drafts.push(d);
    }
    stats.push({ source: site.name, read, kept, note: fetched ? `${fetched} page titles read` : undefined });
  }

  for (const site of SITES) {
    try {
      let pages: Page[] = [];
      if (site.sitemap) {
        pages = await cache.remember(`sitemap:${site.sitemap}`, 24, async () => {
          const out: Page[] = [];
          const queue = [site.sitemap!];
          for (let i = 0; i < queue.length && i < 20; i++) {
            const { pages, sitemaps } = parseSitemap(await fetcher.text(queue[i]));
            out.push(...pages);
            queue.push(...sitemaps);
          }
          return out;
        });
      } else if (site.index) {
        pages = await cache.remember(`index:${site.index}`, 24, async () => pageLinks(await fetcher.text(site.index!), site.index!).map((url) => ({ url, lastmod: null })));
      }
      await consider(pages, site, creatorOf(site.covers, index), "article");
    } catch (e) { stats.push({ source: site.name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }

  for (const wiki of WIKIS) {
    const name = `GitHub wiki ${wiki.repo}`;
    try {
      const base = `https://github.com/${wiki.repo}/wiki`;
      const pages = await cache.remember(`wiki:${wiki.repo}`, 24, async () => {
        const html = await fetcher.text(`${base}/_pages`);
        return pageLinks(html, base).filter((u) => u.startsWith(base + "/") && !/\/wiki\/_/.test(u)).map((url) => ({ url, lastmod: null }));
      });
      const title = (p: Page) => decodeURIComponent(p.url.slice(base.length + 1)).replace(/-/g, " ").replace(/\s+/g, " ").trim();
      const filtered = pages.filter((p) => !("include" in wiki && wiki.include) || new RegExp(wiki.include as string, "i").test(title(p)));
      await consider(filtered, { name, covers: wiki.covers, terms: wiki.terms }, creatorOf(wiki.covers, index), "article", title);
    } catch (e) { stats.push({ source: name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }

  for (const folder of DOC_FOLDERS) {
    const name = `GitHub docs ${folder.repo}`;
    try {
      // The cache keeps the whole file list; the filters run on every run so they can change.
      const listing = await cache.remember(`docs-tree:${folder.repo}`, 24, async () => {
        const repo = await gh.rest(`/repos/${folder.repo}`);
        const tree = await gh.rest(`/repos/${folder.repo}/git/trees/${repo.default_branch}?recursive=1`);
        return { branch: repo.default_branch as string, paths: (tree.tree as any[]).filter((e) => e.type === "blob").map((e) => e.path as string) };
      });
      const pages = listing.paths
        .filter((p) => new RegExp(folder.include, "i").test(p) && !(folder.exclude && new RegExp(folder.exclude, "i").test(p)) && !new RegExp(DEV_DOC, "i").test(p))
        .map((p) => ({ url: `https://github.com/${folder.repo}/blob/${listing.branch}/${p}`, lastmod: null }));
      const title = (p: Page) => decodeURIComponent(p.url.split("/").slice(7).join("/")).replace(/^docs\//, "").replace(/\.mdx?$/i, "").replace(/\//g, ": ").replace(/[-_]+/g, " ").trim();
      await consider(pages, { name, covers: folder.covers }, creatorOf(folder.covers, index), "docs", title);
    } catch (e) { stats.push({ source: name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }

  for (const feed of GUIDE_FEEDS) {
    try {
      const items = await cache.remember(`rss:${feed.url}`, 20, async () => parseRss(await fetcher.text(feed.url)).map((i) => ({ url: i.link, lastmod: i.date, title: i.title })));
      // Forum guides are written by community members: no creator is recorded here; a reviewer fills it in.
      // The board is about OBS in general: keep only titles with a strong IRL sign.
      const relevant = items.filter((i) => relevanceHits(i.title).strong.length > 0);
      await consider(relevant, { name: feed.name, covers: feed.covers }, null, "article", (p) => (p as any).title, false);
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
