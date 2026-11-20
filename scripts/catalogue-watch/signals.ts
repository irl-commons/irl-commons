// Gathering machine signals for every resource the entries point to. Each resource is fetched once
// per run, whatever the number of entries that share it. The result is one snapshot per run date.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Fetcher, Got } from "./http.ts";
import { appStoreId, discordInviteCode, githubRef, pinned, playId, resourceKey, type Entry, type Resource } from "./sources.ts";
import { declaredModified, htmlToText, looksLikeScriptShell, markdownToText, pageLinks, pageTitle, textHash } from "./text.ts";

export type PageObs = {
  status: number; finalUrl: string; problem?: string; detail?: string;
  textHash?: string; textLength?: number; title?: string | null; declaredModified?: string | null;
  lastModified?: string | null; scriptShell?: boolean;
  /** Store listings, repositories and invites the page links to. */
  links?: string[];
};
export type RepoObs = {
  status: number; problem?: string; fullName?: string; archived?: boolean; disabled?: boolean; fork?: boolean;
  pushedAt?: string | null; description?: string | null; homepage?: string | null; license?: string | null;
  defaultBranch?: string; release?: { tag: string; date: string | null } | null; latestTag?: string | null;
  readme?: { path: string; sha: string; textHash: string; changedOn: string | null } | null;
};
export type FileObs = { status: number; problem?: string; pinned?: boolean; sha?: string; textHash?: string; changedOn?: string | null };
export type AppObs = { listed: boolean | null; problem?: string; name?: string; seller?: string; version?: string; releaseDate?: string | null; price?: string; minimumOs?: string };
export type PlayObs = { listed: boolean | null; status: number; problem?: string };
export type InviteObs = { code: string | null; valid: boolean | null; status: number; problem?: string };

export type Snapshot = {
  date: string;
  pages: Record<string, PageObs>;
  repos: Record<string, RepoObs>;
  files: Record<string, FileObs>;
  apps: Record<string, AppObs>;
  play: Record<string, PlayObs>;
  invites: Record<string, InviteObs>;
  /** "invite url|source url": whether the source page still shows the invite (null: couldn't tell). */
  channelSeen: Record<string, boolean | null>;
  /** Store listings found on an entry's own page or README whose name matches the entry. */
  linked: Record<string, { apps: string[]; play: string[] }>;
};

export const emptySnapshot = (date: string): Snapshot => ({ date, pages: {}, repos: {}, files: {}, apps: {}, play: {}, invites: {}, channelSeen: {}, linked: {} });

const GH = "https://api.github.com";
const GH_ACCEPT = "application/vnd.github+json";
export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");

function problemOf(got: Got): string | undefined {
  if (got.problem) return got.problem + (got.detail ? `: ${got.detail}` : "");
  if (got.status === 429) return "rate limited";
  if (got.status === 403 && got.headers["x-ratelimit-remaining"] === "0") return "rate limited";
  return undefined;
}

/** The fields kept from one iTunes lookup result. */
export function appFromLookup(r: any): AppObs {
  return { listed: true, name: r.trackName, seller: r.sellerName, version: r.version, releaseDate: r.currentVersionReleaseDate?.slice(0, 10) ?? null, price: r.formattedPrice, minimumOs: r.minimumOsVersion };
}

/** True when a Play package id contains the product name, or a word of four letters or more from the name or maker. */
export function playIdNames(id: string, name: string, maker: string): boolean {
  const segments = id.toLowerCase().split(/[._]/).map(norm).filter(Boolean);
  const words = `${name} ${maker}`.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  return norm(name).length >= 3 && norm(id).includes(norm(name)) || words.some(w => segments.some(s => s === w));
}
/** Of the Play ids a page links, the ones that name this product; ids with the full name win over ids that share a word. */
export function playIdsFor(ids: string[], name: string, maker: string): string[] {
  const full = ids.filter(id => norm(name).length >= 3 && norm(id).includes(norm(name)));
  return full.length ? full : ids.filter(id => playIdNames(id, name, maker));
}

export class Gatherer {
  readonly snap: Snapshot;
  /** Raw bodies seen this run, for link and invite checks. */
  readonly bodies = new Map<string, string>();
  constructor(private http: Fetcher, private stateDir: string, date: string) {
    this.snap = emptySnapshot(date);
    mkdirSync(join(stateDir, "text"), { recursive: true });
  }

  private saveText(text: string): string {
    const h = textHash(text);
    const p = join(this.stateDir, "text", `${h}.txt`);
    if (!existsSync(p)) writeFileSync(p, text);
    return h;
  }

  async page(url: string): Promise<void> {
    if (this.snap.pages[url]) return;
    this.snap.pages[url] = { status: 0, finalUrl: url }; // claim it so parallel callers skip
    const got = await this.http.get(url);
    const obs: PageObs = { status: got.status, finalUrl: got.finalUrl, problem: problemOf(got) };
    const type = got.headers["content-type"] ?? "";
    if (got.status >= 200 && got.status < 300 && got.body) {
      this.bodies.set(url, got.body);
      const isHtml = /html/i.test(type) || /^\s*</.test(got.body);
      const text = isHtml ? htmlToText(got.body) : /markdown|text\/plain/i.test(type) ? markdownToText(got.body) : "";
      if (text) { obs.textHash = this.saveText(text); obs.textLength = text.length; }
      else if (!isHtml) obs.detail = `not compared (${type.split(";")[0] || "unknown type"})`;
      if (isHtml) {
        obs.title = pageTitle(got.body);
        obs.declaredModified = declaredModified(got.body);
        obs.scriptShell = looksLikeScriptShell(got.body, text);
        obs.links = pageLinks(got.body, got.finalUrl).map(l => l.url)
          .filter(u => appStoreId(u) || playId(u) || /^https:\/\/github\.com\/[^/]+\/[^/?#]+/.test(u) || /discord/.test(u)).slice(0, 200);
      }
      obs.lastModified = got.headers["last-modified"] ?? null;
    }
    this.snap.pages[url] = obs;
  }

  async repo(repo: string): Promise<void> {
    const key = repo.toLowerCase();
    if (this.snap.repos[key]) return;
    this.snap.repos[key] = { status: 0 };
    const meta = await this.http.json(`${GH}/repos/${repo}`, { accept: GH_ACCEPT });
    const obs: RepoObs = { status: meta.got.status, problem: problemOf(meta.got) };
    if (meta.got.status === 200 && meta.data) {
      const d = meta.data;
      Object.assign(obs, { fullName: d.full_name, archived: d.archived, disabled: d.disabled, fork: d.fork, pushedAt: d.pushed_at ?? null,
        description: d.description ?? null, homepage: d.homepage || null, license: d.license?.spdx_id ?? null, defaultBranch: d.default_branch });
      const name = d.full_name as string;
      const [release, readme] = await Promise.all([
        this.http.json(`${GH}/repos/${name}/releases/latest`, { accept: GH_ACCEPT }),
        this.http.json(`${GH}/repos/${name}/readme`, { accept: GH_ACCEPT }),
      ]);
      obs.release = release.got.status === 200 && release.data ? { tag: release.data.tag_name, date: release.data.published_at?.slice(0, 10) ?? null } : null;
      if (!obs.release && release.got.status === 404) {
        const tags = await this.http.json(`${GH}/repos/${name}/tags?per_page=1`, { accept: GH_ACCEPT });
        obs.latestTag = Array.isArray(tags.data) && tags.data[0] ? tags.data[0].name : null;
      }
      if (readme.got.status === 200 && readme.data?.content) {
        const raw = Buffer.from(readme.data.content, "base64").toString("utf8");
        this.bodies.set(`readme ${key}`, raw);
        const commits = await this.http.json(`${GH}/repos/${name}/commits?path=${encodeURIComponent(readme.data.path)}&per_page=1`, { accept: GH_ACCEPT });
        const changedOn = Array.isArray(commits.data) && commits.data[0] ? (commits.data[0].commit?.committer?.date ?? "").slice(0, 10) || null : null;
        obs.readme = { path: readme.data.path, sha: readme.data.sha, textHash: this.saveText(markdownToText(raw)), changedOn };
      } else obs.readme = null;
    }
    this.snap.repos[key] = obs;
  }

  async file(r: Extract<Resource, { type: "file" }>): Promise<void> {
    const key = resourceKey(r);
    if (this.snap.files[key]) return;
    if (pinned(r)) { this.snap.files[key] = { status: 0, pinned: true }; return; }
    this.snap.files[key] = { status: 0 };
    const path = r.path.split("/").map(encodeURIComponent).join("/");
    const got = await this.http.json(`${GH}/repos/${r.repo}/contents/${path}?ref=${encodeURIComponent(r.ref)}`, { accept: GH_ACCEPT });
    const obs: FileObs = { status: got.got.status, problem: problemOf(got.got) };
    if (got.got.status === 200 && got.data) {
      if (Array.isArray(got.data)) {
        // A directory: its listing stands for it.
        const listing = got.data.map((f: any) => `${f.name} ${f.sha}`).sort().join("\n");
        obs.sha = textHash(listing);
        obs.textHash = this.saveText(got.data.map((f: any) => f.name).sort().join("\n"));
      } else {
        obs.sha = got.data.sha;
        if (got.data.content) {
          const raw = Buffer.from(got.data.content, "base64").toString("utf8");
          this.bodies.set(key, raw);
          obs.textHash = this.saveText(/\.(md|markdown|txt)$/i.test(r.path) ? markdownToText(raw) : raw.split("\n").map(l => l.trimEnd()).filter(Boolean).join("\n"));
        }
      }
      const commits = await this.http.json(`${GH}/repos/${r.repo}/commits?path=${encodeURIComponent(r.path)}&sha=${encodeURIComponent(r.ref)}&per_page=1`, { accept: GH_ACCEPT });
      obs.changedOn = Array.isArray(commits.data) && commits.data[0] ? (commits.data[0].commit?.committer?.date ?? "").slice(0, 10) || null : null;
    }
    this.snap.files[key] = obs;
  }

  /** iTunes lookup, many ids per request. */
  async apps(ids: string[]): Promise<void> {
    const todo = [...new Set(ids)].filter(id => !this.snap.apps[id]);
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const { got, data } = await this.http.json(`https://itunes.apple.com/lookup?id=${batch.join(",")}&country=us&entity=software`);
      const found = new Map<string, any>((data?.results ?? []).map((r: any) => [String(r.trackId), r]));
      for (const id of batch) {
        const r = found.get(id);
        if (got.status !== 200 || !data) { this.snap.apps[id] = { listed: null, problem: problemOf(got) ?? `status ${got.status}` }; continue; }
        this.snap.apps[id] = r ? appFromLookup(r) : { listed: false };
      }
    }
  }

  /** Google Play: only whether the listing still answers. The page itself is not parsed. */
  async play(id: string): Promise<void> {
    if (this.snap.play[id]) return;
    const got = await this.http.get(`https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=en&gl=US`);
    this.snap.play[id] = { status: got.status, listed: got.problem ? null : got.status === 200 ? true : got.status === 404 ? false : null, problem: problemOf(got) };
  }

  /** Discord's public invite endpoint, without a login. Only validity is kept. */
  async invite(url: string): Promise<void> {
    if (this.snap.invites[url]) return;
    this.snap.invites[url] = { code: null, valid: null, status: 0 };
    let code = discordInviteCode(url);
    let problem: string | undefined;
    if (!code) {
      // A maker's redirect, such as discord.example.org: follow it until it reaches Discord.
      const hops = await this.http.get(url, { stopAt: u => /^https:\/\/(?:[^/]*\.)?discord(?:app)?\.(?:gg|com)\//.test(u) });
      code = discordInviteCode(hops.finalUrl);
      if (!code) problem = hops.problem ?? (hops.status === 200 ? "the address answers with a page, not a redirect; an invite there would need scripts" : `redirect did not reach an invite (status ${hops.status})`);
    }
    if (!code) { this.snap.invites[url] = { code: null, valid: null, status: 0, problem }; return; }
    const { got, data } = await this.http.json(`https://discord.com/api/v10/invites/${code}`);
    const valid = got.status === 200 ? true : got.status === 404 || data?.code === 10006 ? false : null;
    this.snap.invites[url] = { code, valid, status: got.status, problem: valid === null ? problemOf(got) ?? `status ${got.status}` : undefined };
  }

  /** Text that a channel source publishes, for the "still shows the invite" check. */
  private sourceBody(source: string): string | null {
    const gh = githubRef(source);
    if (gh?.kind === "repo") return this.bodies.get(`readme ${gh.repo.toLowerCase()}`) ?? null;
    if (gh?.kind === "file") return this.bodies.get(resourceKey({ type: "file", repo: gh.repo, ref: gh.ref, path: gh.path, dir: gh.dir, role: "source" })) ?? null;
    return this.bodies.get(source) ?? null;
  }

  async run(list: Entry[], onProgress?: (msg: string) => void): Promise<Snapshot> {
    const all = new Map<string, Resource>();
    for (const e of list) for (const r of e.resources) all.set(resourceKey(r) + (r.type === "discord" ? ` ${r.source}` : ""), r);
    const of = <T extends Resource["type"]>(t: T) => [...all.values()].filter((r): r is Extract<Resource, { type: T }> => r.type === t);

    onProgress?.(`pages: ${of("page").length}`);
    await Promise.all(of("page").map(r => this.page(r.url)));
    onProgress?.(`repositories: ${new Set(of("repo").map(r => r.repo.toLowerCase())).size}, files: ${of("file").length}`);
    await Promise.all([...of("repo").map(r => this.repo(r.repo)), ...of("file").map(r => this.file(r))]);

    // Store listings that an entry's own page or README links to.
    const linkedApps = new Map<string, Set<string>>(), linkedPlay = new Map<string, Set<string>>();
    for (const e of list) {
      if (e.dataset !== "services" || e.kind === "community") continue;
      const bodies: string[] = [];
      for (const r of e.resources) {
        if (r.role !== "main" && r.role !== "link") continue;
        if (r.type === "page") bodies.push(...(this.snap.pages[r.url]?.links ?? []));
        if (r.type === "repo") bodies.push(...pageLinks(this.bodies.get(`readme ${r.repo.toLowerCase()}`) ?? "", `https://github.com/${r.repo}/`).map(l => l.url));
      }
      linkedApps.set(e.key, new Set(bodies.map(appStoreId).filter((x): x is string => !!x)));
      linkedPlay.set(e.key, new Set(bodies.map(playId).filter((x): x is string => !!x)));
    }
    const appIds = [...of("app").map(r => r.id), ...[...linkedApps.values()].flatMap(s => [...s])];
    onProgress?.(`App Store listings: ${new Set(appIds).size}`);
    await this.apps(appIds);
    for (const e of list) {
      if (!linkedApps.has(e.key)) continue;
      const own = (name: string | undefined) => !!name && (norm(name).includes(norm(e.name)) || norm(e.name).includes(norm(name.split(/[:|\-\u2013\u2014(]/)[0])));
      const apps = [...(linkedApps.get(e.key) ?? [])].filter(id => own(this.snap.apps[id]?.name));
      // Play ids carry no name we can read without parsing the page, so the id itself has to name the product or maker.
      const play = playIdsFor([...(linkedPlay.get(e.key) ?? [])], e.name, e.maker);
      if (apps.length || play.length) this.snap.linked[e.key] = { apps, play };
    }
    const playIds = [...of("play").map(r => r.id), ...Object.values(this.snap.linked).flatMap(l => l.play)];
    onProgress?.(`Google Play listings: ${new Set(playIds).size}, invites: ${new Set(of("discord").map(r => r.url)).size}`);
    await Promise.all([...new Set(playIds)].map(id => this.play(id)));
    for (const r of of("discord")) await this.invite(r.url);

    // Does the page the maker publishes the invite on still show it?
    for (const r of of("discord")) {
      if (!r.source) continue;
      const shell = this.snap.pages[r.source]?.scriptShell;
      const body = shell ? null : this.sourceBody(r.source);
      const bare = r.url.replace(/^https:\/\//, "").replace(/\/$/, "");
      const code = this.snap.invites[r.url]?.code;
      this.snap.channelSeen[`${r.url}|${r.source}`] = body === null ? null : body.includes(bare) || (!!code && new RegExp(`discord(?:app)?\\.(?:gg|com/invite)/${code}\\b`).test(body));
    }
    return this.snap;
  }
}
