import { randomUUID } from "node:crypto";
import { closeSync, constants, openSync } from "node:fs";
import { join } from "node:path";
import { verifyOutputDirectory } from "./output.ts";
import { BodyLimitExceeded, decodeBody, OfflineMiss, type Cache, type Fetcher } from "./http.ts";
import type { Page } from "./guides.ts";
import { decodeEntities } from "./harvest.ts";

const LIMITS = { documents: 64, depth: 8, members: 4096, pages: 50_000, wire: 8 * 1024 ** 2, decoded: 16 * 1024 ** 2, ratio: 150 };
type Member = { url: string; depth: number };
const REFRESH_MS = 24 * 3600_000;
type Snapshot = { pending: Member[]; seen: string[]; pages: Page[]; omitted: number; outside: number; malformed: number; failed: string[] };
type Work = Snapshot & { started: number };
type Listing = { saved: number; snapshot: Snapshot; legacy?: boolean };
type SitemapCache = { revision?: string; listing?: Listing; work?: Work };

export async function sitemapXml(bytes: Uint8Array, decoded: number, ratio: number, charge?: (size: number) => void, wireBytes = bytes.length): Promise<string> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const expansion = Math.min(bytes.length, wireBytes) * ratio;
    bytes = await decodeBody(bytes, "gzip", Math.min(decoded, expansion), charge, expansion < decoded ? "expansion" : "decoded");
  }
  if (bytes.length > decoded) throw new BodyLimitExceeded("decoded", decoded, bytes.length);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function readSitemap(fetcher: Fetcher, cache: Cache, root: string, limits = LIMITS, allowedOrigins = [new URL(root).origin]): Promise<{ pages: Page[]; note?: string }> {
  const scope = root + ":" + allowedOrigins.join(",");
  const key = "sitemap-listing:" + scope;
  const stored = cache.entry<SitemapCache>(key);
  let state = stored?.value ?? migrateSitemap(cache, scope, root, allowedOrigins);
  if (cache.offline && !state.listing && !state.work) throw new OfflineMiss(key);
  if (!cache.offline) {
    const now = Date.now();
    const onlyFailed = state.work?.pending.every((member) => state.work!.failed.includes(member.url));
    const revisitRoot = state.work && onlyFailed && now - state.work.started >= REFRESH_MS;
    if (revisitRoot && state.work!.pages.length) {
      state.listing = {
        saved: state.listing?.saved ?? state.work!.started,
        snapshot: { ...state.work!, pages: mergePages(state.work!.pages, state.listing?.snapshot.pages ?? [], limits.pages) },
      };
    }
    if (revisitRoot || (!state.work && (state.listing?.legacy || now - (state.listing?.saved ?? -Infinity) >= REFRESH_MS))) {
      state.work = { started: now, pending: [{ url: root, depth: 0 }], seen: [root], pages: [], omitted: 0, outside: 0, malformed: 0, failed: [] };
    }
  }
  let snapshot = state.work ?? state.listing!.snapshot;
  if (!cache.offline && state.work) {
    const seen = new Set(snapshot.seen);
    const failed = new Set(snapshot.failed);
    const retry: Member[] = [];
    let totalWire = 0, totalDecoded = 0;
    for (let count = 0; count < limits.documents && snapshot.pending.length && totalWire < 4 * limits.wire && totalDecoded < 4 * limits.decoded; count++) {
      const { url, depth } = snapshot.pending.shift()!;
      let result: ReturnType<typeof parseSitemap>;
      let base: string;
      const wireLimit = Math.min(limits.wire, 4 * limits.wire - totalWire);
      let decodedLimit = Math.min(limits.decoded, 4 * limits.decoded - totalDecoded);
      try {
        const { bytes: raw, url: finalUrl, wireBytes } = await fetcher.binaryDocument(
          url, { allowedOrigins, headers: { "Accept-Encoding": "identity" } }, wireLimit,
          { decoded: decodedLimit, ratio: limits.ratio,
            chargeWire: (size) => { totalWire += size; }, chargeDecoded: (size) => { totalDecoded += size; } },
        );
        base = finalUrl;
        if (!seen.has(finalUrl)) {
          if (seen.size < limits.members) seen.add(finalUrl);
          else snapshot.omitted++;
        }
        const compressedFile = raw[0] === 0x1f && raw[1] === 0x8b;
        if (compressedFile) decodedLimit = Math.min(limits.decoded, 4 * limits.decoded - totalDecoded);
        const xml = await sitemapXml(raw, decodedLimit, limits.ratio, (size) => { totalDecoded += size; }, wireBytes);
        result = parseSitemap(xml, Math.max(limits.pages, limits.members));
        failed.delete(url);
      } catch (error) {
        if (error instanceof BodyLimitExceeded && (
          (error.layer === "wire" && wireLimit < limits.wire && error.measured <= limits.wire)
          || (error.layer === "decoded" && decodedLimit < limits.decoded && error.measured <= limits.decoded)
        )) {
          // This member needs a fresh run allowance. Give it the first opening next time.
          failed.delete(url);
          snapshot.pending.unshift({ url, depth });
          break;
        }
        failed.add(url);
        retry.push({ url, depth });
        continue;
      }
      snapshot.omitted += result.omitted;
      for (const page of result.pages) {
        const location = sitemapLocation(page.url, base);
        if (!location) { snapshot.malformed++; continue; }
        if (!allowedOrigins.includes(location.origin) || location.username || location.password) { snapshot.outside++; continue; }
        if (snapshot.pages.length >= limits.pages) { snapshot.omitted++; continue; }
        snapshot.pages.push({ ...page, url: location.href });
      }
      for (const loc of result.sitemaps) {
        const location = sitemapLocation(loc, base);
        if (!location) { snapshot.malformed++; continue; }
        if (!allowedOrigins.includes(location.origin) || location.username || location.password) { snapshot.outside++; continue; }
        const member = location.href;
        if (seen.has(member)) continue;
        if (depth >= limits.depth || seen.size >= limits.members) { snapshot.omitted++; continue; }
        seen.add(member);
        snapshot.pending.push({ url: member, depth: depth + 1 });
      }
    }
    snapshot.pending.push(...retry);
    snapshot.failed = [...failed];
    snapshot.seen = [...seen];
    if (!snapshot.pending.length) {
      state.listing = { saved: Date.now(), snapshot };
      delete state.work;
    }
    state = publishSitemap(cache, key, stored, state);
    snapshot = state.work ?? state.listing!.snapshot;
  }
  const note = [
    state.listing?.legacy ? "older sitemap cache may omit index members" : "",
    state.work && state.listing ? "stale sitemap listing retained during refresh" : "",
    snapshot.pending.length ? snapshot.pending.length + " sitemap members deferred" : "",
    snapshot.failed?.length ? snapshot.failed.length + " sitemap members unavailable (will retry)" : "",
    snapshot.malformed ? snapshot.malformed + " malformed sitemap locations ignored" : "",
    snapshot.outside ? snapshot.outside + " off-origin sitemap locations ignored" : "",
    snapshot.omitted ? snapshot.omitted + " sitemap entries omitted by limits" : "",
  ].filter(Boolean).join("; ");
  const oldPages = state.work ? state.listing?.snapshot.pages ?? [] : [];
  if (!oldPages.length) return { pages: snapshot.pages, note: note || undefined };
  return { pages: mergePages(snapshot.pages, oldPages, limits.pages), note: note || undefined };
}

/** The lock is held only around the generation check and atomic cache replacement. */
function publishSitemap(cache: Cache, key: string, expected: { saved: number; value: SitemapCache } | undefined, next: SitemapCache): SitemapCache {
  const publish = () => {
    const current = cache.entry<SitemapCache>(key);
    if (current && (current.saved !== expected?.saved || current.value.revision !== expected?.value.revision)) return current.value;
    return cache.set(key, { ...next, revision: randomUUID() });
  };
  if (process.platform !== "linux") return publish(); // The CLI writer is Linux-only.
  const name = new Bun.CryptoHasher("sha1").update(key).digest("hex");
  verifyOutputDirectory(cache.dir);
  const fd = openSync(join(cache.dir, name + ".lock"), constants.O_CREAT | constants.O_RDONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const lock = Bun.spawnSync(["flock", "--exclusive", "--timeout", "5", "0"], { stdin: fd, stdout: "ignore", stderr: "ignore" });
    if (lock.exitCode !== 0) throw new Error("could not lock sitemap checkpoint");
    // flock's child and this process share the open file description.
    return publish();
  } finally {
    closeSync(fd);
  }
}

function migrateSitemap(cache: Cache, scope: string, root: string, origins: string[]): SitemapCache {
  const eligible = (location: string) => {
    const url = sitemapLocation(location, root);
    return !!url && !url.username && !url.password && origins.includes(url.origin);
  };
  const pagesInScope = (pages: Page[]) => pages.filter((page) => eligible(page.url));
  const older = cache.entry<Page[]>("sitemap-tree:" + root) ?? cache.entry<Page[]>("sitemap:" + root);
  const old = cache.entry<Snapshot>("sitemap-scoped:" + scope);
  const state: SitemapCache = {};
  if (older) state.listing = {
    saved: older.saved, legacy: true,
    snapshot: { pending: [], seen: [], pages: pagesInScope(older.value), omitted: 0, outside: 0, malformed: 0, failed: [] },
  };
  if (!old) return state;
  const pending = old.value.pending.filter((member) => eligible(member.url));
  const snapshot = {
    ...old.value, pending, pages: pagesInScope(old.value.pages),
    seen: old.value.seen.filter(eligible), failed: old.value.failed.filter(eligible),
  };
  if (pending.length) state.work = { ...snapshot, started: old.saved };
  else if (!old.value.pending.length) state.listing = { saved: old.saved, snapshot, legacy: true };
  else if (snapshot.pages.length) state.listing = { saved: old.saved, snapshot, legacy: true };
  return state;
}

function mergePages(fresh: Page[], previous: Page[], limit: number): Page[] {
  const merged = new Map(fresh.map((page) => [page.url, page]));
  for (const page of previous) {
    if (merged.size >= limit) break;
    if (!merged.has(page.url)) merged.set(page.url, page);
  }
  return [...merged.values()];
}

function sitemapLocation(location: string, base: string): URL | undefined {
  try {
    const url = new URL(location, base);
    decodeURIComponent(url.pathname);
    url.hash = "";
    return url;
  } catch { return undefined; }
}

/** Read sitemap records only after validating that the entire XML document closed. */
export function parseSitemap(xml: string, maxEntries = Infinity): { pages: Page[]; sitemaps: string[]; omitted: number } {
  const pages: Page[] = [], sitemaps: string[] = [];
  type Field = "loc" | "lastmod";
  type Element = { name: string; field?: Field; text?: string[] };
  const stack: Element[] = [];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  const invalid = () => new Error("incomplete or unsupported sitemap XML");
  let root: string | undefined, recordName = "", prefix = "", index = false;
  let record: Partial<Record<Field, string>> | undefined;
  let omitted = 0;

  const collect = (value: string, literal = false) => {
    const element = stack.at(-1);
    if (!element || stack.length <= 2) {
      if (value.trim()) throw invalid();
      return;
    }
    if (!element.text) return;
    if (!literal && /&(?!amp;|lt;|gt;|apos;|quot;|#\d+;|#x[0-9a-fA-F]+;)/.test(value)) throw invalid();
    element.text.push(literal ? value : decodeEntities(value));
  };

  const close = (name: string) => {
    const element = stack.pop();
    if (element?.name !== name) throw invalid();
    if (element.field && record) record[element.field] = element.text!.join("").trim();
    if (stack.length !== 1 || element.name !== recordName || !record) return;
    if (!record.loc) throw invalid();
    if (pages.length + sitemaps.length >= maxEntries) omitted++;
    else if (index) sitemaps.push(record.loc);
    else pages.push({ url: record.loc, lastmod: record.lastmod?.slice(0, 10) || null });
    record = undefined;
  };

  for (let position = 0; position < xml.length;) {
    if (xml[position] !== "<") {
      const next = xml.indexOf("<", position);
      const end = next < 0 ? xml.length : next;
      collect(xml.slice(position, end));
      position = end;
      continue;
    }
    const delimited = xml.startsWith("<!--", position) ? [4, "-->"] as const
      : xml.startsWith("<?", position) ? [2, "?>"] as const
      : xml.startsWith("<![CDATA[", position) ? [9, "]]>"] as const : undefined;
    if (delimited) {
      const [start, delimiter] = delimited;
      const end = xml.indexOf(delimiter, position + start);
      if (end < 0 || (start === 9 && !stack.length)) throw invalid();
      if (start === 9) collect(xml.slice(position + start, end), true);
      position = end + delimiter.length;
      continue;
    }
    tag.lastIndex = position;
    const match = tag.exec(xml);
    if (!match) throw invalid();
    const [, ending, name, attrs, selfClosing] = match;
    if (ending) {
      if (attrs || selfClosing) throw invalid();
      close(name);
    } else {
      if (!stack.length) {
        if (root || !/^(?:[A-Za-z_][\w.-]*:)?(?:urlset|sitemapindex)$/.test(name)) throw invalid();
        root = name;
        prefix = name.includes(":") ? name.slice(0, name.indexOf(":") + 1) : "";
        index = name.slice(prefix.length) === "sitemapindex";
        recordName = prefix + (index ? "sitemap" : "url");
      } else if (stack.length === 1) {
        if (name === recordName) record = {};
        else if (!name.includes(":") || name.startsWith(prefix) && prefix) throw invalid();
      } else if (stack.at(-1)?.field) {
        throw invalid();
      }
      if (stack.length >= 64) throw invalid();
      const field = record && stack.length === 2 && (name === prefix + "loc" || name === prefix + "lastmod")
        ? name.slice(prefix.length) as Field : undefined;
      if (field && record?.[field] !== undefined) throw invalid();
      stack.push({ name, field, text: field ? [] : undefined });
      if (selfClosing) close(name);
    }
    position = tag.lastIndex;
  }
  if (!root || stack.length) throw invalid();
  return { pages, sitemaps, omitted };
}
