// Reading public threads: GitHub issues and discussions (GraphQL, read-only), GitHub-wide
// searches, Stack Exchange questions and public forum boards. Only the fields in Thread
// are kept; people's names, avatars and full bodies are dropped before anything is cached.
import { FORUM_FEEDS, GENERIC_REPO_LIMIT, GENERIC_REPOS, GITHUB_SEARCHES, GITHUB_SEARCH_LIMIT, STACK_EXCHANGE } from "./config.ts";
import { isRelevant, sanitize, type Thread } from "./classify.ts";
import type { Cache, Fetcher } from "./http.ts";

export type SourceStat = { source: string; read: number; kept: number; note?: string };

/** This project's own repositories: their threads are about the data, not about streaming. */
const OWN_ORGS = /^irl-commons\//i;
const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const day = (iso: string) => iso.slice(0, 10);

export function githubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const r = Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" });
    const t = r.stdout.toString().trim();
    return r.exitCode === 0 && t ? t : null;
  } catch { return null; }
}

const ISSUE = `number title url createdAt updatedAt closedAt state stateReason bodyText authorAssociation
  labels(first: 10) { nodes { name } } reactions { totalCount }
  comments(first: 30) { totalCount nodes { authorAssociation } } repository { nameWithOwner }`;
const DISCUSSION = `number title url createdAt updatedAt closed isAnswered bodyText authorAssociation upvoteCount
  category { name } answer { authorAssociation }
  comments(first: 30) { totalCount nodes { authorAssociation } } repository { nameWithOwner }`;

export function fromIssue(n: any, source: Thread["source"]): Thread {
  const commenters = (n.comments?.nodes ?? []).map((c: any) => c.authorAssociation);
  return {
    id: `gh:${n.repository.nameWithOwner}#${n.number}`, source, where: n.repository.nameWithOwner, url: n.url, title: n.title,
    created: day(n.createdAt), updated: day(n.updatedAt), type: "issue", labels: (n.labels?.nodes ?? []).map((l: any) => l.name), category: null,
    open: n.state === "OPEN",
    closedAs: n.state === "OPEN" ? null : n.stateReason === "NOT_PLANNED" ? "not-planned" : n.stateReason === "DUPLICATE" ? "duplicate" : "completed",
    accepted: false, upvotedAnswer: false,
    maintainerReplied: commenters.some((a: string) => MAINTAINER.has(a)) && !MAINTAINER.has(n.authorAssociation),
    replies: n.comments?.totalCount ?? 0, score: n.reactions?.totalCount ?? 0,
    byMaintainer: MAINTAINER.has(n.authorAssociation), text: sanitize(n.bodyText ?? ""),
  };
}

export function fromDiscussion(n: any, source: Thread["source"]): Thread {
  const commenters = (n.comments?.nodes ?? []).map((c: any) => c.authorAssociation);
  return {
    id: `gh:${n.repository.nameWithOwner}/discussions/${n.number}`, source, where: n.repository.nameWithOwner, url: n.url, title: n.title,
    created: day(n.createdAt), updated: day(n.updatedAt), type: "discussion", labels: [], category: n.category?.name ?? null,
    open: !n.closed, closedAs: n.closed ? "completed" : null,
    accepted: !!n.isAnswered, upvotedAnswer: false,
    maintainerReplied: (commenters.some((a: string) => MAINTAINER.has(a)) || MAINTAINER.has(n.answer?.authorAssociation)) && !MAINTAINER.has(n.authorAssociation),
    replies: n.comments?.totalCount ?? 0, score: n.upvoteCount ?? 0,
    byMaintainer: MAINTAINER.has(n.authorAssociation), text: sanitize(n.bodyText ?? ""),
  };
}

export class GitHub {
  constructor(private fetcher: Fetcher, private cache: Cache, private token: string | null) {}

  async graphql(query: string, variables: Record<string, unknown>): Promise<any> {
    if (!this.token) throw new Error("GitHub needs a token: set GITHUB_TOKEN or sign in with gh (read-only use)");
    const r = await this.fetcher.json("https://api.github.com/graphql", {
      method: "POST", body: JSON.stringify({ query, variables }),
      headers: { Authorization: `bearer ${this.token}`, "Content-Type": "application/json" },
    });
    if (r.errors?.length) throw new Error(r.errors.map((e: any) => e.message).join("; "));
    return r.data;
  }

  async rest(path: string): Promise<any> {
    return this.fetcher.json(`https://api.github.com${path}`, { headers: { ...(this.token ? { Authorization: `bearer ${this.token}` } : {}), Accept: "application/vnd.github+json" } });
  }

  /** Issues and discussions of one repository, newest first, back to `since`. */
  async repoThreads(repo: string, since: string, limit: number): Promise<Thread[]> {
    const [owner, name] = repo.split("/");
    return this.cache.remember(`gh-repo:${repo}:${since}:${limit}`, 20, async () => {
      const out: Thread[] = [];
      for (const [field, fragment, convert] of [["issues", ISSUE, fromIssue], ["discussions", DISCUSSION, fromDiscussion]] as const) {
        let after: string | null = null, count = 0;
        for (;;) {
          const q = `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {
            ${field}(first: 50, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
              pageInfo { hasNextPage endCursor } nodes { ${fragment} } } } }`;
          let data: any;
          try { data = await this.graphql(q, { owner, name, after }); } catch (e) {
            if (field === "discussions") break; // discussions turned off
            throw e;
          }
          const conn = data.repository?.[field];
          if (!conn) break;
          let older = false;
          for (const n of conn.nodes) {
            if (day(n.createdAt) < since) { older = true; break; }
            out.push(convert(n, "github"));
            count++;
          }
          if (older || !conn.pageInfo.hasNextPage || count >= limit) break;
          after = conn.pageInfo.endCursor;
        }
      }
      return out;
    });
  }

  /** GitHub-wide search for issues and discussions. */
  async search(term: string, since: string, limit: number): Promise<Thread[]> {
    return this.cache.remember(`gh-search:${term}:${since}:${limit}`, 20, async () => {
      const out: Thread[] = [];
      for (const [type, fragment, convert, extra] of [["ISSUE", `... on Issue { ${ISSUE} }`, fromIssue, " is:issue"], ["DISCUSSION", `... on Discussion { ${DISCUSSION} }`, fromDiscussion, ""]] as const) {
        let after: string | null = null;
        for (let n = 0; n < limit;) {
          const q = `query($q: String!, $after: String) { search(query: $q, type: ${type}, first: 50, after: $after) {
            pageInfo { hasNextPage endCursor } nodes { ${fragment} } } }`;
          const data = await this.graphql(q, { q: `${term}${extra} created:>=${since}`, after });
          for (const node of data.search.nodes) if (node?.url) { out.push(convert(node, "github-search")); n++; }
          if (!data.search.pageInfo.hasNextPage) break;
          after = data.search.pageInfo.endCursor;
        }
      }
      return out;
    });
  }
}

export async function harvestGitHub(gh: GitHub, repos: string[], since: string, stats: SourceStat[]): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const repo of repos) {
    const generic = GENERIC_REPOS.has(repo);
    try {
      const all = await gh.repoThreads(repo, since, generic ? GENERIC_REPO_LIMIT : 2000);
      const kept = generic ? all.filter((t) => isRelevant(t.title, t.text)) : all;
      stats.push({ source: `GitHub ${repo}`, read: all.length, kept: kept.length, note: generic ? "IRL relevance filter" : undefined });
      out.push(...kept);
    } catch (e) { stats.push({ source: `GitHub ${repo}`, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }
  const seen = new Set(out.map((t) => t.url));
  const repoSet = new Set(repos.map((r) => r.toLowerCase()));
  for (const term of GITHUB_SEARCHES) {
    try {
      const found = await gh.search(term, since, GITHUB_SEARCH_LIMIT);
      const kept = found.filter((t) => !seen.has(t.url) && !repoSet.has(t.where.toLowerCase()) && !OWN_ORGS.test(t.where) && isRelevant(t.title, t.text));
      for (const t of kept) seen.add(t.url);
      stats.push({ source: `GitHub search ${term}`, read: found.length, kept: kept.length, note: "other repositories only" });
      out.push(...kept);
    } catch (e) { stats.push({ source: `GitHub search ${term}`, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }
  return out;
}

// ---------- Stack Exchange ----------

export function fromStackExchange(q: any, site: string): Thread {
  const date = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
  return {
    id: `se:${site}:${q.question_id}`, source: "stackexchange", where: `${site}.stackexchange`, url: q.link, title: decodeEntities(q.title),
    created: date(q.creation_date), updated: date(q.last_activity_date), type: "question", labels: q.tags ?? [], category: null,
    open: !q.closed_date, closedAs: q.closed_date ? "not-planned" : null,
    accepted: !!q.accepted_answer_id, upvotedAnswer: !!q.is_answered && !q.accepted_answer_id,
    maintainerReplied: false, replies: q.answer_count ?? 0, score: q.score ?? 0, byMaintainer: false,
    text: sanitize(stripHtml(q.body ?? "")),
  };
}

export async function harvestStackExchange(fetcher: Fetcher, cache: Cache, since: string, stats: SourceStat[]): Promise<Thread[]> {
  const out: Thread[] = [];
  const seen = new Set<string>();
  const from = Math.floor(Date.parse(since) / 1000);
  for (const { site, tags } of STACK_EXCHANGE) for (const tag of tags) {
    try {
      const all = await cache.remember(`se:${site}:${tag}:${since}`, 20, async () => {
        const got: Thread[] = [];
        for (let page = 1; page <= 10; page++) {
          const r = await fetcher.json(`https://api.stackexchange.com/2.3/questions?site=${site}&tagged=${encodeURIComponent(tag)}&fromdate=${from}&pagesize=100&page=${page}&order=desc&sort=creation&filter=withbody`);
          got.push(...(r.items ?? []).map((q: any) => fromStackExchange(q, site)));
          if (r.backoff) await Bun.sleep(r.backoff * 1000);
          if (!r.has_more) break;
        }
        return got;
      });
      const kept = all.filter((t) => !seen.has(t.url) && isRelevant(t.title, t.text));
      for (const t of kept) seen.add(t.url);
      stats.push({ source: `Stack Exchange ${site} [${tag}]`, read: all.length, kept: kept.length, note: "IRL relevance filter" });
      out.push(...kept);
    } catch (e) { stats.push({ source: `Stack Exchange ${site} [${tag}]`, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }
  return out;
}

// ---------- RSS boards ----------

export function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, "\"").replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<(script|style|pre|code)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "));
}

export type RssItem = { title: string; link: string; date: string; comments: number; text: string };
export function parseRss(xml: string): RssItem[] {
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, b]) => ({
    title: stripHtml(tag(b, "title")).trim(),
    link: stripHtml(tag(b, "link")).trim(),
    date: (() => { const d = new Date(stripHtml(tag(b, "pubDate")).trim()); return isNaN(+d) ? "" : d.toISOString().slice(0, 10); })(),
    comments: Number(stripHtml(tag(b, "slash:comments"))) || 0,
    text: stripHtml(tag(b, "content:encoded") || tag(b, "description")),
  }));
}

export async function harvestForums(fetcher: Fetcher, cache: Cache, since: string, stats: SourceStat[]): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const feed of FORUM_FEEDS) {
    try {
      const all = await cache.remember(`rss:${feed.url}`, 20, async () => parseRss(await fetcher.text(feed.url)).map((i): Thread => ({
        id: `forum:${i.link}`, source: "forum", where: feed.name, url: i.link, title: i.title, created: i.date, updated: i.date, type: "thread",
        labels: [], category: null, open: true, closedAs: null, accepted: false, upvotedAnswer: false, maintainerReplied: false,
        replies: i.comments, score: 0, byMaintainer: false, text: sanitize(i.text),
      })));
      const kept = all.filter((t) => t.created >= since && isRelevant(t.title, t.text));
      stats.push({ source: feed.name, read: all.length, kept: kept.length, note: "latest posts in the feed; IRL relevance filter" });
      out.push(...kept);
    } catch (e) { stats.push({ source: feed.name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }
  return out;
}
