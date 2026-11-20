// Finding products that aren't in the catalogue yet: GitHub search, repositories of makers who are
// already listed, App Store search, links on makers' own pages, and names that standards.json
// already mentions in other_users. Candidates are deduplicated against the data and scored.
import type { Fetcher } from "./http.ts";
import { appStoreId, githubRef } from "./sources.ts";
import { norm, type Snapshot } from "./signals.ts";
import { pageLinks, quote } from "./text.ts";

export type RepoInfo = { fullName: string; stars: number; pushedAt: string | null; createdAt: string | null; license: string | null; language: string | null; topics: string[]; archived: boolean; fork: boolean; homepage: string | null };
export type AppInfo = { id: string; seller: string | null; version: string | null; releaseDate: string | null; genre: string | null; price: string | null; sellerUrl: string | null; description: string };
export type Candidate = {
  key: string; name: string; evidence: string | null; via: string[]; description: string | null; homepage: string | null; owner: string | null;
  repo?: RepoInfo; app?: AppInfo; readme?: string; otherUsersOf?: string[];
  score: number; why: string[]; flags: string[];
};

export type Known = { names: Map<string, string>; repos: Set<string>; urls: Set<string>; hosts: Set<string>; apps: Set<string>; owners: Set<string>; otherUsers: Map<string, string[]> };

/** Hosts that many unrelated products share, so a match on them says nothing. */
const SHARED_HOSTS = new Set(["github.com", "apps.apple.com", "play.google.com", "discord.gg", "discord.com", "youtube.com", "twitch.tv", "x.com", "twitter.com", "datatracker.ietf.org", "support.google.com", "help.kick.com", "kick.com", "itu.int", "apple.com", "support.apple.com", "docs.github.com", "en.wikipedia.org"]);
export const urlKey = (u: string) => { try { const x = new URL(u); return (x.host.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase(); } catch { return u.toLowerCase(); } };
const hostOf = (u: string) => { try { return new URL(u).host.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

function allUrls(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") { for (const m of x.matchAll(/https:\/\/[^\s<>"')]+/g)) out.push(m[0]); }
  else if (Array.isArray(x)) x.forEach(v => allUrls(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach(v => allUrls(v, out));
  return out;
}

/** Name variants of a product name: the whole name, the part before a parenthesis, and the part inside it. */
export function nameKeys(name: string): string[] {
  const keys = [name, name.replace(/\s*\(.*\)\s*/g, " "), ...[...name.matchAll(/\(([^)]+)\)/g)].map(m => m[1])];
  return [...new Set(keys.map(norm).filter(k => k.length >= 2))];
}

export function knownIndex(services: any[], standards: any[]): Known {
  const k: Known = { names: new Map(), repos: new Set(), urls: new Set(), hosts: new Set(), apps: new Set(), owners: new Set(), otherUsers: new Map() };
  for (const [dataset, list] of [["services", services], ["standards", standards]] as const)
    for (const s of list) for (const n of [...nameKeys(s.name), norm(s.id)]) if (!k.names.has(n)) k.names.set(n, `${dataset}/${s.id}`);
  for (const u of allUrls([services, standards])) {
    k.urls.add(urlKey(u));
    const gh = githubRef(u);
    if (gh?.kind === "repo" || gh?.kind === "file") k.repos.add(gh.repo.toLowerCase());
    const app = appStoreId(u);
    if (app) k.apps.add(app);
  }
  for (const s of services) {
    for (const u of [s.url, ...(s.links ?? []).map((l: any) => l.url)]) {
      const h = hostOf(u);
      if (h && !SHARED_HOSTS.has(h)) k.hosts.add(h);
      const gh = githubRef(u);
      if (gh?.kind === "repo" || gh?.kind === "file") k.owners.add(gh.repo.split("/")[0].toLowerCase());
      if (gh?.kind === "owner") k.owners.add(gh.owner.toLowerCase());
    }
    for (const c of s.support ?? []) { const gh = githubRef(c.url); if (gh?.kind === "repo") k.owners.add(gh.repo.split("/")[0].toLowerCase()); }
  }
  for (const s of standards) {
    if (s.url && !SHARED_HOSTS.has(hostOf(s.url))) k.hosts.add(hostOf(s.url));
    for (const u of s.other_users ?? []) for (const n of nameKeys(u)) k.otherUsers.set(n, [...(k.otherUsers.get(n) ?? []), s.id]);
  }
  return k;
}

/** A listing whose name starts with an entry's name, such as "Product: Live Streaming": likely the same product on another store or platform. */
export function relatedEntry(c: Pick<Candidate, "name">, k: Known): string | null {
  const prefix = c.name.split(/\s*[:|\u2013\u2014]\s*|\s+-\s+/)[0];
  if (prefix === c.name) return null;
  const n = norm(prefix);
  return n.length >= 3 ? k.names.get(n) ?? null : null;
}

/** Why a candidate is already in the data, or null. */
export function alreadyListed(c: Pick<Candidate, "name" | "evidence" | "homepage" | "repo" | "app">, k: Known): string | null {
  if (c.repo && k.repos.has(c.repo.fullName.toLowerCase())) return `repository ${c.repo.fullName} is in the data`;
  if (c.app && k.apps.has(c.app.id)) return `App Store id ${c.app.id} is in the data`;
  for (const n of [norm(c.name), norm(c.name.replace(/\b(?:app|ios|android|for ios|for android)\b/gi, ""))])
    if (n.length >= 3 && k.names.has(n)) return `name ${c.name} matches an entry`;
  for (const u of [c.evidence, c.homepage]) {
    if (!u) continue;
    if (k.urls.has(urlKey(u))) return `${u} is in the data`;
    const h = hostOf(u);
    if (h && k.hosts.has(h)) return `site ${h} is an entry's site`;
  }
  return null;
}

type Term = [RegExp, number, string];
const TERMS: Term[] = [
  [/\bsrt[ _-]?la\b|\bsrtla/i, 12, "SRTLA"],
  [/\birl[ -]?(?:stream|broadcast|live)/i, 12, "IRL streaming"],
  [/\bbelabox\b/i, 10, "BELABOX"],
  [/\bnoalbs\b/i, 10, "NOALBS"],
  [/\b(?:cellular|network|link|connection|multi[ -]?(?:link|sim|network))[ -]bonding\b|\bbonded (?:stream|connection|cellular|link)|\blink aggregation\b|\bbonding\b.*\bstream|\bstream\w*\b.*\bbonding\b/i, 10, "bonding"],
  [/\bmoblin\b/i, 8, "Moblin"],
  [/\brtirl\b|realtimeirl/i, 8, "RealtimeIRL"],
  [/\bsrt\b(?![ -]?(?:file|subtitle|caption))/i, 5, "SRT"],
  [/\brist\b/i, 4, "RIST"],
  [/obs[ -]?websocket/i, 4, "OBS WebSocket"],
  [/low[ -]bitrate|bitrate[ -]switch|scene[ -]switch/i, 5, "bitrate or scene switching"],
  [/\b(?:rtmp|srt|stream(?:ing)?|video) (?:relay|ingest|receiver|gateway)\b/i, 5, "relay or receiver"],
  [/\birl\b/i, 4, "IRL"],
  [/\bwhip\b/i, 3, "WHIP"],
  [/\b(?:backpack|hardware encoder|cellular)\b/i, 2, "field hardware"],
  [/\brtmps?\b/i, 2, "RTMP"],
  [/\b(?:twitch|kick|youtube live)\b/i, 2, "platform"],
  [/\blive[ -]?stream(?:ing|er)?\b/i, 2, "live streaming"],
  [/\bobs(?: studio)?\b/i, 2, "OBS"],
];
const NEGATIVE: Term[] = [
  [/subtitle|caption|subrip|\.srt\b|srt[ -](?:file|parser|subtitle|translat)/i, -20, "subtitles (.srt files)"],
  [/shortest remaining time|\bscheduling algorithm/i, -15, "scheduling algorithm"],
  [/\b(?:dating|meet new people|make friends)\b/i, -10, "social app, not streaming"],
  [/\bawesome[- ]list|\bawesome-/i, -5, "a list, not a product"],
  [/\b(?:dotfiles|my (?:setup|scripts|config))\b/i, -8, "personal setup"],
  [/\b(?:homework|assignment|university project|course project)\b/i, -6, "coursework"],
  [/\b(?:how[ -]?to|complete[ -]guide|step[ -]by[ -]step guide|tutorial)\b/i, -12, "a guide, not a product"],
  [/\b(?:port of|android version of|clone of|fork of)\b/i, -4, "a port or clone of a listed product"],
];

export function relevance(text: string): { score: number; hits: { name: string; weight: number }[] } {
  const hits = [...TERMS, ...NEGATIVE].filter(([re]) => re.test(text)).map(([, weight, name]) => ({ name: weight < 0 ? `not: ${name}` : name, weight }));
  return { score: hits.reduce((s, h) => s + h.weight, 0), hits };
}

const daysAgo = (date: string | null, today: string) => date ? Math.round((Date.parse(today) - Date.parse(date.slice(0, 10))) / 86_400_000) : null;

export function score(c: Candidate, k: Known, today: string): Candidate {
  const why: string[] = [], flags: string[] = [];
  const own = relevance([c.name, c.description ?? "", c.repo?.topics.join(" ") ?? ""].join(" \n "));
  let s = own.score;
  if (own.hits.length) why.push(`matches ${own.hits.map(h => h.name).join(", ")}`);
  if (c.readme) {
    // README hits count half, and only for terms the name and description don't already have.
    const extra = relevance(c.readme).hits.filter(h => !own.hits.some(o => o.name === h.name));
    const add = Math.round(extra.reduce((t, h) => t + h.weight, 0) / 2);
    if (extra.length) { s += Math.max(-12, Math.min(add, 12)); why.push(`README mentions ${extra.map(h => h.name).join(", ")}`); }
  }
  // Keyword density says it's on topic, not that it's a product: cap it so maturity can tell candidates apart.
  s = Math.min(s, 30);
  const relevant = s;
  if (c.repo) {
    const stars = c.repo.stars;
    if (stars < 3) { s -= 6; flags.push(`${stars} stars`); }
    else { s += Math.min(14, Math.round(Math.log2(stars + 1) * 2)); why.push(`${stars} stars`); }
    const age = daysAgo(c.repo.pushedAt, today);
    if (age !== null) {
      if (age <= 180) { s += 6; why.push(`pushed ${c.repo.pushedAt!.slice(0, 10)}`); }
      else if (age <= 365) { s += 3; why.push(`pushed ${c.repo.pushedAt!.slice(0, 10)}`); }
      else if (age > 730) { s -= 8; flags.push(`no push since ${c.repo.pushedAt!.slice(0, 10)}`); }
    }
    if (c.repo.archived) { s -= 15; flags.push("archived"); }
    if (c.repo.fork) { s -= 10; flags.push("a fork"); }
    if (!c.description) { s -= 3; flags.push("no description"); }
    if (k.owners.has(c.repo.fullName.split("/")[0].toLowerCase())) { s += 5; why.push("by a maker already listed"); }
  }
  if (c.app) {
    const age = daysAgo(c.app.releaseDate, today);
    if (age !== null && age <= 365) { s += 8; why.push(`listed on the App Store, version ${c.app.version} from ${c.app.releaseDate}`); }
    else if (age !== null && age > 730) { s -= 6; flags.push(`no App Store update since ${c.app.releaseDate}`); }
  }
  if (c.via.length > 1) { s += Math.min(12, 4 * (c.via.length - 1)); }
  if (c.via.some(v => v.startsWith("linked from") && !v.includes("README"))) { s += 6; why.push("linked from a listed maker's own page"); }
  else if (c.via.some(v => v.startsWith("linked from"))) { s += 3; why.push("linked from a listed product's README"); }
  const other = [...new Set(nameKeys(c.name).flatMap(n => k.otherUsers.get(n) ?? []))];
  if (other.length) { s += 12; why.push(`already named in other_users of ${other.map(x => `standards/${x}`).join(", ")}`); c.otherUsersOf = other; }
  if (relevant < 5 && !other.length) flags.push("weak relevance");
  return { ...c, score: s, why, flags };
}

export function slug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "unnamed";
}

/** A services.json entry skeleton. Every filled value is a guess for a person to confirm; checked_on stays empty. */
export function skeleton(c: Candidate) {
  const text = `${c.name} ${c.description ?? ""} ${c.repo?.topics.join(" ") ?? ""}`.toLowerCase();
  let kind = "app", role = "other-app", cls = "helper-app", part = ["sender"], hosting: string | null = null;
  const lang = c.repo?.language?.toLowerCase();
  const mobile = !!c.app || lang === "swift" || lang === "kotlin" || /\b(?:android|iphone|ipad|ios) app\b|\bapp for (?:android|iphone|ios)\b|\bmobile app\b/.test(text);
  if (mobile) {
    if (/\b(?:srt|srtla|rtmp|rist|whip)\b|broadcast|go live|live[ -]?stream/.test(text)) { role = "streaming-app"; cls = "phone-app"; }
  } else if (/\bsend(?:er)?\b/.test(text) && /srtla|bonding/.test(text) && !/receiver/.test(text)) { kind = "relay"; role = "relay"; cls = "building-block"; part = ["sender"]; }
  else if (/receiver|relay|server|ingest|gateway|srtla/.test(text)) { kind = "relay"; role = "relay"; cls = /bond|srtla/.test(text) ? "bonding" : "building-block"; part = ["receiver"]; hosting = "self"; }
  else if (/\bobs\b|plugin|overlay|chat|\bbot\b|scene/.test(text)) { kind = "production"; role = "production"; cls = "production"; part = ["obs"]; }
  else if (/encoder|hardware|board|backpack/.test(text)) { kind = "hardware"; role = "hardware"; cls = "hardware"; part = ["sender"]; }
  const platforms = c.app ? ["ios"] : lang === "swift" ? ["ios"] : lang === "kotlin" || lang === "java" ? ["android"] : kind === "relay" ? ["linux"] : [];
  const evidence = c.evidence ?? "";
  const url = c.homepage && /^https:\/\//.test(c.homepage) ? c.homepage : evidence;
  return {
    id: slug(c.name),
    checked_on: null,
    name: c.name,
    kind, role, class: cls, hosting,
    maker: c.app?.seller ?? c.owner ?? "",
    url,
    links: url !== evidence && evidence ? [{ label: c.repo ? "GitHub" : "App Store", url: evidence }] : [],
    open_source: c.repo?.license && c.repo.license !== "NOASSERTION" ? true : null,
    licence: c.repo?.license && c.repo.license !== "NOASSERTION" ? c.repo.license : null,
    status: null,
    description: "TODO: one or two sentences in your own words, from the maker's page",
    platforms,
    part,
    covers: [],
    support: [],
    tags: [],
    words: [],
    unverified: ["id", "name", "kind", "role", "class", "hosting", "maker", "url", "links", "open_source", "licence", "status", "description", "platforms", "part"],
  };
}

// ---------- Network ----------

const GH = "https://api.github.com";
const GH_ACCEPT = "application/vnd.github+json";
export const SEARCHES = [
  "srtla", "topic:srtla", "topic:irl-streaming", "topic:irl", "\"irl streaming\"", "\"irl stream\"", "irl bonding",
  "noalbs", "belabox", "topic:belabox", "moblin", "rtirl", "srt bonding", "cellular bonding stream", "srt relay obs",
  "srt receiver obs", "\"low bitrate\" obs switcher", "rist bonding", "srtla receiver", "obs irl",
];
export const APP_TERMS = ["irl streaming", "srt streaming", "srtla", "bonding stream", "srt encoder", "rtmp live streaming", "obs remote", "irl stream", "stream to twitch camera", "live streaming bitrate"];

const repoInfo = (d: any): RepoInfo => ({ fullName: d.full_name, stars: d.stargazers_count ?? 0, pushedAt: d.pushed_at ?? null, createdAt: d.created_at ?? null,
  license: d.license?.spdx_id ?? null, language: d.language ?? null, topics: d.topics ?? [], archived: !!d.archived, fork: !!d.fork, homepage: d.homepage || null });
const repoCandidate = (d: any, via: string): Candidate => ({ key: `gh:${String(d.full_name).toLowerCase()}`, name: d.name, evidence: d.html_url, via: [via],
  description: d.description ?? null, homepage: d.homepage || null, owner: d.owner?.login ?? null, repo: repoInfo(d), score: 0, why: [], flags: [] });
const appCandidate = (r: any, via: string): Candidate => ({ key: `ios:${r.trackId}`, name: r.trackName, evidence: `https://apps.apple.com/us/app/id${r.trackId}`, via: [via],
  description: String(r.description ?? "").slice(0, 600), homepage: r.sellerUrl || null, owner: r.sellerName ?? null,
  app: { id: String(r.trackId), seller: r.sellerName ?? null, version: r.version ?? null, releaseDate: r.currentVersionReleaseDate?.slice(0, 10) ?? null, genre: r.primaryGenreName ?? null, price: r.formattedPrice ?? null, sellerUrl: r.sellerUrl ?? null, description: String(r.description ?? "") },
  score: 0, why: [], flags: [] });

export class Discovery {
  readonly pool = new Map<string, Candidate>();
  readonly dropped = new Map<string, string>();
  readonly unresolved: { name: string; standards: string[] }[] = [];
  readonly related = new Map<string, { candidate: Candidate; entry: string }>();
  raw = 0;
  constructor(private http: Fetcher, private known: Known, private log: (s: string) => void = () => {}) {}

  private put(c: Candidate) {
    this.raw++;
    const why = alreadyListed(c, this.known);
    if (why) { this.dropped.set(c.key, why); return; }
    const entry = relatedEntry(c, this.known);
    if (entry) { this.related.set(c.key, { candidate: c, entry }); return; }
    const prev = this.pool.get(c.key);
    if (prev) { prev.via = [...new Set([...prev.via, ...c.via])]; return; }
    this.pool.set(c.key, c);
  }

  async githubSearch(queries = SEARCHES) {
    for (const q of queries) {
      const { got, data } = await this.http.json(`${GH}/search/repositories?q=${encodeURIComponent(q + " fork:false")}&per_page=50`, { accept: GH_ACCEPT });
      if (got.status !== 200 || !data) { this.log(`search ${q}: status ${got.status}`); continue; }
      for (const d of data.items ?? []) this.put(repoCandidate(d, `GitHub search ${q}`));
    }
  }

  async makerRepos() {
    for (const owner of [...this.known.owners].sort()) {
      const { got, data } = await this.http.json(`${[GH, "users", owner, "repos"].join("/")}?sort=pushed&per_page=100&type=owner`, { accept: GH_ACCEPT });
      if (got.status !== 200 || !Array.isArray(data)) continue;
      for (const d of data) if (!d.fork) this.put(repoCandidate(d, `repositories of ${owner}`));
    }
  }

  async appSearch(terms = APP_TERMS) {
    for (const term of terms) {
      const { got, data } = await this.http.json(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=us&entity=software&limit=50`);
      if (got.status !== 200 || !data) { this.log(`App Store search ${term}: status ${got.status}`); continue; }
      for (const r of data.results ?? []) this.put(appCandidate(r, `App Store search ${term}`));
    }
  }

  /** Repositories and store listings that listed entries' own pages and READMEs link to. */
  async fromMakerPages(snap: Snapshot, entries: { key: string; resources: any[] }[], bodies: Map<string, string>) {
    const repos = new Map<string, string>();
    const apps = new Map<string, string>();
    for (const e of entries) for (const r of e.resources) {
      if (r.role !== "main" && r.role !== "link") continue;
      const links: { url: string; via: string }[] = [];
      if (r.type === "page") for (const u of snap.pages[r.url]?.links ?? []) links.push({ url: u, via: `linked from ${e.key} (${r.url})` });
      if (r.type === "repo") for (const l of pageLinks(bodies.get(`readme ${r.repo.toLowerCase()}`) ?? "", `https://github.com/${r.repo}/`)) links.push({ url: l.url, via: `linked from ${e.key} README` });
      for (const { url, via } of links) {
        const gh = githubRef(url);
        if (gh?.kind === "repo" && !this.known.repos.has(gh.repo.toLowerCase())) repos.set(gh.repo.toLowerCase(), repos.get(gh.repo.toLowerCase()) ?? via);
        const app = appStoreId(url);
        if (app && !this.known.apps.has(app) && !Object.values(snap.linked).some(l => l.apps.includes(app))) apps.set(app, apps.get(app) ?? via);
      }
    }
    let n = 0;
    for (const [repo, via] of repos) {
      if (n++ >= 80) break;
      const { got, data } = await this.http.json(`${GH}/repos/${repo}`, { accept: GH_ACCEPT });
      if (got.status === 200 && data) this.put(repoCandidate(data, via));
    }
    if (apps.size) {
      const { data } = await this.http.json(`https://itunes.apple.com/lookup?id=${[...apps.keys()].slice(0, 50).join(",")}&country=us&entity=software`);
      for (const r of data?.results ?? []) this.put(appCandidate(r, apps.get(String(r.trackId))!));
    }
  }

  /** Names standards.json lists in other_users: find the maker's repo from the standard's sources, or by an exact name search. */
  async otherUsers(standards: any[]) {
    for (const s of standards) for (const name of s.other_users ?? []) {
      if (nameKeys(name).some(n => this.known.names.has(n))) continue;
      const fromSources = (s.sources ?? []).map((l: any) => githubRef(l.url)).find((g: any) => g?.kind === "repo" && norm(g.repo.split("/")[1]) === norm(name));
      let found: any = null;
      if (fromSources) {
        const { got, data } = await this.http.json(`${GH}/repos/${fromSources.repo}`, { accept: GH_ACCEPT });
        if (got.status === 200) found = data;
      } else {
        const { got, data } = await this.http.json(`${GH}/search/repositories?q=${encodeURIComponent(`${name} in:name fork:false`)}&per_page=10&sort=stars`, { accept: GH_ACCEPT });
        if (got.status === 200) found = (data?.items ?? []).find((d: any) => norm(d.name) === norm(name) && d.stargazers_count >= 5) ?? null;
      }
      if (found) {
        const c = repoCandidate(found, `named in standards/${s.id} other_users${fromSources ? " (repository from its sources)" : " (repository found by exact name search)"}`);
        if (!fromSources) c.flags.push("evidence found by name search: confirm it is the maker's own repository");
        this.put(c);
      } else if (!this.unresolved.some(u => u.name === name)) this.unresolved.push({ name, standards: [s.id] });
      else this.unresolved.find(u => u.name === name)!.standards.push(s.id);
    }
  }

  /** READMEs for the strongest repository candidates, to firm up or weaken relevance. */
  async readmes(list: Candidate[], limit = 50) {
    for (const c of list.filter(c => c.repo).slice(0, limit)) {
      const { got, data } = await this.http.json(`${GH}/repos/${c.repo!.fullName}/readme`, { accept: GH_ACCEPT });
      if (got.status === 200 && data?.content) c.readme = Buffer.from(data.content, "base64").toString("utf8").slice(0, 20000);
    }
  }
}

export function rankCandidates(pool: Iterable<Candidate>, k: Known, today: string): Candidate[] {
  const ranked = [...pool].map(c => score(c, k, today)).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const byName = new Map<string, Candidate[]>();
  for (const c of ranked) byName.set(norm(c.name), [...(byName.get(norm(c.name)) ?? []), c]);
  for (const same of byName.values()) if (same.length > 1)
    for (const c of same) c.flags.push(`same name as ${same.filter(o => o !== c).map(o => o.evidence).join(", ")}`);
  return ranked;
}

export function renderCandidates(list: Candidate[], meta: { date: string; raw: number; dropped: Map<string, string>; related?: Map<string, { candidate: Candidate; entry: string }>; unresolved: { name: string; standards: string[] }[]; min: number; limit: number; stats: string[] }): string {
  const shown = list.filter(c => c.score >= meta.min && !c.flags.includes("weak relevance")).slice(0, meta.limit);
  const lines: string[] = ["# Catalogue candidates", ""];
  lines.push(`Run on ${meta.date}. ${list.length} candidates not in services.json or standards.json, from ${meta.raw} raw hits; ${meta.dropped.size} hits matched an existing entry. Shown: the ${shown.length} with a score of ${meta.min} or more and some relevance.`, "");
  lines.push("Nothing here is checked. Before an entry is added, a person reads the maker's own page, decides whether it belongs in an IRL streaming catalogue, writes the description in their own words, and sets `checked_on` to the day they read it. The skeletons are guesses from metadata; every field listed under `unverified` needs confirming, and the `unverified` key itself is not part of the schema.", "");
  lines.push("| # | Candidate | Score | Evidence | Found via |", "| ---: | --- | ---: | --- | --- |");
  shown.forEach((c, i) => lines.push(`| ${i + 1} | ${c.name.replace(/\|/g, "/")} | ${c.score} | ${c.evidence ?? "none"} | ${c.via.slice(0, 2).join("; ").replace(/\|/g, "/")}${c.via.length > 2 ? ` (+${c.via.length - 2})` : ""} |`));
  lines.push("", "## Details", "");
  shown.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.name.replace(/[<>]/g, "")} (score ${c.score})`, "");
    lines.push(`- Evidence: ${c.evidence ?? "none found"}${c.homepage && c.homepage !== c.evidence ? ` (homepage given: ${c.homepage})` : ""}`);
    if (c.description) lines.push(`- Upstream description: ${quote(c.description, 300)}`);
    lines.push(`- Why it may belong: ${c.why.join("; ") || "no strong reason"}`);
    lines.push(`- Found via: ${c.via.join("; ")}`);
    if (c.flags.length) lines.push(`- Watch out: ${c.flags.join("; ")}`);
    const draft = JSON.stringify(skeleton(c), null, 2).replace(/\[\n\s+([^\]{}]*?)\n\s+\]/g, (_, inner: string) => `[${inner.replace(/\n\s+/g, " ")}]`);
    lines.push("", "  ~~~json", ...draft.split("\n").map(l => "  " + l.replace(/~~~/g, "~ ~ ~")), "  ~~~", "");
  });
  if (meta.related?.size) {
    lines.push("## Listings that may belong to existing entries", "", "Their names start with an entry's name. They may be the same product on another store or platform, which the entry's links or platforms might need.", "");
    for (const { candidate: c, entry } of meta.related.values()) lines.push(`- ${entry}: ${quote(c.name, 80)} by ${quote(c.owner, 60)}, ${c.evidence}`);
    lines.push("");
  }
  if (meta.unresolved.length) {
    lines.push("## Named in standards.json without a source found", "", "These are in `other_users` but no maker repository turned up. They need a person to find the maker's own page.", "");
    for (const u of meta.unresolved) lines.push(`- ${quote(u.name, 60)} (${u.standards.map(s => `standards/${s}`).join(", ")})`);
    lines.push("");
  }
  const reasons = new Map<string, number>();
  const kinds: Record<string, string> = { repository: "repository already in the data", App: "App Store id already in the data", name: "name matches an entry", site: "on an entry's own site" };
  for (const why of meta.dropped.values()) { const kind = kinds[why.split(" ")[0]] ?? "URL already in the data"; reasons.set(kind, (reasons.get(kind) ?? 0) + 1); }
  lines.push("## Matched existing entries", "", ...[...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => `- ${r}: ${n}`), "");
  lines.push("## Run", "", ...meta.stats.map(s => `- ${s}`), "");
  return lines.join("\n");
}
