// Tests for the discovery reports. No network: every input below is made up for the test.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Guide } from "../../schema/src/schema.ts";
import { answeredOf, isRelevant, kindOf, sanitize, sortThread, themeOf, type Thread } from "./classify.ts";
import { cleanTitle, draftFor, keepPath, pageLinks, pageMeta, parseSitemap } from "./guides.ts";
import { fromDiscussion, fromIssue, parseRss } from "./harvest.ts";
import { Cache, OfflineMiss, parseRobots, robotsAllows } from "./http.ts";
import { outputDir, REPO_ROOT } from "./main.ts";
import { buildIndex, normalizeUrl, phrase, type Data } from "./project.ts";
import { guidesReport, isCheapWin, isOpenGap, questionsReport, themeRows } from "./report.ts";

// ---------- synthetic project data ----------

const word = (id: string, term: string, also: string[] = [], search: string[] = []) =>
  ({ id, term, also_called: also, search_terms: search, aliases: [], tier: "more", who: "both", heard_when: "", plain: "x", related: [], source: "https://example.org", uncertain: false });
const data: Data = {
  words: { words: [word("bonding", "Bonding", [], ["bonded stream"]), word("scene", "Scene", [], ["Scenes"]), word("stats-url", "Stats URL")] },
  answers: { answers: [
    { id: "second-link-idle", question: "My second connection is connected, but the stream doesn't use it", summary: "Connected isn't carrying.", checks: [{ text: "x" }], words: ["bonding"], services: [], sources: [] },
    { id: "made-up-check", question: "Widget colours look washed out on the overlay", summary: "Colour range mismatch on the overlay widget.", checks: [{ text: "x" }], words: ["scene"], services: [], sources: [] },
  ]},
  guides: { guides: [
    { id: "sample-app-bonding", checked_on: "2026-01-01", url: "https://docs.example.org/app/bonding/", covers: ["sample-app"], part: ["connections"], kind: "article", words: ["bonding"], answers: [] },
    { id: "sample-app-docs", checked_on: "2026-01-01", url: "https://docs.example.org/", covers: ["sample-app"], part: ["sender"], kind: "docs", words: [], answers: [] },
  ]},
  services: { services: [
    { id: "sample-app", name: "Sample App", class: "phone-app", url: "https://example.org/app", links: [{ label: "Code", url: "https://github.com/example/sample-app" }], support: [] },
    { id: "other-tool", name: "Other Tool", class: "production", url: "https://example.org/tool", links: [], support: [] },
  ]},
};
const index = buildIndex(data);

function thread(over: Partial<Thread> = {}): Thread {
  return { id: "t", source: "github", where: "example/sample-app", url: "https://github.com/example/sample-app/issues/1", title: "Something", created: "2026-10-01", updated: "2026-10-02",
    type: "issue", labels: [], category: null, open: true, closedAs: null, accepted: false, upvotedAnswer: false, maintainerReplied: false, replies: 0, score: 0, byMaintainer: false, text: "", ...over };
}

// ---------- robots.txt and cache ----------

test("robots: the most specific group applies and the longest rule wins", () => {
  const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: irl-commons-discovery\nDisallow: /private\nAllow: /private/open$\nCrawl-delay: 2\n");
  expect(robotsAllows(r, "/docs/page")).toBe(true);
  expect(robotsAllows(r, "/private/x")).toBe(false);
  expect(robotsAllows(r, "/private/open")).toBe(true);
  expect(robotsAllows(r, "/private/open/more")).toBe(false);
  expect(r.delay).toBe(2);
  const star = parseRobots("User-agent: OtherBot\nDisallow: /\n\nUser-agent: *\nDisallow: /feeds/videos.xml\nDisallow: /*.git$\n");
  expect(robotsAllows(star, "/feeds/videos.xml?channel_id=1")).toBe(false);
  expect(robotsAllows(star, "/org/repo.wiki.git")).toBe(false);
  expect(robotsAllows(star, "/org/repo/wiki/_pages")).toBe(true);
  expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /\n"), "/anything")).toBe(false);
});

test("cache: offline runs never fetch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-test-"));
  const online = new Cache(dir);
  expect(await online.remember("k", 1, async () => 42)).toBe(42);
  const offline = new Cache(dir, true);
  expect(await offline.remember("k", 0, async () => 0)).toBe(42);
  expect(offline.remember("missing", 1, async () => 1)).rejects.toBeInstanceOf(OfflineMiss);
});

test("the output folder must be outside the repository", () => {
  expect(() => outputDir(undefined)).toThrow();
  expect(() => outputDir(REPO_ROOT)).toThrow();
  expect(() => outputDir(join(REPO_ROOT, "reports"))).toThrow();
  expect(outputDir(join(tmpdir(), "discovery-out"))).toBe(join(tmpdir(), "discovery-out"));
});

// ---------- privacy ----------

test("sanitize drops links, addresses, handles, e-mail and keys", () => {
  const text = "Hi @someone, my srt://203.0.113.5:4000?streamid=abc123 and rtmp://example.net/live fail. Mail me at a.person@example.com. key=live_abcdefghijk 2001:db8::1 ```log\nsecret\n```";
  const out = sanitize(text);
  for (const leak of ["someone", "203.0.113.5", "abc123", "example.net", "a.person", "live_abcdefghijk", "2001:db8", "secret"]) expect(out).not.toContain(leak);
  expect(sanitize("word ".repeat(300)).length).toBe(600);
});

test("GitHub threads keep no people: only association flags", () => {
  const issue = fromIssue({ number: 7, title: "Stream drops", url: "https://github.com/example/sample-app/issues/7", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z",
    state: "CLOSED", stateReason: "COMPLETED", bodyText: "ping @helper", authorAssociation: "NONE", author: { login: "someone" },
    labels: { nodes: [{ name: "bug" }] }, reactions: { totalCount: 2 }, comments: { totalCount: 2, nodes: [{ authorAssociation: "NONE" }, { authorAssociation: "OWNER" }] },
    repository: { nameWithOwner: "example/sample-app" } }, "github");
  expect(JSON.stringify(issue)).not.toContain("someone");
  expect(JSON.stringify(issue)).not.toContain("helper");
  expect(issue).toMatchObject({ open: false, closedAs: "completed", maintainerReplied: true, byMaintainer: false, replies: 2, labels: ["bug"] });
  const own = fromDiscussion({ number: 3, title: "Roadmap", url: "u", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", closed: false, isAnswered: false,
    bodyText: "", authorAssociation: "OWNER", upvoteCount: 0, category: { name: "General" }, answer: null, comments: { totalCount: 1, nodes: [{ authorAssociation: "OWNER" }] },
    repository: { nameWithOwner: "example/sample-app" } }, "github");
  expect(own).toMatchObject({ byMaintainer: true, maintainerReplied: false, type: "discussion" });
});

// ---------- sorting ----------

test("relevance for general sources needs a strong sign, two in all, one in the title", () => {
  expect(isRelevant("Bonded stream to OBS drops", "")).toBe(true);
  expect(isRelevant("Stream drops on my backpack", "uses obs")).toBe(true);
  expect(isRelevant("Converting SRT subtitles", "srt subtitle file for obs")).toBe(false);
  expect(isRelevant("Server crashes", "my cellular backpack with obs")).toBe(false); // nothing in the title
  expect(isRelevant("OBS and RTMP setup", "twitch")).toBe(false); // no strong sign
});

test("kind: labels, categories and titles", () => {
  const k = (title: string, extra: Partial<Thread> = {}) => kindOf({ ...thread(extra), title }).kind;
  expect(k("Anything", { labels: ["question"] })).toBe("question");
  expect(k("Anything", { type: "discussion", category: "Q&A" })).toBe("question");
  expect(k("Anything", { type: "discussion", category: "Ideas" })).toBe("feature");
  expect(k("[Feature Request] Ability to edit text?")).toBe("feature");
  expect(k("How do I add a second phone?")).toBe("question");
  expect(k("Add an option for vertical video")).toBe("feature");
  expect(k("`parseThing` retains its delegate")).toBe("dev");
  expect(k("MEDIUM: weak tokens accepted")).toBe("dev");
  expect(k("Weak SAMPLE_SECRET values accepted")).toBe("dev");
  expect(k("iPhone preview stays black")).toBe("problem");
  expect(k("Preview stays black", { type: "thread" })).toBe("question");
});

test("answer state", () => {
  expect(answeredOf(thread({ accepted: true }))).toBe("answered");
  expect(answeredOf(thread({ open: false, closedAs: "completed", maintainerReplied: true }))).toBe("answered");
  expect(answeredOf(thread({ maintainerReplied: true }))).toBe("maintainer-replied");
  expect(answeredOf(thread({ replies: 3 }))).toBe("replied");
  expect(answeredOf(thread())).toBe("unanswered");
  expect(answeredOf(thread({ open: false, closedAs: "not-planned" }))).toBe("closed-unanswered");
});

test("themes count title hits twice", () => {
  expect(themeOf("Audio drifts after a while", "the stream uses obs and a media source").theme).toBe("audio");
  expect(themeOf("Something odd", "").theme).toBe("other");
});

test("coverage: answer phrase, then guide with a shared word, then related guide, then word", () => {
  const byAnswer = sortThread(thread({ title: "Second phone shows connected but sends nothing" }), index);
  expect(byAnswer.coverage).toBe("answer");
  expect(byAnswer.answers[0].id).toBe("second-link-idle");
  const byGuide = sortThread(thread({ title: "Bonding over two modems is slow", text: "using a bonded stream" }), index);
  expect(byGuide.coverage).toBe("guide");
  expect(byGuide.guides).toEqual(["sample-app-bonding"]);
  const related = sortThread(thread({ title: "Crash when opening settings" }), index);
  expect(related.coverage).toBe("related-guide");
  const wordOnly = sortThread(thread({ where: "someone/else", title: "Where is the stats URL?" }), index);
  expect(wordOnly.coverage).toBe("word");
  expect(wordOnly.words).toEqual(["stats-url"]);
  const generic = sortThread(thread({ where: "someone/else", title: "Scenes reset" }), index);
  expect(generic.coverage).toBe("none"); // "Scenes" is too common to count
});

test("answers without phrases match by shared words and a shared glossary word", () => {
  const s = sortThread(thread({ where: "someone/else", title: "Overlay widget colours washed out in the live scene collection", text: "" }), {
    ...index, words: [...index.words, { id: "scene", name: "Scene collection", re: phrase("Scene collection"), generic: false }] });
  expect(s.answers.map((a) => a.id)).toEqual(["made-up-check"]);
});

test("products come from the repository and from names in the text", () => {
  const s = sortThread(thread({ title: "Works with Other Tool but not alone" }), index);
  expect(s.products.sort()).toEqual(["other-tool", "sample-app"]);
});

// ---------- reports ----------

test("question report lists themes, cheap wins and open gaps, without people", () => {
  const sorted = [
    sortThread(thread({ id: "a", url: "https://github.com/example/sample-app/issues/2", title: "How do I keep the phone cool?", maintainerReplied: true, open: false, closedAs: "completed" }), index),
    sortThread(thread({ id: "b", url: "https://github.com/example/sample-app/issues/3", title: "Why does the battery drain so fast?" }), index),
    sortThread(thread({ id: "c", url: "https://github.com/example/sample-app/issues/4", title: "Add dark mode", byMaintainer: true }), index),
  ];
  expect(sorted.filter(isCheapWin).map((s) => s.id)).toEqual(["a"]);
  expect(sorted.filter(isOpenGap).map((s) => s.id)).toEqual(["b"]);
  expect(themeRows(sorted, "2026-11-20")[0]).toMatchObject({ theme: "heat-battery-power", threads: 2, cheap: 1, open: 1 });
  const md = questionsReport(sorted, [{ source: "GitHub example/sample-app", read: 3, kept: 3 }], { today: "2026-11-20", since: "2024-11-20" });
  expect(md).toContain("## Cheap wins");
  expect(md).toContain("Heat, battery and power");
  expect(md).not.toContain("Add dark mode");
});

// ---------- guides ----------

test("sitemaps, index pages, RSS and page titles parse", () => {
  const idx = parseSitemap(`<sitemapindex><sitemap><loc>https://docs.example.org/sitemap-0.xml</loc></sitemap></sitemapindex>`);
  expect(idx.sitemaps).toEqual(["https://docs.example.org/sitemap-0.xml"]);
  const set = parseSitemap(`<urlset><url><loc>https://docs.example.org/a/</loc><lastmod>2026-11-01T10:00:00Z</lastmod></url><url><loc>https://docs.example.org/b/</loc></url></urlset>`);
  expect(set.pages).toEqual([{ url: "https://docs.example.org/a/", lastmod: "2026-11-01" }, { url: "https://docs.example.org/b/", lastmod: null }]);
  expect(pageLinks(`<a href="/kb/one">1</a><a href="https://elsewhere.example/x">2</a><a href="two.html#top">3</a>`, "https://docs.example.org/kb")).toEqual(["https://docs.example.org/kb/one", "https://docs.example.org/two.html"]);
  const rss = parseRss(`<rss><channel><item><title>Bonding &amp; OBS</title><link>https://forum.example.org/t/1/</link><pubDate>Mon, 26 Oct 2026 16:43:09 +0000</pubDate><slash:comments>4</slash:comments><dc:creator>someone</dc:creator><content:encoded><![CDATA[<p>Body</p>]]></content:encoded></item></channel></rss>`);
  expect(rss).toEqual([{ title: "Bonding & OBS", link: "https://forum.example.org/t/1/", date: "2026-10-26", comments: 4, text: " Body " }]);
  expect(pageMeta(`<html lang="es-419"><head><title>Guía | Docs</title></head></html>`)).toEqual({ title: "Guía | Docs", language: "es" });
  expect(cleanTitle("Send phone video to OBS with SRT | Sample Docs")).toBe("Send phone video to OBS with SRT");
  expect(cleanTitle("Enhanced RTMP explained | codecs and more")).toBe("Enhanced RTMP explained | codecs and more");
});

test("page rules and URL comparison", () => {
  expect(keepPath("https://docs.example.org/", {})).toBe(false);
  expect(keepPath("https://docs.example.org/pricing/", {})).toBe(false);
  expect(keepPath("https://docs.example.org/es/start/", { exclude: "^/es/" })).toBe(false);
  expect(keepPath("https://docs.example.org/guides/start/", { include: "^/guides/" })).toBe(true);
  expect(normalizeUrl("https://www.Example.org/a/?utm_source=x#top")).toBe("https://example.org/a");
  expect(normalizeUrl("https://youtu.be/abc")).toBe(normalizeUrl("https://www.youtube.com/watch?v=abc&t=10"));
});

test("drafts use only guides.json fields, plus a review block", () => {
  const d = draftFor({ url: "https://docs.example.org/app/second-phone/", lastmod: "2026-11-01", title: "Add a second phone for bonding", language: null }, ["sample-app"], "Sample App", "Sample docs", index, "2026-11-20");
  const { review, ...entry } = d;
  for (const key of Object.keys(entry)) expect(Object.keys(Guide.shape)).toContain(key);
  expect(entry).toMatchObject({ publisher: "sample-app", covers: ["sample-app"], part: ["connections"], words: ["bonding"], language: "en", published: null });
  expect(review).toMatchObject({ status: "unverified", inside: "sample-app-docs", theme: "second-connection" });
  const md = guidesReport([d], [{ guide: "sample-app-bonding", url: "https://docs.example.org/app/bonding/", checked_on: "2026-01-01", lastmod: "2026-06-01", found_via: "Sample docs" }], [], "2026-11-20", false, new Map([["second-connection", 5]]));
  expect(md).toContain("Listed guides to re-read");
  expect(md).toContain("Add a second phone for bonding");
});
