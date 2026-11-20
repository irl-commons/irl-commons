// What the watch looks at for each entry, read from services.json and standards.json.
// Pure functions; no network.
import { comparisonFacts } from "../stale.ts";

export type Role = "main" | "link" | "source" | "fact-source" | "support" | "channel-source";
export type Resource =
  | { type: "page"; url: string; role: Role }
  | { type: "repo"; repo: string; role: Role }
  | { type: "file"; repo: string; ref: string; path: string; dir: boolean; role: Role }
  | { type: "app"; id: string; role: Role }
  | { type: "play"; id: string; role: Role }
  | { type: "discord"; url: string; source: string | null; role: Role };

export type Entry = {
  key: string;
  dataset: "services" | "standards";
  id: string;
  /** The service kind or the standard kind. */
  kind: string;
  name: string;
  maker: string;
  checked_on: string;
  /** The release stage a service states, or null. */
  status: string | null;
  licence: string | null;
  open_source: boolean | null;
  url: string | null;
  resources: Resource[];
};

export type GithubRef =
  | { kind: "repo"; repo: string }
  | { kind: "file"; repo: string; ref: string; path: string; dir: boolean }
  | { kind: "page"; url: string }
  | { kind: "owner"; owner: string }
  | { kind: "skip" };

const NOT_OWNERS = new Set(["sponsors", "orgs", "topics", "features", "marketplace", "about", "settings", "login", "apps", "search", "collections", "enterprise", "pricing"]);

/** How to watch a github.com URL; null when it isn't one. */
export function githubRef(url: string): GithubRef | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.host !== "github.com" && u.host !== "www.github.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length || NOT_OWNERS.has(parts[0].toLowerCase())) return { kind: "skip" };
  if (parts.length === 1) return { kind: "owner", owner: parts[0] };
  const repo = `${parts[0]}/${parts[1].replace(/\.git$/, "")}`;
  const rest = parts.slice(2);
  if (!rest.length || ["issues", "discussions", "releases", "pulls", "tags"].includes(rest[0])) return { kind: "repo", repo };
  if ((rest[0] === "blob" || rest[0] === "tree") && rest.length >= 2)
    return { kind: "file", repo, ref: rest[1], path: decodeURIComponent(rest.slice(2).join("/")), dir: rest[0] === "tree" };
  if (rest[0] === "wiki") return { kind: "page", url: u.origin + u.pathname };
  return { kind: "skip" };
}

export function appStoreId(url: string): string | null {
  const m = url.match(/^https:\/\/(?:apps|itunes)\.apple\.com\/[^?#]*\/id(\d{6,})/);
  return m ? m[1] : null;
}
export function playId(url: string): string | null {
  const m = url.match(/^https:\/\/play\.google\.com\/store\/apps\/details\?(?:[^#]*&)?id=([A-Za-z0-9._]+)/);
  return m ? m[1] : null;
}
export function discordInviteCode(url: string): string | null {
  const m = url.match(/^https:\/\/(?:www\.)?(?:discord\.gg(?:\/invite)?|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)\/?(?:\?[^#]*)?$/);
  return m ? m[1] : null;
}
const isDiscordHost = (url: string) => /^https:\/\/(?:[^/]*\.)?discord(?:app)?\.(?:gg|com)\//.test(url);

/** The resources one URL turns into. */
export function resourcesFor(url: string, role: Role): Resource[] {
  const app = appStoreId(url);
  if (app) return [{ type: "app", id: app, role }];
  const play = playId(url);
  if (play) return [{ type: "play", id: play, role }];
  const gh = githubRef(url);
  if (gh) {
    if (gh.kind === "repo") return [{ type: "repo", repo: gh.repo, role }];
    if (gh.kind === "file") return [{ type: "file", repo: gh.repo, ref: gh.ref, path: gh.path, dir: gh.dir, role }];
    if (gh.kind === "page") return [{ type: "page", url: gh.url, role }];
    return [];
  }
  if (isDiscordHost(url)) return [];
  return [{ type: "page", url, role }];
}

export const resourceKey = (r: Resource): string =>
  r.type === "page" ? `page ${r.url}` : r.type === "repo" ? `repo ${r.repo.toLowerCase()}` :
  r.type === "file" ? `file ${r.repo.toLowerCase()}@${r.ref}:${r.path}` : r.type === "app" ? `app ${r.id}` :
  r.type === "play" ? `play ${r.id}` : `discord ${r.url}`;

function dedupe(list: Resource[]): Resource[] {
  const order: Role[] = ["main", "link", "source", "fact-source", "channel-source", "support"];
  const best = new Map<string, Resource>();
  for (const r of list) {
    const k = resourceKey(r) + (r.type === "discord" ? ` ${r.source}` : "");
    const prev = best.get(k);
    if (!prev || order.indexOf(r.role) < order.indexOf(prev.role)) best.set(k, r);
  }
  return [...best.values()];
}

export function entries(services: any[], standards: any[]): Entry[] {
  const out: Entry[] = [];
  for (const s of services) {
    const list: Resource[] = [...resourcesFor(s.url, "main")];
    for (const l of s.links ?? []) list.push(...resourcesFor(l.url, "link"));
    for (const src of s.sources ?? []) list.push(...resourcesFor(src.url, "source"));
    for (const c of s.support ?? []) {
      if (c.kind === "discord" || isDiscordHost(c.url)) list.push({ type: "discord", url: c.url, source: c.source ?? null, role: "support" });
      else list.push(...resourcesFor(c.url, "support"));
      if (c.source && c.source !== c.url) list.push(...resourcesFor(c.source, "channel-source"));
    }
    out.push({ key: `services/${s.id}`, dataset: "services", id: s.id, kind: s.kind, name: s.name, maker: s.maker, checked_on: s.checked_on, status: s.status ?? null,
      licence: s.licence ?? null, open_source: s.open_source ?? null, url: s.url, resources: dedupe(list) });
  }
  for (const s of standards) {
    const list: Resource[] = s.url ? [...resourcesFor(s.url, "main")] : [];
    for (const l of s.sources ?? []) list.push(...resourcesFor(l.url, "source"));
    for (const [, fact] of comparisonFacts(s)) for (const l of fact.sources ?? []) list.push(...resourcesFor(l.url, "fact-source"));
    out.push({ key: `standards/${s.id}`, dataset: "standards", id: s.id, kind: s.kind, name: s.name, maker: s.maker, checked_on: s.checked_on, status: null,
      licence: s.licence ?? null, open_source: null, url: s.url, resources: dedupe(list) });
  }
  return out;
}

/** A commit-pinned file can't change; there is nothing to watch. */
export const pinned = (r: Resource) => r.type === "file" && /^[0-9a-f]{40}$/.test(r.ref);
