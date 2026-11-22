// Tests for the discovery reports. No network: every input below is made up for the test.
import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOC_FOLDERS, FORUM_FEEDS, GUIDE_FEEDS, SITES, WIKIS } from "./config.ts";
import { Guide } from "../../schema/src/schema.ts";
import { answeredOf, isRelevant, kindOf, sanitize, sortThread, themeOf, type Thread } from "./classify.ts";
import { cleanTitle, discoverGuides, draftFor, guideTitleKey, irlScore, keepPath, migrateGuideSeen, pageLinks, pageMeta, parseSitemap } from "./guides.ts";
import { GitHub, fromDiscussion, fromIssue, harvestForums, harvestGitHub, parseFeed, parseRss, type SourceStat } from "./harvest.ts";
import { Cache, Fetcher, OfflineMiss, RobotsBlocked, parseRobots, robotsAllows, writeLocalFile } from "./http.ts";
import { outputDir, prepareOutput, questionsSince, saveQuestionWindow, REPO_ROOT } from "./main.ts";
import { buildIndex, normalizeUrl, phrase, type Data } from "./project.ts";
import { withOutputDirectories } from "./output.ts";
import { readSitemap, sitemapXml } from "./sitemap.ts";
import { listWikiPages, wikiGit } from "./wiki.ts";
import { guidesReport, isCheapWin, isOpenGap, isResolvedProblem, questionsReport, themeRows } from "./report.ts";

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
    { id: "sample-app-docs", checked_on: "2026-01-01", url: "https://docs.example.org/app/", covers: ["sample-app"], part: ["sender"], kind: "docs", words: [], answers: [] },
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

test("user questions and problems can name products and platforms", () => {
  for (const title of ["How do I fix audio on macOS?", "How do I install belaUI?", "How do I run `srtla_rec`?", "Phone stream drops when memory is low?"]) {
    expect(kindOf(thread({ title })).kind).toBe("question");
  }
  expect(kindOf(thread({ title: "OBS crashes on macOS", labels: ["bug"] })).kind).toBe("problem");
  expect(kindOf(thread({ title: "srtla_rec won't start" })).kind).toBe("problem");
  expect(kindOf(thread({ title: "`srtla_rec` won't start" })).kind).toBe("problem");
  expect(kindOf(thread({ title: "`parseThing()` sets the wrong flag" })).kind).toBe("dev");
});

test("support-for titles request a feature unless phrased as a question", () => {
  expect(kindOf(thread({ title: "Support for HEVC on Android" })).kind).toBe("feature");
  expect(kindOf(thread({ title: "Is there support for HEVC on Android?" })).kind).toBe("question");
  expect(kindOf(thread({ title: "Support: dropped frames" })).kind).toBe("question");
});

test("protocol hints survive redaction without their link targets", () => {
  const text = sanitize("Send SRT://example.org:9000?passphrase=hidden and rtmp://example.net/key");
  expect(text).toBe("Send [srt://] and [rtmp://]");
  expect(isRelevant("Streaming from my phone", sanitize("I send srt://example.org:9000"))).toBe(true);
});

test("product counts exclude developer threads from support totals", () => {
  const items = [
    sortThread(thread({ labels: ["dependencies"] }), index),
    sortThread(thread({ title: "How do I connect a camera?" }), index),
    sortThread(thread({ title: "Add dark mode" }), index),
  ];
  const md = questionsReport(items, [], { today: "2026-11-20", since: "2024-11-20" });
  expect(md).toContain("| sample-app | 1 | 1 | 1 |");
});

test("output folder containment resolves missing descendants and path boundaries", () => {
  const parent = mkdtempSync(join(tmpdir(), "discovery-out-"));
  try {
    const repo = join(parent, "repo"), link = join(parent, "alias");
    mkdirSync(repo);
    symlinkSync(repo, link);
    expect(() => outputDir(join(repo, "..reports"), repo)).toThrow();
    expect(() => outputDir(join(link, "missing", "reports"), repo)).toThrow();
    expect(() => outputDir(join(repo, "missing"), link)).toThrow();
    expect(outputDir(join(parent, "..reports"), repo)).toBe(join(parent, "..reports"));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("URL comparison preserves case-sensitive paths and video IDs", () => {
  expect(normalizeUrl("https://youtu.be/AbC123?t=2")).toBe(normalizeUrl("https://www.youtube.com/watch?v=AbC123"));
  expect(normalizeUrl("https://youtube.com/watch?v=AbC123")).not.toBe(normalizeUrl("https://youtube.com/watch?v=abc123"));
  expect(normalizeUrl("https://example.org/Guide")).not.toBe(normalizeUrl("https://example.org/guide"));
  expect(normalizeUrl("https://irlhosting.com/index.php?rp=/Guide")).not.toBe(normalizeUrl("https://irlhosting.com/index.php?rp=/guide"));
});

test("a sibling path does not belong to a listed documentation root", () => {
  const page = { url: "https://docs.example.org/app-extra/setup", title: "Set up video", lastmod: null };
  expect(draftFor(page, [], null, "Example docs", index, "2026-11-20").review.inside).toBeNull();
});

test("guide drafts and relevance count a longer product name once", () => {
  const products = ["Sample App Cloud", "Sample App"].map((name) => ({ id: name, name, re: phrase(name), generic: false }));
  const project = { ...index, products };
  const page = { title: "Sample App Cloud setup", url: "https://example.org/setup", lastmod: null };
  expect(draftFor(page, [], null, "Example docs", project, "2026-11-20").covers).toEqual(["Sample App Cloud"]);
  expect(irlScore(page.title, project, ["Sample App Cloud"])).toBe(0);
});

test("out-of-range feed entities leave other entries readable", () => {
  const items = parseRss("<rss><item><title>OBS &#99999999; &#xD800; &#x1F4F9;</title></item><item><title>Next</title></item></rss>");
  expect(items.map((item) => item.title)).toEqual(["OBS \uFFFD \uFFFD 📹", "Next"]);
});

test("feeds strip escaped description markup and preserve literal CDATA titles", () => {
  const [item] = parseRss("<rss><item><title><![CDATA[OBS < 30 > crash]]></title><description>&lt;script&gt;hidden&lt;/script&gt;&lt;p&gt;Sound &amp;amp; video&lt;/p&gt;</description></item></rss>");
  expect(item.title).toBe("OBS < 30 > crash");
  expect(item.text.trim()).toBe("Sound & video");
});

test("self-closing feed links do not consume an RSS item's permalink", () => {
  const [item] = parseRss('<rss><item><link rel="self" href="https://example.org/feed"/><title>Title</title><link>https://example.org/real</link></item></rss>');
  expect(item.link).toBe("https://example.org/real");
});

test("Atom entries use the alternate link and published date", () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom" xml:base="/posts/"><entry><title>Bonding &amp; OBS</title><link rel="self" href="entry.atom"/><link href=\'17\'/><published>2026-11-20T10:00:00Z</published><updated>2026-11-21T10:00:00Z</updated><summary type="html">&lt;p&gt;Example&lt;/p&gt;</summary><thr:total>2</thr:total></entry></feed>';
  expect(parseFeed(atom, "https://example.org/atom")).toEqual([
    { title: "Bonding & OBS", link: "https://example.org/posts/17", date: "2026-11-20", comments: 2, text: " Example " },
  ]);
});

test("offline questions reuse the previous date window across days", async () => {
  const out = mkdtempSync(join(tmpdir(), "discovery-offline-"));
  try {
    const since = questionsSince(out, "2026-11-20", undefined, false);
    new Cache(join(out, "cache")).set("public-gh-repo:example/sample:" + since + ":5", [thread()]);
    writeFileSync(join(out, "questions.json"), JSON.stringify({ since, stats: [{ source: "GitHub example/sample", read: 1, kept: 1 }] }));
    const later = questionsSince(out, "2026-11-21", undefined, true);
    const github = new GitHub(new Fetcher(), new Cache(join(out, "cache"), true), null);
    expect(await github.repoThreads("example/sample", later, 5)).toMatchObject([thread()]);
    expect(questionsSince(out, "2026-11-21", "2025-11-21", true)).toBe("2025-11-21");
    expect(questionsSince(out, "2026-11-21", undefined, false)).toBe("2024-11-21");
    if (process.platform !== "linux") return;
    const alternate = Bun.spawnSync([process.execPath, "scripts/discovery/main.ts", "questions", "--out", out, "--offline", "--since", "2025-11-21"], {
      cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe",
    });
    expect(alternate.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(out, "questions.json"), "utf8")).since).toBe("2025-11-21");
    expect(questionsSince(out, "2026-11-22", undefined, true)).toBe(since);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("only an explicitly disabled Discussions feature skips the connection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-github-"));
  try {
    const cache = new Cache(dir);
    cache.set("gh-repo:example/sample:2024-11-20:50", []);
    const calls: string[] = [];
    let enabled = true, unavailable = true;
    const fetcher = {
      async json(_url: string, options: RequestInit) {
        const { query, variables } = JSON.parse(String(options.body));
        expect(query).toContain("hasDiscussionsEnabled");
        const field = query.includes("issues(first:") ? "issues" : "discussions";
        calls.push(field);
        if (field === "discussions" && variables.after && unavailable) {
          return { errors: [{ message: "temporarily unavailable" }] };
        }
        return { data: { repository: {
          visibility: "PUBLIC", hasDiscussionsEnabled: enabled,
          [field]: { nodes: [], pageInfo: { hasNextPage: field === "discussions" && !variables.after, endCursor: "next" } },
        } } };
      },
    } as Fetcher;
    const github = new GitHub(fetcher, cache, "fixture");
    const load = () => github.repoThreads("example/sample", "2024-11-20", 50);
    await expect(load()).rejects.toThrow("temporarily unavailable");
    expect(calls).toEqual(["issues", "discussions", "discussions"]);
    unavailable = false;
    calls.length = 0;
    expect(await load()).toEqual([]);
    expect(calls).toEqual(["issues", "discussions", "discussions"]);
    calls.length = 0;
    enabled = false;
    expect(await github.repoThreads("example/disabled", "2024-11-20", 50)).toEqual([]);
    expect(calls).toEqual(["issues"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("maintainer replies on later issue and discussion pages affect answer state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-comments-"));
  try {
    const calls: unknown[] = [];
    const fetcher = {
      async json(_url: string, options: RequestInit) {
        const { query, variables } = JSON.parse(String(options.body));
        if (variables.id) {
          calls.push([variables.id, variables.after, query.includes("... on Discussion")]);
          return { data: { node: { repository: { visibility: "PUBLIC" }, comments: { nodes: [{ authorAssociation: "MEMBER" }], pageInfo: { hasNextPage: false } } } } };
        }
        expect(query).toContain("id number");
        expect(query).toContain("pageInfo { hasNextPage endCursor }");
        const field = query.includes("issues(first:") ? "issues" : "discussions";
        return { data: { repository: { visibility: "PUBLIC", hasDiscussionsEnabled: true, [field]: {
          nodes: [{ id: field, number: 1, title: "Video stops", url: "https://example.org/" + field,
            createdAt: "2026-11-18", updatedAt: "2026-11-20", state: "CLOSED", stateReason: field === "issues" ? "COMPLETED" : "RESOLVED", closed: true,
            repository: { nameWithOwner: "example/sample", visibility: "PUBLIC" }, authorAssociation: "NONE",
            comments: { nodes: Array(30).fill({ authorAssociation: "NONE" }), totalCount: 31, pageInfo: { hasNextPage: true, endCursor: "comment-30" } },
          }], pageInfo: { hasNextPage: false },
        } } } };
      },
    } as Fetcher;
    const github = new GitHub(fetcher, new Cache(dir), "fixture");
    const threads = await github.repoThreads("example/sample", "2024-11-20", 50);
    expect(calls).toEqual([["issues", "comment-30", false], ["discussions", "comment-30", true]]);
    expect(threads.map(answeredOf)).toEqual(["answered", "answered"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("redirects check target robots rules and account for each request", async () => {
  const visited: string[] = [];
  const fetcher = new Fetcher({}, 0, async (url, init) => {
    visited.push(url);
    expect(init.redirect).toBe("manual");
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /blocked");
    const destination = url.endsWith("/same") ? "/blocked" : "https://other.example/blocked";
    return new Response(null, { status: 302, headers: { location: destination } });
  });
  await expect(fetcher.request("https://docs.example/same")).rejects.toBeInstanceOf(RobotsBlocked);
  await expect(fetcher.request("https://docs.example/cross")).rejects.toBeInstanceOf(RobotsBlocked);
  expect(visited).toEqual([
    "https://docs.example/robots.txt", "https://docs.example/same", "https://docs.example/cross", "https://other.example/robots.txt",
  ]);
  expect(fetcher.log).toMatchObject({ requests: 4, blocked: ["https://docs.example/blocked", "https://other.example/blocked"] });
});

test("allowed redirects do not carry credentials across origins", async () => {
  const requests: [string, string | null, string | undefined][] = [];
  const fetcher = new Fetcher({}, 0, async (url, init) => {
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    requests.push([url, new Headers(init.headers).get("authorization"), init.method]);
    return url.includes("docs.example") ? new Response(null, { status: 303, headers: { location: "https://other.example/page" } }) : new Response("ok");
  });
  expect(await fetcher.text("https://docs.example/page", { method: "POST", headers: { Authorization: "fixture" } })).toBe("ok");
  expect(requests).toEqual([["https://docs.example/page", "fixture", "POST"], ["https://other.example/page", null, "GET"]]);
});

test("a robots rate limit blocks crawling for the run", async () => {
  const visited: string[] = [];
  const fetcher = new Fetcher({}, 0, async (url) => {
    visited.push(url);
    return new Response(null, { status: 429, headers: { "retry-after": "60" } });
  });
  await expect(fetcher.request("https://docs.example/one")).rejects.toBeInstanceOf(RobotsBlocked);
  await expect(fetcher.request("https://docs.example/two")).rejects.toBeInstanceOf(RobotsBlocked);
  expect(visited).toEqual(["https://docs.example/robots.txt"]);
});

test("rate-limit retries honor long and HTTP-date Retry-After values", async () => {
  const delays: number[] = [];
  const values = ["120", new Date(Date.now() + 60_000).toUTCString(), "0"];
  const fetcher = new Fetcher({}, 0, async (url) => {
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    const next = values.shift();
    return next === undefined ? new Response("ok") : new Response(null, { status: 429, headers: { "retry-after": next } });
  }, async (delay) => { delays.push(delay); });
  expect(await fetcher.text("https://docs.example/page")).toBe("ok");
  expect(delays[0]).toBeGreaterThan(119_000);
  expect(delays[0]).toBeLessThanOrEqual(120_000);
  expect(delays[1]).toBeGreaterThan(58_000);
  expect(delays[1]).toBeLessThanOrEqual(60_000);
  expect(delays[2]).toBe(0);
});

test("GitHub primary limits wait for reset on both REST and GraphQL", async () => {
  const delays: number[] = [];
  const limited = new Set(["/repos/example/sample", "/graphql"]);
  const fetcher = new Fetcher({}, 0, async (url) => {
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return new Response("", { status: 404 });
    if (!limited.delete(path)) return Response.json({ ok: true });
    return Response.json({ errors: [{ type: "RATE_LIMITED" }] }, {
      status: path === "/graphql" ? 200 : 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 120) },
    });
  }, async (delay) => { delays.push(delay); });
  expect(await fetcher.json("https://api.github.com/repos/example/sample")).toEqual({ ok: true });
  expect(await fetcher.json("https://api.github.com/graphql")).toEqual({ ok: true });
  expect(delays).toHaveLength(2);
  for (const delay of delays) expect(delay).toBeGreaterThan(119_000);
});

function guideFetcher(text: (url: string) => Promise<string>): Fetcher {
  return { text, document: async (url: string) => ({ text: await text(url), url }),
    binaryDocument: async (url: string, _init: unknown, _max: unknown, limits?: { chargeWire?: (n: number) => void; chargeDecoded?: (n: number) => void }) => {
      const bytes = new TextEncoder().encode(await text(url));
      limits?.chargeWire?.(bytes.length);
      limits?.chargeDecoded?.(bytes.length);
      return { bytes, url, wireBytes: bytes.length };
    } } as Fetcher;
}

test("guide title budgets only spend on requests and advance past cached or failed pages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-titles-"));
  try {
    const site = SITES[0];
    const pages = Array.from({ length: 62 }, (_, n) => new URL("/guide-" + n, site.sitemap).href);
    const requested: string[] = [];
    const fetcher = guideFetcher(async (url) => {
      if (url === site.sitemap) return "<urlset>" + pages.map((page) => "<url><loc>" + page + "</loc></url>").join("") + "</urlset>";
      if (!pages.includes(url)) throw new Error("no fixture");
      requested.push(url);
      if (url === pages[0]) throw new Error("unavailable");
      return "<title>Guide " + url.split("-").at(-1) + "</title>";
    });
    const cache = new Cache(dir);
    const online = () => discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {});
    const first = await online();
    expect(first.drafts).toHaveLength(59);
    expect(first.stats[0]).toMatchObject({ read: 62, kept: 59, note: "59 page titles available; 1 page titles unavailable; 2 title lookups deferred" });
    const second = await online();
    expect(second.drafts).toHaveLength(61);
    expect(requested).toEqual(pages);
    const offline = new Cache(dir, true);
    const cached = await discoverGuides(fetcher, offline, new GitHub(fetcher, offline, null), index, "2026-11-21", {}, 0);
    expect(cached.drafts).toHaveLength(61);
    expect(requested).toEqual(pages);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a page title can qualify an opaque path on a general docs site", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-title-filter-"));
  try {
    const site = SITES.find((source) => source.name === "OBS knowledge base")!;
    const page = new URL("/kb/scene-setup", site.index).href;
    const fetcher = guideFetcher(async (url) => {
      if (url === site.index) return '<a href="/kb/scene-setup">Read</a>';
      if (url === page) return "<title>Set up a bonded stream</title>";
      throw new Error("no fixture");
    });
    const cache = new Cache(dir);
    const run = await discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {});
    expect(run.drafts.map((draft) => draft.url)).toEqual([page]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guide source totals include entries examined before wiki and feed filters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-source-counts-"));
  try {
    const wiki = WIKIS.find((source) => "include" in source)!;
    const base = "https://github.com/" + wiki.repo + "/wiki";
    const feed = GUIDE_FEEDS[0];
    const online = new Cache(dir);
    online.set("wiki-tree:" + wiki.repo, [{ url: base + "/Open-Live-setup", title: "Open Live setup" }, { url: base + "/Other-project", title: "Other project" }]);
    online.set("rss:" + feed.url, [
      { url: "https://forum.example.org/one", title: "Set up a bonded stream", lastmod: null },
      { url: "https://forum.example.org/two", title: "Generic setup", lastmod: null },
    ]);
    const cache = new Cache(dir, true);
    const fetcher = new Fetcher({}, 0, async () => { throw new Error("offline fetched"); });
    const run = await discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {});
    expect(run.stats.find((stat) => stat.source === "GitHub wiki " + wiki.repo)).toMatchObject({ read: 2, kept: 1 });
    expect(run.stats.find((stat) => stat.source === feed.name)).toMatchObject({ read: 2, kept: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sitemap indexes follow more than twenty members and skip cycles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-index-"));
  try {
    const site = SITES[0], root = site.sitemap!;
    const visited: string[] = [];
    const members = Array.from({ length: 22 }, (_, n) => new URL("/member-" + n + ".xml", root).href);
    const fetcher = guideFetcher(async (url) => {
      if (url === root) {
        return "<sitemapindex>" + [...members, members[0]].map((m) => "<sitemap><loc>" + m + "</loc></sitemap>").join("") + "</sitemapindex>";
      }
      if (!members.includes(url)) throw new Error("no fixture");
      visited.push(url);
      if (url === members[0]) return "<sitemapindex><sitemap><loc>" + root + "</loc></sitemap></sitemapindex>";
      return "<urlset><url><loc>" + url.replace(".xml", "/guide") + "</loc></url></urlset>";
    });
    const cache = new Cache(dir);
    const run = await discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {}, 0);
    expect(visited).toEqual(members);
    expect(run.stats[0]).toMatchObject({ read: 21, note: "21 title lookups deferred" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sitemap discovery reads gzipped XML alongside already decoded XML", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-gzip-"));
  try {
    const root = SITES[0].sitemap!;
    const urlset = (name: string) => "<urlset><url><loc>/" + name + "</loc></url></urlset>";
    const text = "<sitemapindex><sitemap><loc>/compressed.xml.gz</loc></sitemap><sitemap><loc>/plain.xml.gz</loc></sitemap></sitemapindex>";
    const fetcher = new Fetcher({}, 0, async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url === root) return new Response(text);
      if (url.endsWith("/compressed.xml.gz")) return new Response(Bun.gzipSync(urlset("compressed")));
      if (url.endsWith("/plain.xml.gz")) return new Response(urlset("plain"));
      return new Response("", { status: 404 });
    });
    const cache = new Cache(dir);
    const run = await discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {}, 0);
    expect(run.stats[0]).toMatchObject({ read: 2, note: "2 title lookups deferred" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wiki discovery reads the public Git tree through robots-aware HTTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-wiki-fixture-"));
  const caller = mkdtempSync(join(tmpdir(), "discovery-wiki-caller-"));
  const inherited = { ...process.env };
  try {
    wikiGit(caller, ["init", "--bare", "--quiet", "--template=", "--object-format=sha1"]);
    const callerHead = "1".repeat(40);
    writeFileSync(join(caller, "refs", "heads", "caller"), callerHead + "\n");
    const snapshot = () => [
      readFileSync(join(caller, "HEAD"), "utf8"),
      readFileSync(join(caller, "config"), "utf8"),
      readFileSync(join(caller, "refs", "heads", "caller"), "utf8"),
      readdirSync(join(caller, "objects"), { recursive: true }).sort(),
    ];
    const original = snapshot();
    process.env.GIT_DIR = caller;
    process.env.GIT_OBJECT_DIRECTORY = join(caller, "objects");
    process.env.GIT_DEFAULT_HASH = "sha256";
    const git = (args: string[], stdin?: string) => wikiGit(dir, args, stdin === undefined ? undefined : Buffer.from(stdin));
    git(["init", "--bare", "--quiet", "--template=", "--object-format=sha1"]);
    const blob = git(["hash-object", "-w", "--stdin"], "Fixture").toString().trim();
    const tree = git(["mktree"], ["Home.md", "Stream setup.md", "Getting-started.rest", "Setup.rst.txt", "Advanced.mdx", "Routing.mdwn", "Video.litcoffee", "_Sidebar.md", "setup.png"]
      .map((file) => "100644 blob " + blob + "\t" + file + "\n").join("")).toString().trim();
    const author = "Example <fixture@example.org> 1700000000 +0000";
    const head = git(["hash-object", "-t", "commit", "-w", "--stdin"],
      "tree " + tree + "\nauthor " + author + "\ncommitter " + author + "\n\nWiki fixture\n").toString().trim();
    git(["update-ref", "HEAD", head]);
    git(["config", "uploadpack.allowFilter", "true"]);
    const visits: string[] = [];
    const fetcher = new Fetcher({}, 0, async (url, options) => {
      visits.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /example/sample/wiki/_pages");
      if (url.endsWith("/info/refs?service=git-upload-pack")) {
        const refs = git(["upload-pack", "--stateless-rpc", "--advertise-refs", "."]);
        return new Response(Buffer.concat([Buffer.from("001e# service=git-upload-pack\n0000"), refs]));
      }
      if (url.endsWith("/git-upload-pack") && options.method === "POST") {
        expect(options.body).toContain("filter blob:none");
        return new Response(git(["upload-pack", "--stateless-rpc", "."], String(options.body)));
      }
      throw new Error("unexpected request");
    });
    expect(await listWikiPages(fetcher, "example/sample")).toEqual([
      { url: "https://github.com/example/sample/wiki/Advanced", lastmod: null, title: "Advanced" },
      { url: "https://github.com/example/sample/wiki/Getting-started", lastmod: null, title: "Getting started" },
      { url: "https://github.com/example/sample/wiki/Home", lastmod: null, title: "Home" },
      { url: "https://github.com/example/sample/wiki/Routing", lastmod: null, title: "Routing" },
      { url: "https://github.com/example/sample/wiki/Setup", lastmod: null, title: "Setup" },
      { url: "https://github.com/example/sample/wiki/Stream-setup", lastmod: null, title: "Stream setup" },
      { url: "https://github.com/example/sample/wiki/Video", lastmod: null, title: "Video" },
    ]);
    expect(visits).toEqual([
      "https://github.com/robots.txt",
      "https://github.com/example/sample.wiki.git/info/refs?service=git-upload-pack",
      "https://github.com/example/sample.wiki.git/git-upload-pack",
    ]);
    expect(snapshot()).toEqual(original);
  } finally {
    for (const name of ["GIT_DIR", "GIT_OBJECT_DIRECTORY", "GIT_DEFAULT_HASH"]) {
      if (inherited[name] === undefined) delete process.env[name];
      else process.env[name] = inherited[name];
    }
    rmSync(caller, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("offline guides can replay legacy sitemap and wiki listings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-legacy-guides-"));
  try {
    const site = SITES[0], wiki = WIKIS[0];
    const page = new URL("/guides/start", site.sitemap).href;
    const wikiPage = "https://github.com/" + wiki.repo + "/wiki/Stream-setup";
    const online = new Cache(dir);
    online.set("sitemap:" + site.sitemap, [{ url: page, lastmod: null }]);
    online.set(guideTitleKey(page), { title: "Configure video", language: "en", origin: new URL(page).origin });
    online.set("wiki:" + wiki.repo, [{ url: wikiPage, lastmod: null }]);
    const offline = new Cache(dir, true);
    const fetcher = new Fetcher({}, 0, async () => { throw new Error("offline fetched"); });
    const run = await discoverGuides(fetcher, offline, new GitHub(fetcher, offline, null), index, "2026-11-20", {});
    expect(run.drafts.map((draft) => draft.url)).toEqual([page, wikiPage]);
    expect(run.stats[0].note).toContain("older sitemap cache");
    expect(run.stats.find((stat) => stat.source === "GitHub wiki " + wiki.repo)?.note).toContain("older wiki index cache");
    expect(fetcher.log.requests).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("authenticated GitHub discovery filters private repositories before caching", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-visibility-"));
  try {
    const cache = new Cache(dir);
    const since = "2024-11-20";
    cache.set("threads-v2:gh-search:sample:" + since + ":5", [thread({ title: "Legacy visibility unknown" })]);
    const replies = { pageInfo: { hasNextPage: false }, nodes: [] };
    const calls: string[] = [];
    const fetcher = { async json(_url: string, options: RequestInit) {
      const { query, variables } = JSON.parse(String(options.body));
      expect(query).toContain("visibility");
      if (!variables.q) return { data: { repository: { visibility: "PRIVATE" } } };
      expect(variables.q).toContain("is:public");
      calls.push(query);
      const node = { url: "https://github.com/example/sample/issues/1", title: "Public example", createdAt: "2026-11-20",
        updatedAt: "2026-11-20", state: "OPEN", repository: { nameWithOwner: "example/sample", visibility: "PUBLIC" } };
      return { data: { search: { ...replies, nodes: [node, { ...node, repository: { visibility: "PRIVATE" } }, { ...node, repository: {} }] } } };
    } } as Fetcher;
    const offline = new GitHub(fetcher, new Cache(dir, true), null);
    await expect(offline.search("sample", since, 5)).rejects.toBeInstanceOf(OfflineMiss);
    const online = new GitHub(fetcher, cache, "fixture");
    await expect(online.repoThreads("example/sample", since, 5)).rejects.toThrow("visibility is not public");
    expect(await online.search("sample", since, 5)).toHaveLength(2);
    expect((await offline.search("sample", since, 5)).map((row) => row.title)).toEqual(["Public example", "Public example"]);
    expect(calls).toHaveLength(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("external output aliases work but internal descendant destinations are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-output-links-"));
  try {
    const checkout = join(dir, "checkout"), out = join(dir, "out"), alias = join(dir, "alias");
    mkdirSync(checkout);
    mkdirSync(out);
    symlinkSync(out, alias);
    expect(prepareOutput(alias, checkout)).toBe(out);
    for (const name of ["cache", "state", "questions.json", "guides.md"]) {
      const link = join(out, name);
      symlinkSync(checkout, link);
      expect(() => prepareOutput(alias, checkout)).toThrow("outside the repository");
      rmSync(link);
    }
    const cache = new Cache(join(out, "cache"));
    const target = join(checkout, "keep.json");
    writeFileSync(target, "unchanged");
    const key = "fixture";
    const shard = new Bun.CryptoHasher("sha1").update(key).digest("hex") + ".json";
    symlinkSync(target, join(cache.dir, shard));
    cache.set(key, { checked: true });
    expect(readFileSync(target, "utf8")).toBe("unchanged");
    expect(cache.get(key, 1)).toEqual({ checked: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sitemap traversal checkpoints its document budget and caps depth and expansion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-budget-"));
  try {
    const root = "https://docs.example.org/root";
    const visited: string[] = [];
    const fetcher = guideFetcher(async (url) => {
      visited.push(url);
      const links = url === root ? ["/one", "/two"] : ["/too-deep"];
      return "<sitemapindex>" + links.map((link) => "<sitemap><loc>" + link + "</loc></sitemap>").join("") + "</sitemapindex>";
    });
    const cache = new Cache(dir);
    const limits = { documents: 2, depth: 1, members: 10, pages: 10, wire: 1024, decoded: 1024, ratio: 100 };
    expect((await readSitemap(fetcher, cache, root, limits)).note).toContain("1 sitemap members deferred");
    expect((await readSitemap(fetcher, cache, root, limits)).note).toContain("2 sitemap entries omitted");
    expect(visited).toEqual([root, "https://docs.example.org/one", "https://docs.example.org/two"]);
    await expect(sitemapXml(Bun.gzipSync("x".repeat(30_000)), 1024, 10)).rejects.toThrow("exceeds");
    const oversized = new Fetcher({}, 0, async (url) => new Response(url.endsWith("/robots.txt") ? "" : "x".repeat(2048)));
    await expect(oversized.bytes(root, {}, 1024)).rejects.toThrow("exceeds");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed retry hints use backoff and long waits defer the source", async () => {
  const waits: number[] = [];
  const headers = ["1.5", "86400"];
  const fetcher = new Fetcher({}, 0, async (url) => url.endsWith("/robots.txt")
    ? new Response("") : new Response(null, { status: 429, headers: { "retry-after": headers.shift()! } }),
    async (ms) => { waits.push(ms); });
  await expect(fetcher.text("https://example.org/resource")).rejects.toThrow("retry deferred until");
  await expect(fetcher.text("https://example.org/another")).rejects.toThrow("retry deferred until");
  expect(fetcher.log.failures).toHaveLength(1);
  expect(fetcher.log.failures[0]).toMatch(/retry deferred until \d{4}-\d{2}-\d{2}T.* for example\.org/);
  expect(waits).toHaveLength(1);
  expect(waits[0]).toBeGreaterThan(4900);
});

test("redirects, exhausted retries and rate-limited robots retain cooldowns", async () => {
  const trace: (string | number)[] = [];
  const fetcher = new Fetcher({}, 0, async (url) => {
    trace.push(new URL(url).pathname);
    if (url.startsWith("https://limited.example")) return new Response("", { status: 403, headers: { "retry-after": "300" } });
    if (url.endsWith("/start")) return new Response(null, { status: 302, headers: { location: "/next", "retry-after": "2" } });
    if (url.endsWith("/limited")) return new Response(null, { status: 429, headers: { "retry-after": "1" } });
    return new Response("ok");
  }, async (ms) => { trace.push(Math.ceil(ms / 1000)); });
  await expect(fetcher.text("https://example.org/start")).resolves.toBe("ok");
  await expect(fetcher.text("https://example.org/limited")).rejects.toThrow("429");
  await expect(fetcher.text("https://example.org/following")).resolves.toBe("ok");
  await expect(fetcher.text("https://limited.example/blocked")).rejects.toBeInstanceOf(RobotsBlocked);
  expect(trace).toEqual(["/robots.txt", "/start", 2, "/next", "/limited", 1, "/limited", 1, "/limited", 1, "/limited", 1, "/following", "/robots.txt"]);
});

test("the first page after robots honors the newly learned crawl delay", async () => {
  const sleeps: number[] = [];
  const fetcher = new Fetcher({}, 1500, async (url) => {
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nCrawl-delay: 10");
    if (url.endsWith("/start")) return new Response(null, { status: 302, headers: { location: "https://next.example/page" } });
    return new Response("ok");
  }, async (ms) => { sleeps.push(ms); });
  expect(await fetcher.text("https://example.org/start")).toBe("ok");
  expect(sleeps).toHaveLength(2);
  for (const ms of sleeps) expect(ms).toBeGreaterThan(9900);
});

test("sitemap pages and member redirects cannot leave configured origins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-origin-"));
  try {
    const root = "https://docs.example.org/root";
    const visited: string[] = [];
    const fetcher = new Fetcher({}, 0, async (url) => {
      visited.push(url);
      if (url.endsWith("/robots.txt")) return new Response("");
      if (url.endsWith("/redirect")) return new Response(null, { status: 302, headers: { location: "https://other.example/forged" } });
      return new Response(url === root
        ? '<sitemapindex><sitemap><loc>https://other.example/wrong.xml</loc></sitemap><sitemap><loc>/child</loc></sitemap></sitemapindex>'
        : '<urlset><url><loc>https://other.example/wrong</loc></url><url><loc>/valid</loc></url></urlset>');
    });
    const result = await readSitemap(fetcher, new Cache(dir), root);
    expect(result.pages.map((page) => page.url)).toEqual(["https://docs.example.org/valid"]);
    expect(result.note).toContain("2 off-origin");
    await expect(fetcher.bytes("https://docs.example.org/redirect", { allowedOrigins: [new URL(root).origin] })).rejects.toThrow("outside configured source");
    expect(visited.every((url) => new URL(url).origin === new URL(root).origin)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bad sitemap locations and unavailable members preserve good pages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-partial-"));
  try {
    let broken = true;
    const root = "https://docs.example.org/root";
    const fetcher = guideFetcher(async (url) => {
      if (url === root) return "<sitemapindex><sitemap><loc>/good</loc></sitemap><sitemap><loc>/later</loc></sitemap></sitemapindex>";
      if (url.endsWith("/later") && broken) throw new Error("unavailable");
      return url.endsWith("/good")
        ? "<urlset><url><loc>/valid</loc></url><url><loc>/bad%</loc></url></urlset>"
        : "<urlset><url><loc>/recovered</loc></url></urlset>";
    });
    const cache = new Cache(dir);
    const first = await readSitemap(fetcher, cache, root);
    expect(first.pages.map((page) => page.url)).toEqual(["https://docs.example.org/valid"]);
    expect(first.note).toContain("1 sitemap members unavailable");
    expect(first.note).toContain("1 malformed sitemap locations");
    broken = false;
    const second = await readSitemap(fetcher, cache, root);
    expect(second.pages.map((page) => page.url)).toEqual(["https://docs.example.org/valid", "https://docs.example.org/recovered"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repeated sitemap locations share one title lookup and retain the latest date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-duplicates-"));
  try {
    const root = SITES[0].sitemap!;
    const requested: string[] = [];
    const fetcher = guideFetcher(async (url) => {
      if (url === root) return "<urlset>" + "<url><loc>/one</loc><lastmod>2026-01-01</lastmod></url>".repeat(59)
        + "<url><loc>/one</loc><lastmod>2026-11-01</lastmod></url><url><loc>/two</loc></url></urlset>";
      if (new URL(url).origin !== new URL(root).origin) throw new Error("no fixture");
      requested.push(url);
      return "<title>Guide</title>";
    });
    const cache = new Cache(dir);
    const run = await discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {}, 2);
    expect(requested).toEqual([new URL("/one", root).href, new URL("/two", root).href]);
    expect(run.stats[0]).toMatchObject({ read: 61, kept: 2 });
    expect(run.drafts[0].review.lastmod).toBe("2026-11-01");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed refresh keeps the last successful title for online and offline runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-stale-title-"));
  const now = Date.now;
  try {
    const root = SITES[0].sitemap!, page = new URL("/fixture", root).href;
    Date.now = () => now() - 8 * 86400_000;
    const cache = new Cache(dir);
    cache.set(guideTitleKey(page), { title: "Known guide", language: "en", origin: new URL(page).origin });
    Date.now = now;
    const fetcher = guideFetcher(async (url) => {
      if (url === root) return "<urlset><url><loc>/fixture</loc></url></urlset>";
      throw new Error("unavailable");
    });
    const run = (store: Cache) => discoverGuides(fetcher, store, new GitHub(fetcher, store, null), index, "2026-11-20", {});
    expect((await run(cache)).stats[0].note).toContain("1 stale page titles reused");
    expect((await run(new Cache(dir, true))).drafts[0].title).toBe("Known guide");
  } finally {
    Date.now = now;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only a usable online question window advances the offline default", () => {
  const out = mkdtempSync(join(tmpdir(), "discovery-window-"));
  try {
    mkdirSync(join(out, "state"));
    const failed = [{ source: "GitHub example/sample", read: 0, kept: 0, note: "failed: unavailable" }];
    expect(saveQuestionWindow(out, "2024-11-19", false, failed)).toBeUndefined();
    expect(saveQuestionWindow(out, "2024-11-20", false, [{ source: "GitHub example/sample", read: 0, kept: 0 }])).toBe("2024-11-20");
    expect(saveQuestionWindow(out, "2024-11-21", false, failed)).toBe("2024-11-20");
    expect(questionsSince(out, "2026-11-22", undefined, true)).toBe("2024-11-20");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("feed roots, Atom namespaces and text types preserve usable siblings", () => {
  const rss = '<rss><channel><item><title>Example</title><description><![CDATA[Example <feed>]]></description></item></channel></rss>';
  expect(parseFeed(rss, "https://example.org/feed")).toHaveLength(1);
  const atom = '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:link href="https://["/></a:entry>'
    + '<a:entry><a:title type="html">&lt;b&gt;Bonded video&lt;/b&gt;</a:title><a:link href="/entry"/>'
    + '<a:summary>Literal &lt;command&gt;</a:summary></a:entry>'
    + '<a:entry><a:title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><b>Another guide</b></div></a:title><a:link href="/second"/></a:entry></a:feed>';
  const [first, second] = parseFeed(atom, "https://example.org/feed");
  expect(first).toMatchObject({ title: "Bonded video", link: "https://example.org/entry", text: "Literal <command>" });
  expect(second.title).toBe("Another guide");
});

test("nested discussion replies paginate until a maintainer is found", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-reply-pages-"));
  try {
    const cursors: (string | null)[] = [];
    const fetcher = { async json(_url: string, options: RequestInit) {
      const { query, variables } = JSON.parse(String(options.body));
      if (variables.id) {
        expect(query).toContain("... on DiscussionComment");
        expect(query).toContain("discussion { repository { visibility } }");
        expect(variables.id).toBe("parent");
        cursors.push(variables.after);
        return { data: { node: { discussion: { repository: { visibility: "PUBLIC" } }, replies: {
          nodes: [{ authorAssociation: variables.after === "after-users" ? "MEMBER" : "NONE" }],
          pageInfo: { hasNextPage: variables.after !== "after-users", endCursor: "after-users" },
        } } } };
      }
      const visibility = "PUBLIC", hasDiscussionsEnabled = true;
      const pageInfo = { hasNextPage: false };
      if (query.includes("issues(first:")) return { data: { repository: { visibility, hasDiscussionsEnabled, issues: { pageInfo, nodes: [] } } } };
      expect(query).toContain("nodes { id authorAssociation replies(first: 1) { pageInfo { hasNextPage endCursor } nodes { authorAssociation } } }");
      return { data: { repository: { visibility, hasDiscussionsEnabled, discussions: { pageInfo, nodes: [{
        id: "thread", number: 1, title: "Video stops", url: "https://github.com/example/sample/discussions/1",
        createdAt: "2026-11-18", updatedAt: "2026-11-20", repository: { nameWithOwner: "example/sample", visibility },
        comments: { totalCount: 1, pageInfo, nodes: [{ id: "parent", authorAssociation: "NONE", replies: { nodes: [{ authorAssociation: "NONE" }], pageInfo: { hasNextPage: true, endCursor: "first-reply" } } }] },
      }] } } } };
    } } as Fetcher;
    const github = new GitHub(fetcher, new Cache(dir), "fixture");
    const [discussion] = await github.repoThreads("example/sample", "2024-11-20", 5);
    expect(answeredOf(discussion)).toBe("maintainer-replied");
    expect(cursors).toEqual(["first-reply", "after-users"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-resolving discussion closures cannot imply a public solution", () => {
  const node = {
    number: 7, title: "Bug: video stops", url: "https://github.com/example/sample/discussions/7",
    createdAt: "2026-11-19", updatedAt: "2026-11-20", closed: true,
    repository: { nameWithOwner: "example/sample" }, comments: { totalCount: 1, nodes: [{ authorAssociation: "MEMBER" }] },
  };
  for (const [stateReason, closedAs] of [["OUTDATED", "outdated"], ["DUPLICATE", "duplicate"], [null, "unknown"]]) {
    const classified = sortThread(fromDiscussion({ ...node, stateReason }, "github"), index);
    expect(classified.closedAs).toBe(closedAs);
    expect(classified.answered).toBe("maintainer-replied");
    expect(isResolvedProblem(classified)).toBe(false);
  }
  expect(answeredOf(fromDiscussion({ ...node, stateReason: "RESOLVED" }, "github"))).toBe("answered");
  expect(answeredOf(fromDiscussion({ ...node, stateReason: "DUPLICATE", isAnswered: true }, "github"))).toBe("answered");
});

test("support and engineering titles keep their distinct intent", () => {
  const kind = (title: string) => kindOf(thread({ title })).kind;
  expect(kind("Support for HEVC on Android?")).toBe("question");
  expect(kind("Support for HEVC on Android")).toBe("feature");
  expect(kind("How can we refactor the CI unit tests?")).toBe("dev");
  expect(kind("Add unit tests for reconnects")).toBe("dev");
  expect(kind("Dropped frames with `ffmpeg -vf scale=1920:1080`")).toBe("problem");
  expect(kind("How do I run `srtla_rec`?")).toBe("question");
});

test("wiki fallback packs are bounded and both endpoints honor robots", async () => {
  const packet = (value: string) => (value.length + 4).toString(16).padStart(4, "0") + value;
  const refs = packet("# service=git-upload-pack\n") + "0000" + packet("1".repeat(40) + " HEAD\0shallow\n") + "0000";
  for (const disallow of ["/info/refs", "/git-upload-pack", ""]) {
    const visited: string[] = [];
    let cancelled = false;
    const fetcher = new Fetcher({}, 0, async (url, init) => {
      visited.push(new URL(url).pathname);
      if (url.endsWith("/robots.txt")) return new Response(disallow ? "User-agent: *\nDisallow: /*" + disallow : "");
      if (url.includes("/info/refs")) return new Response(refs);
      expect(init.body).not.toContain("filter blob:none");
      return new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(1024 ** 2)); },
        cancel() { cancelled = true; },
      }));
    });
    await expect(listWikiPages(fetcher, "example/sample")).rejects.toThrow(disallow ? "disallows" : "response exceeds");
    expect(visited).toHaveLength(disallow === "/info/refs" ? 1 : disallow ? 2 : 3);
    if (!disallow) expect(cancelled).toBe(true);
  }
});

test.skipIf(process.platform !== "linux")("discovery CLI runs from a checkout path containing spaces", () => {
  const fixture = mkdtempSync(join(tmpdir(), "discovery-path-"));
  try {
    const repo = join(fixture, "path with space");
    mkdirSync(join(repo, "scripts"), { recursive: true });
    for (const path of ["scripts/discovery", "scripts/lib", "data"]) cpSync(join(REPO_ROOT, path), join(repo, path), { recursive: true });
    const out = join(fixture, "output");
    const result = Bun.spawnSync([process.execPath, "scripts/discovery/main.ts", "guides", "--offline", "--out", out], { cwd: repo });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(out, "guide-candidates.json"), "utf8")).candidates).toEqual([]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("redirected indexes, sitemaps and Atom feeds use the final document base", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-bases-"));
  try {
    const site = SITES.find((source) => source.name === "OBS knowledge base")!;
    const root = SITES[0].sitemap!, feed = GUIDE_FEEDS[0];
    const fetcher = new Fetcher({}, 0, async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("");
      const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
      if (url === site.index) return redirect("/kb/");
      if (url === site.index + "/") return new Response('<a href="audio-setup">Read</a>');
      if (url.endsWith("/kb/audio-setup")) return new Response("<title>Set up a bonded stream</title>");
      if (url === root) return redirect("/maps/index.xml");
      if (url.endsWith("/maps/index.xml")) return new Response("<sitemapindex><sitemap><loc>child.xml</loc></sitemap></sitemapindex>");
      if (url.endsWith("/maps/child.xml")) return new Response("<urlset><url><loc>guide</loc></url></urlset>");
      if (url.endsWith("/maps/guide")) return new Response("<title>Configure video</title>");
      if (url === feed.url) return redirect("/boards/atom");
      if (url.endsWith("/boards/atom")) return new Response('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Set up a bonded stream</title><link href="post"/></entry></feed>');
      return new Response("", { status: 404 });
    });
    const cache = new Cache(dir);
    const run = await discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {});
    expect(run.drafts.map((draft) => draft.url)).toEqual([
      new URL("/maps/guide", root).href, site.index + "/audio-setup", new URL("/boards/post", feed.url).href,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy first-seen dates migrate only when the original URL is unambiguous", () => {
  const upper = "https://example.org/Guide-Start", lower = upper.toLowerCase();
  const candidate = (url: string, date: string) => draftFor({ url, lastmod: null, title: "Guide" }, [], null, "Example", index, date);
  const seen = { [lower]: "2025-01-01" };
  expect(migrateGuideSeen(seen, [candidate(upper, "2025-01-01")])).toEqual({ [upper]: "2025-01-01" });
  expect(migrateGuideSeen(seen, [candidate(upper, "2025-01-01"), candidate(lower, "2025-01-01")])).toEqual(seen);
  expect(migrateGuideSeen(seen, [candidate(upper, "2026-01-01")])).toEqual(seen);
});

test("YouTube watch forms identify a video independent of playlist context", () => {
  const same = [
    "https://youtu.be/AbC123?list=PL1",
    "https://m.youtube.com/watch?list=PL1&v=AbC123",
    "https://www.youtube.com/watch?v=AbC123&list=PL2",
  ].map(normalizeUrl);
  expect(new Set(same)).toEqual(new Set(["https://youtube.com/watch?v=AbC123"]));
  expect(normalizeUrl("https://m.youtube.com/playlist?feature=share&list=PL1")).toBe("https://youtube.com/playlist?list=PL1");
  expect(normalizeUrl("https://youtube.com/watch?v=abc123")).not.toBe(same[0]);
});

test("online guide feeds refresh old parser results and offline replay labels them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-feed-version-"));
  try {
    const feed = GUIDE_FEEDS[0], title = "Set up a bonded stream";
    const cache = new Cache(dir);
    cache.set("rss:" + feed.url, []);
    const fetcher = guideFetcher(async (url) => {
      if (url !== feed.url) throw new Error("no fixture");
      return '<feed><entry><title>' + title + '</title><link href="https://example.org/guide"/></entry></feed>';
    });
    const run = (store: Cache) => discoverGuides(fetcher, store, new GitHub(fetcher, store, null), index, "2026-11-20", {});
    expect((await run(new Cache(dir, true))).stats.find((row) => row.source === feed.name)?.note).toBe("older guide-feed cache");
    expect((await run(cache)).drafts.map((draft) => draft.title)).toEqual([title]);
    expect((await run(new Cache(dir, true))).drafts.map((draft) => draft.title)).toEqual([title]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("private or unverified GitHub docs never produce cached drafts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-docs-visibility-"));
  try {
    const folder = DOC_FOLDERS[0], api = "/repos/" + folder.repo;
    const cache = new Cache(dir);
    cache.set("docs-tree:" + folder.repo, { branch: "main", paths: ["docs/HELP.md"] });
    let isPublic = false;
    const fetcher = new Fetcher({}, 0, async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/robots.txt") return new Response("");
      if (path === api) {
        expect(new Headers(init.headers).get("authorization")).toBeNull();
        return Response.json({ private: !isPublic, visibility: isPublic ? "public" : "private", default_branch: "main" });
      }
      if (path === api + "/git/trees/main") {
        expect(isPublic).toBe(true);
        return Response.json({ tree: [{ path: "docs/HELP.md", type: "blob" }] });
      }
      return new Response("", { status: 404 });
    });
    const run = (store: Cache) => discoverGuides(fetcher, store, new GitHub(fetcher, store, "fixture"), index, "2026-11-20", {});
    expect((await run(new Cache(dir, true))).drafts).toEqual([]);
    expect((await run(cache)).drafts).toEqual([]);
    isPublic = true;
    expect((await run(cache)).drafts.map((draft) => draft.url)).toEqual(["https://github.com/" + folder.repo + "/blob/main/docs/HELP.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("offline guides label an older HTML index listing without fetching", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-index-legacy-"));
  try {
    const site = SITES.find((source) => source.name === "OBS knowledge base")!;
    const page = new URL("/kb/fixture", site.index).href;
    const online = new Cache(dir);
    online.set("index:" + site.index, [{ url: page, lastmod: null }]);
    online.set(guideTitleKey(page), { title: "Set up a bonded stream", language: null, origin: new URL(page).origin });
    const cache = new Cache(dir, true), fetcher = new Fetcher({}, 0, async () => { throw new Error("offline fetched"); });
    const run = await discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {});
    expect(run.drafts.map((draft) => draft.url)).toEqual([page]);
    expect(run.stats.find((row) => row.source === site.name)?.note).toContain("older HTML index cache");
    expect(fetcher.log.requests).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expired titles rotate by the oldest attempt across runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-title-rotation-"));
  const now = Date.now;
  try {
    const root = SITES[0].sitemap!, first = new URL("/first", root).href, second = new URL("/second", root).href;
    const request: string[] = [];
    const fetcher = guideFetcher(async (url) => {
      if (url === root) return "<urlset><url><loc>/first</loc></url><url><loc>/second</loc></url></urlset>";
      if (url !== first && url !== second) throw new Error("no fixture");
      request.push(url);
      return "<title>Refreshed</title>";
    });
    const cache = new Cache(dir);
    Date.now = () => now() - 8 * 86400_000;
    cache.set(guideTitleKey(first), { title: "Newer", language: "en", origin: new URL(first).origin });
    Date.now = () => now() - 9 * 86400_000;
    cache.set(guideTitleKey(second), { title: "Older", language: "en", origin: new URL(second).origin });
    Date.now = now;
    const run = () => discoverGuides(fetcher, cache, new GitHub(fetcher, cache, null), index, "2026-11-20", {}, 1);
    await run();
    expect(request).toEqual([second]);
    await run();
    expect(request).toEqual([second, first]);
  } finally {
    Date.now = now;
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux")("replacing an output parent during discovery never redirects writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-pinned-"));
  try {
    const repo = join(dir, "repo"), out = join(dir, "out"), moved = join(dir, "moved");
    mkdirSync(repo);
    await withOutputDirectories(out, repo, async (root, cache, state) => {
      renameSync(out, moved);
      symlinkSync(repo, out);
      renameSync(join(moved, "cache"), join(moved, "old-cache"));
      symlinkSync(repo, join(moved, "cache"));
      writeLocalFile(join(root, "report"), "ok");
      writeLocalFile(join(cache, "batch"), "ok");
      writeLocalFile(join(state, "state"), "ok");
    });
    expect(readdirSync(repo)).toEqual([]);
    expect(readFileSync(join(moved, "report"), "utf8")).toBe("ok");
    expect(readFileSync(join(moved, "old-cache", "batch"), "utf8")).toBe("ok");
    expect(readFileSync(join(moved, "state", "state"), "utf8")).toBe("ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interrupted sitemap transfers charge the aggregate wire budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-interrupted-body-"));
  try {
    const root = "https://docs.example.org/root";
    let members = 0;
    const fetcher = new Fetcher({}, 0, async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("");
      if (url === root) return new Response("<sitemapindex>" + Array.from({ length: 6 }, (_, n) => "<sitemap><loc>/m" + n + "</loc></sitemap>").join("") + "</sitemapindex>");
      members++;
      let first = true;
      return new Response(new ReadableStream({
        pull(controller) {
          if (first) { first = false; controller.enqueue(new Uint8Array(1000)); }
          else controller.error(new Error("interrupted"));
        },
      }));
    });
    await readSitemap(fetcher, new Cache(dir), root, { documents: 20, depth: 2, members: 20, pages: 20, wire: 1024, decoded: 2048, ratio: 150 });
    expect(members).toBe(4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sitemap limits apply to gzip delivered as HTTP content encoding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-http-gzip-"));
  try {
    const visits: boolean[] = [];
    const xml = "<urlset>" + "<url><loc>/sample</loc></url>".repeat(40) + "</urlset>";
    const fetcher = new Fetcher({}, 0, async (url, init) => {
      if (url.endsWith("/robots.txt")) return new Response("");
      visits.push(init.decompress === false);
      return new Response(Bun.gzipSync(xml), { headers: { "content-encoding": "gzip" } });
    });
    const limits = { documents: 2, depth: 2, members: 5, pages: 100, wire: 1024, decoded: 2048, ratio: 2 };
    const root = "https://docs.example.org/root";
    const cache = new Cache(dir);
    expect((await readSitemap(fetcher, cache, root, limits)).pages).toEqual([]);
    expect((await readSitemap(fetcher, cache, root, { ...limits, ratio: 150 })).pages).toHaveLength(40);
    expect(visits).toEqual([true, true]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stuck sitemap checkpoints rediscover membership and failed root refreshes retain offline pages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-lifecycle-"));
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 20);
  Date.now = () => now;
  try {
    const root = "https://docs.example.org/root", cache = new Cache(dir);
    let revision = 0;
    const fetcher = guideFetcher(async (url) => {
      if (url.endsWith("/retired") || (url === root && revision === 2)) throw new Error("unavailable");
      if (url === root) return revision === 0
        ? "<sitemapindex><sitemap><loc>/live</loc></sitemap><sitemap><loc>/retired</loc></sitemap></sitemapindex>"
        : revision === 1 ? "<urlset><url><loc>/new</loc></url></urlset>" : "<urlset/>";
      return "<urlset><url><loc>/old</loc></url></urlset>";
    });
    const urls = (result: Awaited<ReturnType<typeof readSitemap>>) => result.pages.map((page) => new URL(page.url).pathname);
    expect(urls(await readSitemap(fetcher, cache, root))).toEqual(["/old"]);
    revision = 1;
    now += 86400_000;
    expect(urls(await readSitemap(fetcher, cache, root))).toEqual(["/new"]);
    revision = 2;
    now += 86400_000;
    const stale = await readSitemap(fetcher, cache, root);
    expect(urls(stale)).toEqual(["/new"]);
    expect(stale.note).toContain("stale sitemap listing");
    expect(urls(await readSitemap(fetcher, new Cache(dir, true), root))).toEqual(["/new"]);
    revision = 3;
    expect(urls(await readSitemap(fetcher, cache, root))).toEqual([]);
    expect(urls(await readSitemap(fetcher, new Cache(dir, true), root))).toEqual([]);
  } finally {
    Date.now = realNow;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a confirmed visibility withdrawal invalidates older repo and search snapshots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-visibility-withdrawal-"));
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 20);
  Date.now = () => now;
  try {
    const cache = new Cache(dir), since = "2024-11-20", repo = "example/sample";
    cache.set("public-gh-search:sample:" + since + ":5", [thread({ where: repo })]);
    cache.set("public-gh-repo:" + repo + ":" + since + ":5", [thread({ where: repo })]);
    const fetcher = { async json() { return { data: { repository: { visibility: "PRIVATE" } } }; } } as Fetcher;
    const online = new GitHub(fetcher, cache, "fixture");
    expect((await online.search("sample", since, 5))[0].githubVisibilityObserved).toContain("2026-11-20");
    now += 1000;
    await expect(online.repoThreads(repo, "2024-11-21", 5)).rejects.toThrow("visibility is not public");
    const offline = new GitHub(fetcher, new Cache(dir, true), null);
    expect(await offline.repoThreads(repo, since, 5)).toEqual([]);
    expect(await offline.search("sample", since, 5)).toEqual([]);
    online.observeVisibility(repo, "PUBLIC");
    expect(await online.search("sample", since, 5)).toEqual([]);
  } finally {
    Date.now = realNow;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guide title provenance excludes historical and newly redirected foreign titles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-title-origin-"));
  const realNow = Date.now;
  try {
    const root = SITES[0].sitemap!, page = new URL("/provenance", root).href;
    const cache = new Cache(dir);
    cache.set("meta:" + page, { title: "Unverified", language: "en" });
    cache.set("sitemap-tree:" + root, [{ url: page, lastmod: null }]);
    const fetcher = new Fetcher({}, 0, async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("");
      if (url === root) return new Response("<urlset><url><loc>/provenance</loc></url></urlset>");
      if (url === page) return new Response(null, { status: 302, headers: { location: "https://other.example/page" } });
      return new Response("", { status: 404 });
    });
    const run = (store: Cache) => discoverGuides(fetcher, store, new GitHub(fetcher, store, null), index, "2026-11-20", {});
    expect((await run(new Cache(dir, true))).drafts).toEqual([]);
    Date.now = () => realNow() - 8 * 86400_000;
    cache.set(guideTitleKey(page), { title: "Former title", language: "en", origin: new URL(page).origin });
    Date.now = realNow;
    expect((await run(cache)).drafts).toEqual([]);
    expect((await run(new Cache(dir, true))).drafts).toEqual([]);
  } finally {
    Date.now = realNow;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty HTML title keeps usable stale metadata and does not get the success TTL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-empty-title-"));
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 20);
  Date.now = () => now;
  try {
    const root = SITES[0].sitemap!, page = new URL("/title", root).href;
    const cache = new Cache(dir);
    cache.set(guideTitleKey(page), { title: "Old guide", language: "en", origin: new URL(root).origin });
    now += 8 * 86400_000;
    let usable = false;
    const fetcher = guideFetcher(async (url) => {
      if (url === root) return "<urlset><url><loc>/title</loc></url></urlset>";
      if (url === page) return usable ? "<title>New guide</title>" : "<title>   </title>";
      throw new Error("no fixture");
    });
    const run = (store: Cache) => discoverGuides(fetcher, store, new GitHub(fetcher, store, null), index, "2026-11-20", {});
    expect((await run(cache)).drafts[0].title).toBe("Old guide");
    expect((await run(new Cache(dir, true))).drafts[0].language).toBe("en");
    now += 2 * 3600_000;
    usable = true;
    expect((await run(cache)).drafts[0].title).toBe("New guide");
  } finally {
    Date.now = realNow;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refused redirects and their delays do not affect other hosts", async () => {
  const visits: string[] = [], waits: number[] = [];
  const fetcher = new Fetcher({}, 0, async (url) => {
    visits.push(url);
    return url.endsWith("/start")
      ? new Response(null, { status: 302, headers: { location: "https://other.example/page", "retry-after": "600" } })
      : new Response("ok");
  }, async (ms) => { waits.push(ms); });
  await expect(fetcher.text("https://docs.example/start", { allowedOrigins: ["https://docs.example"] })).rejects.toThrow("outside configured source");
  expect(await fetcher.text("https://other.example/independent")).toBe("ok");
  expect(visits).toEqual(["https://docs.example/robots.txt", "https://docs.example/start", "https://other.example/robots.txt", "https://other.example/independent"]);
  expect(waits).toEqual([]);
});

test("oversized crawl and API backoff defer without sleeping, across runs when persisted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-long-backoff-"));
  try {
    const seen: string[] = [], waits: number[] = [];
    const transport = async (url: string) => {
      seen.push(url);
      if (url === "https://slow.example/robots.txt") return new Response("User-agent: *\nCrawl-delay: 600");
      if (url === "https://limited.example/robots.txt") return new Response("", { status: 429, headers: { "retry-after": "600" } });
      return new Response("ok");
    };
    const store = new Cache(dir);
    const fetcher = new Fetcher({}, 0, transport, async (ms) => { waits.push(ms); }, store);
    fetcher.deferPath("https://api.example/questions", 600);
    expect(waits).toEqual([]);
    await expect(fetcher.text("https://slow.example/page")).rejects.toThrow("robots crawl delay");
    await expect(fetcher.text("https://limited.example/page")).rejects.toBeInstanceOf(RobotsBlocked);
    expect(fetcher.log.failures.some((row) => row.includes("robots.txt HTTP 429"))).toBe(true);
    const next = new Fetcher({}, 0, transport, async (ms) => { waits.push(ms); }, store);
    await expect(next.text("https://api.example/questions?next")).rejects.toThrow("deferred");
    expect(await next.text("https://api.example/other")).toBe("ok");
    expect(seen).not.toContain("https://api.example/questions?next");
    expect(waits).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Atom entries with external, binary or empty content use the summary", () => {
  const entries = ['<content src="/movie" type="video/mp4"/>', '<content type="video/mp4">binary</content>', '<content>   </content>'];
  const xml = "<feed>" + entries.map((content, n) =>
    '<entry><title>Moblin</title><link href="/post-' + n + '"/>' + content + "<summary>Streaming to OBS</summary></entry>").join("") + "</feed>";
  const parsed = parseFeed(xml, "https://example.org/atom");
  expect(parsed.map((item) => item.text)).toEqual(Array(3).fill("Streaming to OBS"));
});

test("an engineering change mentioned as a cause does not erase support intent", () => {
  const kind = (title: string) => kindOf(thread({ title })).kind;
  expect(kind("Why does OBS freeze after the dependency update?")).toBe("question");
  expect(kind("Bug: encoder refactor broke mobile streaming")).toBe("problem");
  expect(kind("How can we refactor the CI unit tests?")).toBe("dev");
  expect(kind("Add unit tests for reconnects")).toBe("dev");
  expect(kind("Could you add unit tests for reconnects?")).toBe("dev");
  expect(kind("Could you explain why the preview now freezes?")).toBe("question");
});

test("single threaded replies are classified from the original GraphQL page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-single-replies-"));
  try {
    for (const replied of [false, true]) {
      const calls: string[] = [];
      const fetcher = { async json(_url: string, opts: RequestInit) {
        const { query, variables } = JSON.parse(String(opts.body));
        expect(variables.id).toBeUndefined();
        calls.push(query);
        const issues = { pageInfo: { hasNextPage: false }, nodes: [] };
        const repository = { nameWithOwner: "example/sample", visibility: "PUBLIC", hasDiscussionsEnabled: true };
        const nodes = Array.from({ length: 30 }, (_, n) => ({
          authorAssociation: "NONE", replies: { pageInfo: { hasNextPage: false }, nodes: [{ authorAssociation: replied && n === 29 ? "OWNER" : "NONE" }] },
        }));
        return { data: { repository: { ...repository, issues, discussions: { ...issues, nodes: [{
          id: "discussion", number: 1, title: "Settings", url: "https://github.com/example/sample/discussions/1",
          createdAt: "2026-11-20", updatedAt: "2026-11-20", repository,
          comments: { totalCount: 30, nodes, pageInfo: { hasNextPage: false } },
        }] } } } };
      } } as Fetcher;
      const gh = new GitHub(fetcher, new Cache(dir), "fixture");
      const [thread] = await gh.repoThreads("example/sample", "2024-11-20", replied ? 6 : 5);
      expect(thread.maintainerReplied).toBe(replied);
      expect(calls).toHaveLength(2);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("asctime Retry-After is interpreted as UTC in a non-UTC timezone", async () => {
  const realNow = Date.now, tz = process.env.TZ;
  try {
    process.env.TZ = "Europe/Berlin";
    Date.now = () => Date.UTC(2026, 10, 22, 12);
    const waits: number[] = [];
    let first = true;
    const fetcher = new Fetcher({}, 0, async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("");
      if (!first) return new Response("ok");
      first = false;
      return new Response(null, { status: 429, headers: { "retry-after": "Sun Nov 22 12:02:00 2026" } });
    }, async (ms) => { waits.push(ms); });
    await expect(fetcher.text("https://example.org/page")).resolves.toBe("ok");
    expect(waits).toEqual([120_000]);
  } finally {
    Date.now = realNow;
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

test("legacy question reports need a successful date-window source before migration", () => {
  const out = mkdtempSync(join(tmpdir(), "discovery-legacy-window-"));
  try {
    mkdirSync(join(out, "state"));
    const file = join(out, "questions.json"), since = "2023-12-01";
    const failed = [{ source: "GitHub example/sample", read: 0, kept: 0, note: "failed: rate limited" }];
    writeFileSync(file, JSON.stringify({ since, stats: [...failed, { source: "Forum", read: 2, kept: 2 }] }));
    expect(saveQuestionWindow(out, "2024-11-20", false, failed)).toBeUndefined();
    expect(questionsSince(out, "2026-11-20", undefined, true)).toBe("2024-11-20");
    writeFileSync(file, JSON.stringify({ since, stats: [{ source: "Stack Exchange [streaming]", read: 0, kept: 0 }] }));
    expect(saveQuestionWindow(out, "2024-11-20", false, failed)).toBe(since);
    expect(questionsSince(out, "2026-11-20", undefined, true)).toBe(since);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("old mobile YouTube keys migrate with or without case preservation", () => {
  const url = "https://m.youtube.com/watch?list=SomeList&v=AbC123";
  const date = "2025-01-01";
  const candidate = draftFor({ url, lastmod: null, title: "Guide" }, [], null, "Example", index, date);
  for (const legacy of [url, url.toLowerCase()]) {
    expect(migrateGuideSeen({ [legacy]: date }, [candidate])).toEqual({ "https://youtube.com/watch?v=AbC123": date });
  }
});

test("question feeds refresh old parser snapshots online and identify them offline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-forum-version-"));
  try {
    const feed = FORUM_FEEDS[0];
    const online = new Cache(dir);
    online.set("threads-v2:rss:" + feed.url, []);
    const fetcher = guideFetcher(async (url) => {
      if (url !== feed.url) throw new Error("no fixture");
      return "<rss><channel><item><title>Set up a bonded stream in OBS</title><link>https://example.org/post</link>"
        + "<pubDate>Fri, 20 Nov 2026 12:00:00 GMT</pubDate><description><![CDATA[Example <feed>]]></description></item></channel></rss>";
    });
    const stats: SourceStat[] = [];
    expect(await harvestForums(fetcher, new Cache(dir, true), "2024-11-20", stats)).toEqual([]);
    expect(stats[0].note).toContain("older forum-feed cache");
    expect(await harvestForums(fetcher, online, "2024-11-20", [])).toHaveLength(1);
    expect(await harvestForums(fetcher, new Cache(dir, true), "2024-11-20", [])).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux")("a swapped ancestor cannot redirect initial output directory creation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-output-ancestor-"));
  try {
    const repo = join(dir, "repo"), parent = join(dir, "external");
    mkdirSync(repo);
    mkdirSync(parent);
    const out = prepareOutput(join(parent, "out"), repo);
    renameSync(parent, join(dir, "moved"));
    symlinkSync(repo, parent);
    await expect(withOutputDirectories(out, repo, async () => null)).rejects.toThrow();
    expect(readdirSync(repo)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a repeated incomplete sitemap refresh retains both complete and partial coverage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-partial-coverage-"));
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 20);
  Date.now = () => now;
  try {
    const root = "https://docs.example.org/root", cache = new Cache(dir);
    let phase = 0;
    const fetcher = guideFetcher(async (url) => {
      if (url.endsWith("/failed") || phase === 2) throw new Error("unavailable");
      if (url === root && phase === 1) return "<sitemapindex><sitemap><loc>/fresh</loc></sitemap><sitemap><loc>/failed</loc></sitemap></sitemapindex>";
      return "<urlset><url><loc>" + (phase === 0 ? "/old" : "/new") + "</loc></url></urlset>";
    });
    const paths = (result: Awaited<ReturnType<typeof readSitemap>>) => result.pages.map((page) => new URL(page.url).pathname).sort();
    expect(paths(await readSitemap(fetcher, cache, root))).toEqual(["/old"]);
    phase = 1;
    now += 86400_000;
    expect(paths(await readSitemap(fetcher, cache, root))).toEqual(["/new", "/old"]);
    phase = 2;
    now += 86400_000;
    expect(paths(await readSitemap(fetcher, cache, root))).toEqual(["/new", "/old"]);
    expect(paths(await readSitemap(fetcher, new Cache(dir, true), root))).toEqual(["/new", "/old"]);
  } finally {
    Date.now = realNow;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Bun's bounded transport retains compressed bytes over a Unix HTTP socket", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-unix-http-"));
  const socket = join(dir, "http.sock");
  const xml = "<urlset>" + "<url><loc>/example</loc></url>".repeat(45) + "</urlset>";
  const wire = Bun.gzipSync(xml);
  const server = Bun.serve({ unix: socket, fetch(request) {
    if (new URL(request.url).pathname === "/robots.txt") return new Response("");
    return new Response(wire, { headers: { "Content-Encoding": "gzip" } });
  } });
  try {
    const url = "http://example.invalid/sitemap.xml";
    const fetcher = new Fetcher({}, 0, (target, options) => fetch(target, { ...options, unix: socket }));
    await expect(fetcher.binaryDocument(url, {}, 2048, { ratio: 2 })).rejects.toThrow("decoded response exceeds");
    const accepted = await fetcher.binaryDocument(url, {}, 2048, { ratio: 150 });
    expect(accepted.wireBytes).toBe(wire.length);
    expect(new TextDecoder().decode(accepted.bytes)).toBe(xml);
  } finally {
    await server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a partial GitHub response can withdraw threads already collected for this report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-publication-visibility-"));
  try {
    const cache = new Cache(dir), repo = "example/sample", since = "2024-11-20";
    cache.set("public-gh-repo:" + repo + ":" + since + ":2000", [thread({ where: repo })]);
    const fetcher = { async json() {
      return { data: { search: { nodes: [{ repository: { nameWithOwner: repo, visibility: "PRIVATE" } }] } },
        errors: [{ message: "nullable field unavailable" }] };
    } } as Fetcher;
    const github = new GitHub(fetcher, cache, "fixture"), stats: SourceStat[] = [];
    expect(await harvestGitHub(github, [repo], since, stats)).toEqual([]);
    expect(stats[0]).toMatchObject({ read: 0, kept: 0 });
    expect(stats[1].note).toContain("nullable field unavailable");
    const offline = new GitHub(fetcher, new Cache(dir, true), null);
    expect(await offline.repoThreads(repo, since, 2000)).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a search row keeps its observation and cannot outlive a later withdrawal in the same batch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-search-generation-"));
  try {
    const cache = new Cache(dir), repo = "example/sample", since = "2024-11-20";
    const node = {
      number: 1, url: "https://github.com/example/sample/issues/1", title: "Bonded streaming to OBS", state: "OPEN",
      createdAt: "2026-11-20", updatedAt: "2026-11-20", repository: { nameWithOwner: repo, visibility: "PUBLIC" },
    };
    const fetcher = { async json(_url: string, init: RequestInit) {
      const { query, variables } = JSON.parse(String(init.body));
      const issue = query.includes("type: ISSUE");
      return { data: { search: { nodes: !issue ? [] : variables.after
        ? [{ repository: { nameWithOwner: repo, visibility: "PRIVATE" } }] : [node],
        pageInfo: { hasNextPage: issue && !variables.after, endCursor: "next" },
      } } };
    } } as Fetcher;
    const gh = new GitHub(fetcher, cache, "fixture");
    expect(await gh.search("sample", since, 5)).toEqual([]);
    gh.observeVisibility(repo, "PUBLIC");
    expect(await gh.search("sample", since, 5)).toEqual([]);
    const offline = new GitHub(fetcher, new Cache(dir, true), null);
    expect(await offline.search("sample", since, 5)).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("daily sitemap runs give a budget-deferred member a fresh allowance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-daily-budget-"));
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 20);
  Date.now = () => now;
  try {
    const root = "https://docs.example.org/root", requests: string[] = [];
    const fetcher = new Fetcher({}, 0, async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("");
      const path = new URL(url).pathname;
      requests.push(path);
      if (url === root) return new Response("<sitemapindex>" + [1, 2, 3, 4].map((n) => "<sitemap><loc>/m" + n + "</loc></sitemap>").join("") + "</sitemapindex>");
      const xml = "<urlset><url><loc>/guide-" + path.slice(-1) + "</loc></url></urlset>";
      return new Response(xml.padEnd(1000, " "), { headers: { "Content-Length": "1000" } });
    });
    const limits = { documents: 20, depth: 2, members: 20, pages: 20, wire: 1024, decoded: 1024, ratio: 150 };
    const cache = new Cache(dir);
    const first = await readSitemap(fetcher, cache, root, limits);
    expect(first.pages).toHaveLength(3);
    expect(first.note).not.toContain("unavailable");
    now += 86400_000;
    requests.length = 0;
    expect((await readSitemap(fetcher, cache, root, limits)).pages).toHaveLength(4);
    expect(requests).toEqual(["/m4"]);
  } finally { Date.now = realNow; rmSync(dir, { recursive: true, force: true }); }
});

test("identity responses enforce the remaining decoded allowance as they arrive", async () => {
  let wire = 0, decoded = 0;
  const fetcher = new Fetcher({}, 0, async (url) => url.endsWith("/robots.txt") ? new Response("") : new Response(new ReadableStream({
    type: "bytes",
    pull(controller) { controller.enqueue(new Uint8Array(900)); controller.close(); },
  })));
  await expect(fetcher.binaryDocument("https://example.org/map", {}, 1024, {
    decoded: 27, chargeWire: (n) => { wire += n; }, chargeDecoded: (n) => { decoded += n; },
  })).rejects.toThrow("decoded response exceeds 27 bytes");
  expect([wire, decoded]).toEqual([28, 28]);
});

test("incomplete sitemap XML cannot replace a usable offline listing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-incomplete-xml-"));
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 20);
  Date.now = () => now;
  try {
    const root = "https://docs.example.org/root", cache = new Cache(dir);
    let xml = "<urlset><url><loc>/previous</loc></url></urlset>";
    const fetcher = guideFetcher(async () => xml);
    const list = (store: Cache) => readSitemap(fetcher, store, root);
    expect((await list(cache)).pages.map((page) => page.url)).toEqual(["https://docs.example.org/previous"]);
    now += 86400_000;
    xml = "<urlset><url><loc>/truncated";
    expect((await list(cache)).note).toContain("unavailable");
    expect((await list(new Cache(dir, true))).pages.map((page) => page.url)).toEqual(["https://docs.example.org/previous"]);
    xml = '<?xml version="1.0"?><s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"><s:url>'
      + '<s:loc><![CDATA[/new?one=1&two=2]]></s:loc></s:url></s:urlset><!-- end -->';
    expect((await list(cache)).pages.map((page) => page.url)).toEqual(["https://docs.example.org/new?one=1&two=2"]);
    expect(() => parseSitemap('<urlset><url><loc>/incomplete</loc></url>')).toThrow("sitemap XML");
    expect(() => parseSitemap('<urlset/><urlset/>')).toThrow("sitemap XML");
    expect(parseSitemap("<urlset/>").pages).toEqual([]);
  } finally { Date.now = realNow; rmSync(dir, { recursive: true, force: true }); }
});

test("legacy sitemap listings survive a failed upgrade and scoped work resumes", async () => {
  for (const format of ["sitemap", "sitemap-tree", "sitemap-scoped"]) {
    const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-upgrade-"));
    try {
      const root = "https://docs.example.org/root", member = "https://docs.example.org/member";
      const cache = new Cache(dir), requests: string[] = [];
      const pages = [{ url: "https://docs.example.org/old", lastmod: "2026-11-20" }, { url: "https://foreign.example/untrusted", lastmod: null }];
      const scoped = format === "sitemap-scoped";
      if (scoped) cache.set(format + ":" + root + ":https://docs.example.org",
        { pages, pending: [{ url: member, depth: 1 }], seen: [root, member], omitted: 0, outside: 0, malformed: 0, failed: [] });
      else cache.set(format + ":" + root, pages);
      const fetcher = guideFetcher(async (url) => {
        requests.push(url);
        if (url === member) return "<urlset><url><loc>/new</loc></url></urlset>";
        throw new Error("unavailable");
      });
      const before = await readSitemap(fetcher, new Cache(dir, true), root);
      expect(before.pages).toEqual([pages[0]]);
      const after = await readSitemap(fetcher, cache, root);
      expect(requests).toEqual([scoped ? member : root]);
      expect(after.pages).toHaveLength(scoped ? 2 : 1);
      if (!scoped) expect(after.note).toContain("older sitemap cache");
      expect((await readSitemap(fetcher, new Cache(dir, true), root)).pages).toEqual(after.pages);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("a concurrent failed sitemap refresh cannot replace the successful generation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-overlap-"));
  try {
    const root = "https://docs.example.org/root", cache = new Cache(dir);
    let release!: () => void, started!: () => void;
    const atRequest = new Promise<void>((resolve) => { started = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const slower = guideFetcher(async () => { started(); await wait; throw new Error("late failure"); });
    const faster = guideFetcher(async () => "<urlset><url><loc>/good</loc></url></urlset>");
    const pending = readSitemap(slower, cache, root);
    await atRequest;
    expect((await readSitemap(faster, new Cache(dir), root)).pages).toHaveLength(1);
    release();
    expect((await pending).pages).toHaveLength(1);
    expect((await readSitemap(faster, new Cache(dir, true), root)).pages).toEqual([{ url: "https://docs.example.org/good", lastmod: null }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("both legacy and current wiki listings respect repository withdrawals", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-wiki-visibility-"));
  try {
    const cache = new Cache(dir);
    const run = () => {
      const offline = new Cache(dir, true);
      const fetcher = new Fetcher({}, 0, async () => { throw new Error("offline fetched"); });
      return discoverGuides(fetcher, offline, new GitHub(fetcher, offline, null), index, "2026-11-20", {});
    };
    WIKIS.slice(0, 2).forEach((w, i) => {
      cache.set((i ? "wiki:" : "wiki-tree:") + w.repo, [{ url: "https://github.com/" + w.repo + "/wiki/Moblin-bonded-stream", title: "Moblin bonded stream" }]);
    });
    const first = await run();
    const wikiStats = (stats: SourceStat[]) => stats.filter((row) => WIKIS.slice(0, 2).some((w) => row.source === "GitHub wiki " + w.repo));
    expect(wikiStats(first.stats).every((row) => row.read === 1 && row.note?.includes("public wiki snapshot from"))).toBe(true);
    const github = new GitHub(new Fetcher(), cache, null);
    for (const wiki of WIKIS.slice(0, 2)) github.observeVisibility(wiki.repo, "PRIVATE");
    const withdrawn = await run();
    expect(withdrawn.drafts).toEqual([]);
    expect(wikiStats(withdrawn.stats).every((row) => row.read === 0 && row.kept === 0)).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a long crawl delay leaves an eligible slot for a later invocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-crawl-resume-"));
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 20);
  Date.now = () => now;
  try {
    const requests: string[] = [];
    const transport = async (url: string) => {
      requests.push(url);
      return new Response(url.endsWith("/robots.txt") ? "User-agent: *\nCrawl-delay: 600" : "ok");
    };
    const fetcher = () => new Fetcher({}, 0, transport, async () => { throw new Error("unbudgeted wait"); }, new Cache(dir));
    await expect(fetcher().text("https://slow.example/page")).rejects.toThrow("robots crawl delay");
    now += 600_000;
    expect(await fetcher().text("https://slow.example/page")).toBe("ok");
    now += 1;
    await expect(fetcher().text("https://slow.example/another")).rejects.toThrow("robots crawl delay");
    expect(requests).toEqual(["https://slow.example/robots.txt", "https://slow.example/page"]);
  } finally { Date.now = realNow; rmSync(dir, { recursive: true, force: true }); }
});

test("robots redirects cool down the host that actually returned a rate limit", async () => {
  const requests: string[] = [];
  const fetcher = new Fetcher({}, 0, async (url) => {
    requests.push(url);
    return url.includes("first.example")
      ? new Response(null, { status: 302, headers: { location: "https://other.example/rules" } })
      : new Response(null, { status: 429, headers: { "retry-after": "600" } });
  });
  await expect(fetcher.text("https://first.example/page")).rejects.toBeInstanceOf(RobotsBlocked);
  await expect(fetcher.text("https://other.example/independent")).rejects.toThrow("retry deferred");
  expect(requests).toEqual(["https://first.example/robots.txt", "https://other.example/rules"]);
  expect(fetcher.log.failures[0]).toContain("for other.example (robots.txt HTTP 429)");
});

test("inline maintainer evidence wins before expanding other Discussion replies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-inline-answers-"));
  try {
    const calls: string[] = [];
    const repository = { nameWithOwner: "example/sample", visibility: "PUBLIC", hasDiscussionsEnabled: true };
    const pageInfo = { hasNextPage: false };
    const fetcher = { async json(_url: string, options: RequestInit) {
      const { query, variables } = JSON.parse(String(options.body));
      if (variables.id) throw new Error("unnecessary continuation");
      calls.push(query);
      return { data: { repository: { ...repository, issues: { pageInfo, nodes: [] }, discussions: { pageInfo, nodes: [{
        id: "discussion", number: 1, title: "Video stops", url: "https://github.com/example/sample/discussions/1",
        createdAt: "2026-11-20", updatedAt: "2026-11-20", repository,
        comments: { pageInfo, nodes: [
          { id: "earlier", replies: { pageInfo: { hasNextPage: true, endCursor: "next" }, nodes: [{ authorAssociation: "NONE" }] } },
          { id: "later", replies: { pageInfo, nodes: [{ authorAssociation: "OWNER" }] } },
        ] },
      }] } } } };
    } } as Fetcher;
    const github = new GitHub(fetcher, new Cache(dir), "fixture");
    expect((await github.repoThreads(repository.nameWithOwner, "2024-11-20", 5))[0].maintainerReplied).toBe(true);
    expect(calls).toHaveLength(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unsupported platforms refuse discovery before creating output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-platform-"));
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    const checkout = join(dir, "checkout");
    mkdirSync(checkout);
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    await expect(withOutputDirectories(join(dir, "out"), checkout, async () => null))
      .rejects.toThrow("require Linux directory descriptors");
    expect(readdirSync(dir)).toEqual(["checkout"]);
  } finally {
    Object.defineProperty(process, "platform", platform);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("redirect aliases cannot grow the sitemap location budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-alias-bound-"));
  try {
    const root = "https://docs.example.org/root";
    const fetcher = new Fetcher({}, 0, async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("");
      if (url === root) return new Response("<sitemapindex><sitemap><loc>/one</loc></sitemap><sitemap><loc>/two</loc></sitemap></sitemapindex>");
      if (url.endsWith("/one") || url.endsWith("/two")) return new Response(null, { status: 302, headers: { location: "/alias-" + url.split("/").at(-1) } });
      return new Response("<urlset><url><loc>/" + url.split("/").at(-1) + "-guide</loc></url></urlset>");
    });
    const cache = new Cache(dir);
    const result = await readSitemap(fetcher, cache, root, { documents: 10, depth: 4, members: 3, pages: 10, wire: 1024, decoded: 1024, ratio: 150 });
    expect(result.pages).toHaveLength(2);
    expect(result.note).toContain("2 sitemap entries omitted by limits");
    const stored = cache.get<{ listing: { snapshot: { seen: string[] } } }>("sitemap-listing:" + root + ":https://docs.example.org", 24)!;
    expect(stored.listing.snapshot.seen).toHaveLength(3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("GitHub rows share the page observation time even when comment requests take time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-observation-time-"));
  const realNow = Date.now;
  const epoch = Date.UTC(2026, 10, 20);
  let now = epoch;
  Date.now = () => now;
  try {
    const repo = "example/sample", visibility = "PUBLIC";
    const fetcher = { async json(_url: string, opts: RequestInit) {
      const { query, variables } = JSON.parse(String(opts.body));
      const pageInfo = { hasNextPage: false };
      if (variables.id) {
        now += 30_000;
        return { data: { node: { repository: { visibility }, comments: { nodes: [], pageInfo } } } };
      }
      if (query.includes("type: DISCUSSION")) return { data: { search: { nodes: [], pageInfo } } };
      const nodes = [1, 2].map((number) => ({
        id: String(number), number, url: "https://github.com/example/sample/issues/" + number,
        title: "Bonded video", state: "OPEN", repository: { nameWithOwner: repo, visibility },
        createdAt: "2026-11-20", updatedAt: "2026-11-20",
        comments: { nodes: [], pageInfo: { hasNextPage: number === 1, endCursor: "next" } },
      }));
      return { data: { search: { nodes, pageInfo } } };
    } } as Fetcher;
    const github = new GitHub(fetcher, new Cache(dir), "fixture");
    expect((await github.search("sample", "2024-11-20", 5)).map((row) => row.githubVisibilityObserved))
      .toEqual(Array(2).fill(new Date(epoch).toISOString()));
  } finally { Date.now = realNow; rmSync(dir, { recursive: true, force: true }); }
});

test("sitemap namespaces, malformed attributes, and empty replacements preserve coverage correctly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discovery-sitemap-namespace-"));
  const realNow = Date.now;
  let now = Date.UTC(2026, 10, 20);
  Date.now = () => now;
  try {
    const root = "https://example.org/sitemap.xml", cache = new Cache(dir);
    const namespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
    let xml = "<urlset><url><loc>/previous</loc></url></urlset>";
    const fetcher = guideFetcher(async () => xml);
    const read = () => readSitemap(fetcher, cache, root);
    const offline = () => readSitemap(fetcher, new Cache(dir, true), root);
    expect((await read()).pages.map((page) => page.url)).toEqual(["https://example.org/previous"]);

    now += 86400_000;
    xml = '<urlset xmlns="' + namespace + '" xmlns:s="' + namespace + '"><s:url><s:loc>https://example.org/current</s:loc></s:url></urlset>';
    expect((await read()).pages.map((page) => page.url)).toEqual(["https://example.org/current"]);
    expect((await offline()).pages.map((page) => page.url)).toEqual(["https://example.org/current"]);

    now += 86400_000;
    xml = '<urlset xmlns="' + namespace + '" xmlns="' + namespace + '"/>';
    expect((await read()).note).toContain("unavailable");
    expect((await offline()).pages.map((page) => page.url)).toEqual(["https://example.org/current"]);

    xml = '<urlset xmlns="' + namespace + '"/>';
    expect(await read()).toMatchObject({ pages: [], note: "empty sitemap replaced previous coverage" });
    expect(await offline()).toMatchObject({ pages: [], note: "empty sitemap replaced previous coverage" });

    const index = '<s:sitemapindex xmlns:s="' + namespace + '"><a:sitemap xmlns:a="' + namespace + '">'
      + '<s:loc>/member.xml</s:loc></a:sitemap></s:sitemapindex>';
    expect(parseSitemap(index).sitemaps).toEqual(["/member.xml"]);
    expect(() => parseSitemap('<urlset><unbound:url/></urlset>')).toThrow("sitemap XML");
    expect(() => parseSitemap('<urlset xmlns:x="urn:fixture" xmlns:y="urn:fixture" x:id="1" y:id="2"/>')).toThrow("sitemap XML");
  } finally { Date.now = realNow; rmSync(dir, { recursive: true, force: true }); }
});
