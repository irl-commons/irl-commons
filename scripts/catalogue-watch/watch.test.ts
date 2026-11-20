import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseRobots, robotsAllows } from "../lib/robots.ts";
import { declaredModified, htmlToText, lineDiff, markdownToText, pageLinks, pageTitle, quote } from "./text.ts";
import { appStoreId, discordInviteCode, entries, githubRef, playId, resourceKey } from "./sources.ts";
import { appFromLookup, emptySnapshot, playIdsFor, type Snapshot } from "./signals.ts";
import { assess, licenceMentioned, pickBaseline, renderRecheck } from "./rank.ts";
import { alreadyListed, knownIndex, outsider, relatedEntry, relevance, renderCandidates, score, skeleton, type Candidate } from "./discover.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/catalogue-watch/${name}`, import.meta.url), "utf8");

test("robots: the named group wins over *, longest rule wins, Allow wins a tie, $ anchors", () => {
  const mine = parseRobots(fixture("robots.txt"), "irl-commons-catalogue-watch");
  expect(mine.delay).toBe(2);
  expect(robotsAllows(mine, "/private/x")).toBe(false);
  expect(robotsAllows(mine, "/private/public-page")).toBe(true);
  expect(robotsAllows(mine, "/private/public-page/more")).toBe(false);
  expect(robotsAllows(mine, "/search")).toBe(true); // only the * group disallows it
  const other = parseRobots(fixture("robots.txt"), "another-client");
  expect(robotsAllows(other, "/owner/repo/tree/main/docs")).toBe(false);
  expect(robotsAllows(other, "/search")).toBe(false);
  expect(robotsAllows(other, "/search/more")).toBe(true);
  expect(robotsAllows(other, "/tmpfile")).toBe(false);
  expect(robotsAllows(other, "/owner?tab=readme")).toBe(true);
  // Two User-agent lines share one group.
  expect(robotsAllows(parseRobots(fixture("robots.txt"), "OtherBot/1.0"), "/anything")).toBe(false);
  expect(robotsAllows(parseRobots("", "x"), "/anything")).toBe(true);
});

test("page text keeps the main content and drops scripts, navigation, footers and copyright lines", () => {
  const html = fixture("page.html");
  const text = htmlToText(html);
  expect(text.split("\n")[0]).toBe("Example Cast");
  expect(text).toContain("Stream from your phone with SRT and bonding. Version 2.1 is out.");
  expect(text).not.toMatch(/dataLayer|color: red|Pricing|All rights reserved|Skip to content/);
  expect(pageTitle(html)).toBe("Example Cast & Relay");
  expect(declaredModified(html)).toBe("2026-11-01");
  const links = pageLinks(html, "https://example.org/").map(l => l.url);
  expect(links.map(appStoreId).filter(Boolean)).toEqual(["1234567890"]);
  expect(links.map(playId).filter(Boolean)).toEqual(["org.example.cast"]);
  expect(links).toContain("https://discord.gg/exAmple1");
});

test("README text drops badges, images and link targets", () => {
  const text = markdownToText(fixture("readme.md"));
  expect(text).toBe("# Example Relay\nA self-hosted SRTLA receiver. See the docs and .\nJoin the Discord for help.");
});

test("line diff lists removed and added lines in order", () => {
  expect(lineDiff("a\nb\nc\nd", "a\nc\nd\ne")).toEqual({ added: ["e"], removed: ["b"] });
  expect(lineDiff("", "x")).toEqual({ added: ["x"], removed: [] });
  expect(quote("hi `@someone`\nthere")).toBe("`hi @someone there`");
});

test("URLs map to what is watched", () => {
  expect(githubRef("https://github.com/owner/repo#readme")).toEqual({ kind: "repo", repo: "owner/repo" });
  expect(githubRef("https://github.com/owner/repo/issues")).toEqual({ kind: "repo", repo: "owner/repo" });
  expect(githubRef("https://github.com/owner/repo/blob/main/docs/a%20b.md")).toEqual({ kind: "file", repo: "owner/repo", ref: "main", path: "docs/a b.md", dir: false });
  expect(githubRef("https://github.com/owner/repo/tree/main/crates/plugin")).toMatchObject({ kind: "file", dir: true });
  expect(githubRef("https://github.com/owner/repo/wiki")).toEqual({ kind: "page", url: "https://github.com/owner/repo/wiki" });
  expect(githubRef("https://github.com/owner")).toEqual({ kind: "owner", owner: "owner" });
  expect(githubRef("https://github.com/sponsors/owner")).toEqual({ kind: "skip" });
  expect(githubRef("https://example.org/")).toBeNull();
  expect(discordInviteCode("https://discord.gg/abc123")).toBe("abc123");
  expect(discordInviteCode("https://discord.gg/invite/abc123")).toBe("abc123");
  expect(discordInviteCode("https://discord.com/invite/abc123?utm=x")).toBe("abc123");
  expect(discordInviteCode("https://discord.example.org")).toBeNull();
});

const service = {
  id: "example-cast", checked_on: "2026-11-01", name: "Example Cast", kind: "app", role: "streaming-app", class: "phone-app", hosting: null,
  maker: "Example Maker", url: "https://example.org/", links: [{ label: "GitHub", url: "https://github.com/example-maker/example-cast" }],
  open_source: true, licence: "MIT OR Apache-2.0", status: "beta", description: "x", platforms: ["ios"], part: ["sender"], covers: [],
  support: [{ label: "Discord", url: "https://discord.gg/exAmple1", kind: "discord", checked_on: "2026-11-01", source: "https://example.org/" }],
  tags: [], words: [],
};
const standard = { id: "example-format", checked_on: "2026-11-01", name: "Example format (EXF)", maker: "Example Maker", kind: "format", url: "https://github.com/example-maker/exf/blob/main/SPEC.md",
  sources: [{ label: "Spec", url: "https://github.com/example-maker/exf/blob/main/SPEC.md" }], other_users: ["Other Tool"] };

test("entries list each source once, with its role", () => {
  const [s, f] = entries([service], [standard]);
  expect(s.resources.map(resourceKey)).toEqual(["page https://example.org/", "repo example-maker/example-cast", "discord https://discord.gg/exAmple1"]);
  expect(f.resources).toEqual([{ type: "file", repo: "example-maker/exf", ref: "main", path: "SPEC.md", dir: false, role: "main" }]);
});

test("store listings: lookup fields and Play ids that name the product", () => {
  const app = appFromLookup(JSON.parse(fixture("itunes-lookup.json")).results[0]);
  expect(app).toMatchObject({ listed: true, version: "2.1.0", releaseDate: "2026-11-18", seller: "Example Maker Ltd" });
  expect(playIdsFor(["org.example.cast", "org.example.player"], "Example Cast", "Example Maker")).toEqual(["org.example.cast"]);
  expect(playIdsFor(["com.maker.prism", "com.other.thing"], "Maker Prism Mobile", "Maker")).toEqual(["com.maker.prism"]);
  expect(playIdsFor(["com.other.thing"], "Example Cast", "Example Maker")).toEqual([]);
});

const base = (date: string): Snapshot => ({
  ...emptySnapshot(date),
  pages: { "https://example.org/": { status: 200, finalUrl: "https://example.org/", textHash: "old" } },
  repos: { "example-maker/example-cast": { status: 200, fullName: "example-maker/example-cast", archived: false, license: "MIT", release: { tag: "v1", date: "2026-10-01" }, readme: null, description: "d", homepage: null } },
  invites: { "https://discord.gg/exAmple1": { code: "exAmple1", valid: true, status: 200 } },
  channelSeen: { "https://discord.gg/exAmple1|https://example.org/": true },
});

test("a quiet entry scores only its freshness; the baseline is the first run after the check", () => {
  const [entry] = entries([service], []);
  expect(pickBaseline(["2026-10-30", "2026-11-03", "2026-11-10"], "2026-11-01")).toBe("2026-11-03");
  expect(pickBaseline(["2026-10-30"], "2026-11-01")).toBeNull();
  const a = assess(entry, base("2026-11-10"), base("2026-11-03"), "2026-11-10", () => null);
  expect(a.reasons).toEqual([]);
  expect(licenceMentioned("MIT OR Apache-2.0", "Apache-2.0")).toBe(true);
  expect(licenceMentioned("GPL-3.0-only", "GPL-3.0")).toBe(true);
  expect(licenceMentioned("MIT", "GPL-3.0")).toBe(false);
});

test("changes since the baseline are explained, strongest first, with a text diff", () => {
  const [entry] = entries([service], []);
  const cur = base("2026-12-01");
  cur.pages["https://example.org/"] = { status: 200, finalUrl: "https://www.example.org", textHash: "new" };
  cur.repos["example-maker/example-cast"] = { ...cur.repos["example-maker/example-cast"], archived: true, license: "GPL-3.0", release: { tag: "v2", date: "2026-11-20" } };
  cur.invites["https://discord.gg/exAmple1"] = { code: "exAmple1", valid: false, status: 404 };
  cur.channelSeen["https://discord.gg/exAmple1|https://example.org/"] = false;
  const texts: Record<string, string> = { old: "Example Cast\nVersion 1", new: "Example Cast\nVersion 2" };
  const a = assess(entry, cur, base("2026-11-03"), "2026-12-01", h => texts[h] ?? null);
  const top = a.reasons.map(r => r.text.split(":")[0]);
  expect(top[0]).toBe("repository example-maker/example-cast is archived");
  expect(top).toContain("Discord invite is no longer valid");
  expect(top).toContain("the page cited for the Discord invite no longer shows it");
  expect(a.reasons.find(r => r.text.startsWith("GitHub reports licence GPL-3.0"))).toBeDefined();
  expect(a.reasons.find(r => r.text.startsWith("release `v2`"))).toBeDefined();
  expect(a.reasons.find(r => r.text.startsWith("main page text changed"))?.detail).toEqual(["- Version 1", "+ Version 2"]);
  expect(a.reasons.some(r => r.text.includes("redirects"))).toBe(false); // www and a trailing slash don't count
  expect(a.reasons.some(r => r.text.startsWith("release stage"))).toBe(false);
  const later = assess(entry, cur, base("2026-11-03"), "2027-05-02", () => null);
  expect(later.reasons.map(r => r.text)).toContain("stale since 2027-05-01 (checked 2026-11-01, 6-month window)");
  const md = renderRecheck([a, later], { date: "2026-12-01", snapshots: ["2026-11-03", "2026-12-01"], stats: [] });
  expect(md).toContain("~~~diff");
  expect(md).toContain("| 1 | services/example-cast (Example Cast) |");
});

test("discovery dedupes against the data and spots listings of existing products", () => {
  const k = knownIndex([service], [standard]);
  const c = (over: Partial<Candidate>): Candidate => ({ key: "k", name: "Something", evidence: null, via: ["test"], description: null, homepage: null, owner: null, score: 0, why: [], flags: [], ...over });
  const repo = { fullName: "example-maker/example-cast", stars: 10, pushedAt: "2026-11-01", createdAt: null, license: null, language: null, topics: [], archived: false, fork: false, homepage: null };
  expect(alreadyListed(c({ repo }), k)).toContain("repository");
  expect(alreadyListed(c({ name: "Example Cast App" }), k)).toContain("name");
  expect(alreadyListed(c({ name: "EXF" }), k)).toContain("name");
  expect(alreadyListed(c({ homepage: "https://www.example.org/download" }), k)).toContain("site");
  expect(alreadyListed(c({ name: "New Relay", evidence: "https://github.com/someone/new-relay" }), k)).toBeNull();
  expect(relatedEntry(c({ name: "Example Cast: Live Streaming" }), k)).toBe("services/example-cast");
  expect(relatedEntry(c({ name: "Example Caster" }), k)).toBeNull();
});

test("relevance favours IRL terms and pushes away subtitle tools and guides", () => {
  expect(relevance("SRTLA bonding receiver for IRL streaming").score).toBeGreaterThan(30);
  expect(relevance("Convert .srt subtitle files").score).toBeLessThan(0);
  expect(relevance("Complete guide: how to stream IRL with a backpack").hits.map(h => h.name)).toContain("not: a guide, not a product");
  const k = knownIndex([service], [standard]);
  const repo = { fullName: "someone/other-tool", stars: 40, pushedAt: "2026-11-10", createdAt: null, license: "MIT", language: "Go", topics: ["srtla"], archived: false, fork: false, homepage: null };
  const scored = score({ key: "gh:someone/other-tool", name: "Other Tool", evidence: "https://github.com/someone/other-tool", via: ["a", "b"], description: "An SRT relay for IRL streams", homepage: null, owner: "someone", repo, score: 0, why: [], flags: [] }, k, "2026-11-20");
  expect(scored.why.join("; ")).toContain("already named in other_users of standards/example-format");
  const draft = skeleton(scored);
  expect(draft.checked_on).toBeNull();
  expect(draft).toMatchObject({ id: "other-tool", kind: "relay", licence: "MIT", platforms: ["linux"] });
  expect(draft.unverified).toContain("kind");
});

test("scope rules: wrappers, ports, small projects and general infrastructure are flagged", () => {
  const k = knownIndex([service], [standard]);
  const repo = (over = {}) => ({ fullName: "someone/x", stars: 0, pushedAt: "2026-11-10", createdAt: null, license: "MIT", language: "Go", topics: [], archived: false, fork: false, homepage: null, ...over });
  const c = (over: Partial<Candidate>): Candidate => ({ key: "gh:someone/x", name: "X", evidence: "https://github.com/someone/x", via: ["test"], description: null, homepage: null, owner: "someone", repo: repo(), score: 0, why: [], flags: [], ...over });
  const today = "2026-11-20";

  const wrapper = score(c({ name: "example-cast-docker", description: "Docker compose setup for Example Cast with SRTLA" }), k, today);
  expect(wrapper.wrapperOf).toBe("example-cast");
  expect(wrapper.flags.join("; ")).toContain("wrappers");
  expect(score(c({ name: "restreamer", description: "A Docker restreaming server that sends to YouTube and Example Cast" }), k, today).wrapperOf).toBeUndefined();
  expect(score(c({ name: "cast-box", description: "Docker container for Example Cast" }), k, today).wrapperOf).toBe("example-cast");
  const port = score(c({ name: "Example Cast Android", description: "Android port of Example Cast for IRL streaming" }), k, today);
  expect(port.portOf).toBe("example-cast");
  expect(skeleton(port)).toMatchObject({ port_of: { service: "example-cast", state: "follows" } });
  expect(skeleton(port).unverified).toContain("port_of");
  expect(skeleton(score(c({ description: "An SRTLA receiver" }), k, today))).not.toHaveProperty("port_of");

  const base = { description: "An SRTLA bonding receiver for IRL streaming" };
  const bare = score(c({ ...base, release: null, outsideUsers: false }), k, today);
  const used = score(c({ ...base, release: { at: "2026-10-01T00:00:00Z" }, outsideUsers: true }), k, today);
  expect(bare.flags).toContain("no tagged release or store listing");
  expect(bare.flags).toContain("no public user other than the maker yet");
  expect(used.score - bare.score).toBe(20);
  expect(score(c({ ...base, repo: repo({ stars: 5000 }) }), k, today).score - score(c(base), k, today).score).toBeLessThanOrEqual(6);

  const infra = score(c({ description: "A fast RTMP server and transcoder for live streaming" }), k, today);
  expect(infra.flags.join("; ")).toContain("general infrastructure");
  const linked = score(c({ description: "A fast RTMP server and transcoder for live streaming", via: ["linked from services/example-cast (https://example.org/)"] }), k, today);
  expect(linked.score - infra.score).toBeGreaterThanOrEqual(8);
  expect(score(c({ description: "An SRTLA media server for IRL streaming" }), k, today).flags.join("; ")).not.toContain("general infrastructure");

  const md = renderCandidates([wrapper, used], { date: today, raw: 2, dropped: new Map(), unresolved: [], min: -100, limit: 10, stats: [] });
  expect(md).toContain("## Possible wrappers of listed products");
  expect(md).toContain("- services/example-cast: `example-cast-docker` by `someone`");
  expect(md.split("## Details")[1].split("## Possible wrappers")[0]).not.toContain("example-cast-docker");
});

test("an outside user is anyone but the owners, members, collaborators and bots", () => {
  expect(outsider({ user: { type: "User" }, author_association: "NONE" })).toBe(true);
  expect(outsider({ user: { type: "User" }, author_association: "CONTRIBUTOR" })).toBe(true);
  expect(outsider({ user: { type: "User" }, author_association: "OWNER" })).toBe(false);
  expect(outsider({ user: { type: "Bot" }, author_association: "NONE" })).toBe(false);
});

test("the watch workflow is manual only, writes no data and opens issues only from the report job", () => {
  const w = Bun.YAML.parse(readFileSync(new URL("../../.github/workflows/catalogue-watch.yml", import.meta.url), "utf8")) as any;
  expect(Object.keys(w.on)).toEqual(["workflow_dispatch"]);
  expect(w.permissions).toEqual({});
  expect(w.jobs.watch.permissions).toEqual({ contents: "read", actions: "read" });
  expect(w.jobs.report.permissions).toEqual({ actions: "read", issues: "write" });
  expect(w.jobs.report.steps.every((s: any) => !s.uses)).toBe(true);
  const checkout = w.jobs.watch.steps.find((s: any) => s.uses?.startsWith("actions/checkout@"));
  expect(checkout.with["persist-credentials"]).toBe(false);
  expect(JSON.stringify(w)).not.toMatch(/contents: write|git push|git commit/);
});
