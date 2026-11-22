// Reading public threads: GitHub issues and discussions (GraphQL, read-only), GitHub-wide
// searches, Stack Exchange questions and public forum boards. Only the fields in Thread
// are kept; people's names, avatars and full bodies are dropped before anything is cached.
import { FORUM_FEEDS, GENERIC_REPO_LIMIT, GENERIC_REPOS, GITHUB_SEARCHES, GITHUB_SEARCH_LIMIT, STACK_EXCHANGE } from "./config.ts";
import { isRelevant, sanitize, type Thread } from "./classify.ts";
import type { Cache, Fetcher } from "./http.ts";

export type SourceStat = { source: string; read: number; kept: number; note?: string };

function rememberThreads(cache: Cache, key: string, make: () => Promise<Thread[]>): Promise<Thread[]> {
  const current = `threads-v2:${key}`;
  if (cache.offline) {
    const hit = cache.get<Thread[]>(current, 20) ?? cache.get<Thread[]>(key, 20);
    if (hit !== undefined) return Promise.resolve(hit);
  }
  return cache.remember(current, 20, make);
}

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

const ISSUE = `id number title url createdAt updatedAt closedAt state stateReason bodyText authorAssociation
  labels(first: 10) { nodes { name } } reactions { totalCount }
  comments(first: 30) { totalCount pageInfo { hasNextPage endCursor } nodes { authorAssociation } } repository { nameWithOwner visibility }`;
const DISCUSSION_COMMENT = "id authorAssociation replies(first: 1) { pageInfo { hasNextPage endCursor } nodes { authorAssociation } }";
const DISCUSSION = `id number title url createdAt updatedAt closed stateReason isAnswered bodyText authorAssociation upvoteCount
  category { name } answer { authorAssociation }
  comments(first: 30) { totalCount pageInfo { hasNextPage endCursor } nodes { ${DISCUSSION_COMMENT} } } repository { nameWithOwner visibility }`;

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
    open: !n.closed, closedAs: !n.closed ? null : n.stateReason === "RESOLVED" ? "completed"
      : n.stateReason === "DUPLICATE" ? "duplicate" : n.stateReason === "OUTDATED" ? "outdated" : "unknown",
    accepted: !!n.isAnswered, upvotedAnswer: false,
    maintainerReplied: (commenters.some((a: string) => MAINTAINER.has(a)) || MAINTAINER.has(n.answer?.authorAssociation)) && !MAINTAINER.has(n.authorAssociation),
    replies: n.comments?.totalCount ?? 0, score: n.upvoteCount ?? 0,
    byMaintainer: MAINTAINER.has(n.authorAssociation), text: sanitize(n.bodyText ?? ""),
  };
}

export class GitHub {
  constructor(private fetcher: Fetcher, private cache: Cache, private token: string | null) {}

  get offline(): boolean { return this.cache.offline; }

  observeVisibility(repo: string, visibility: unknown): void {
    if (!["PUBLIC", "PRIVATE", "INTERNAL"].includes(String(visibility))) return;
    const key = "github-visibility:" + repo.toLowerCase();
    const old = this.cache.get<{ public: boolean; withdrawnAt?: number; generation?: number }>(key, Infinity);
    const isPublic = visibility === "PUBLIC";
    if (old?.public === isPublic) return;
    const generation = (old?.generation ?? 0) + (isPublic ? 0 : 1);
    this.cache.set(key, { public: isPublic, generation, withdrawnAt: isPublic ? old?.withdrawnAt : Date.now() });
  }

  snapshotIsPublic(repo: string, saved: number): boolean {
    const visibility = this.cache.get<{ public: boolean; withdrawnAt?: number }>("github-visibility:" + repo.toLowerCase(), Infinity);
    return visibility?.public !== false && (visibility?.withdrawnAt === undefined || saved >= visibility.withdrawnAt);
  }

  private threadVisibility(repo: string) {
    return this.cache.get<{ public: boolean; withdrawnAt?: number; generation?: number }>(
      "github-visibility:" + repo.toLowerCase(), Infinity,
    );
  }

  keepsThread(thread: Thread): boolean {
    const visibility = this.threadVisibility(thread.where);
    if (!visibility) return true;
    if (!visibility.public) return false;
    if (thread.githubVisibilityGeneration === undefined) return visibility.withdrawnAt === undefined;
    return thread.githubVisibilityGeneration === (visibility.generation ?? 0)
      && (visibility.withdrawnAt === undefined || Date.parse(thread.githubVisibilityObserved ?? "") >= visibility.withdrawnAt);
  }

  private observedThread(thread: Thread): Thread {
    return { ...thread, githubVisibilityObserved: new Date(Date.now()).toISOString(),
      githubVisibilityGeneration: this.threadVisibility(thread.where)?.generation ?? 0 };
  }

  private async publicThreads(key: string, make: () => Promise<Thread[]>): Promise<Thread[]> {
    const records = await this.cache.remember(key, 20, async () => (await make()).filter((thread) => this.keepsThread(thread)));
    const saved = this.cache.entry(key)!.saved;
    return records.filter((thread) => this.keepsThread(thread))
      .map((thread) => thread.githubVisibilityObserved ? thread : { ...thread, githubVisibilityObserved: new Date(saved).toISOString() });
  }

  async graphql(query: string, variables: Record<string, unknown>, repo?: string): Promise<any> {
    if (!this.token) throw new Error("GitHub needs a token: set GITHUB_TOKEN or sign in with gh (read-only use)");
    const r = await this.fetcher.json("https://api.github.com/graphql", {
      method: "POST", body: JSON.stringify({ query, variables }),
      headers: { Authorization: `bearer ${this.token}`, "Content-Type": "application/json" },
    });
    // A nullable selection can fail alongside unaffected repository visibility.
    // Record only withdrawals here. A failed batch never establishes public access.
    const rejectNonpublic = (n: any, fallback = repo) => {
      const name = n?.nameWithOwner ?? fallback;
      if (name && (n?.visibility === "PRIVATE" || n?.visibility === "INTERNAL")) this.observeVisibility(name, n.visibility);
    };
    rejectNonpublic(r.data?.repository);
    rejectNonpublic(r.data?.node?.repository);
    rejectNonpublic(r.data?.node?.discussion?.repository);
    for (const nodes of [r.data?.search?.nodes, r.data?.repository?.issues?.nodes, r.data?.repository?.discussions?.nodes]) {
      for (const node of nodes ?? []) rejectNonpublic(node?.repository);
    }
    if (r.errors?.length) throw new Error(r.errors.map((e: any) => e.message).join("; "));
    return r.data;
  }

  private async discussionReplyByMaintainer(comment: any, repo: string): Promise<boolean> {
    let replies = comment.replies;
    while (replies) {
      if (replies.nodes.some((reply: any) => MAINTAINER.has(reply?.authorAssociation))) return true;
      if (!replies.pageInfo.hasNextPage) return false;
      const query = `query($id: ID!, $after: String!) { node(id: $id) { ... on DiscussionComment {
        discussion { repository { visibility } }
        replies(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { authorAssociation } }
      } } }`;
      const { node } = await this.graphql(query, { id: comment.id, after: replies.pageInfo.endCursor }, repo);
      this.observeVisibility(repo, node?.discussion?.repository?.visibility);
      if (node?.discussion?.repository?.visibility !== "PUBLIC") throw new Error("Discussion comment visibility is not public");
      replies = node.replies;
    }
    return false;
  }

  private async continuedReplies(node: any, thread: Thread): Promise<Thread> {
    if (thread.byMaintainer || thread.maintainerReplied) return thread;
    const discussion = thread.type === "discussion";
    const type = discussion ? "Discussion" : "Issue";
    const selection = discussion ? DISCUSSION_COMMENT : "authorAssociation";
    let comments = node.comments;
    while (comments) {
      if (comments.nodes.some((comment: any) => MAINTAINER.has(comment?.authorAssociation)
        || (discussion && comment?.replies?.nodes?.some((reply: any) => MAINTAINER.has(reply?.authorAssociation))))) {
        return { ...thread, maintainerReplied: true };
      }
      if (discussion) for (const comment of comments.nodes) {
        if (comment?.replies && await this.discussionReplyByMaintainer(comment, thread.where)) {
          return { ...thread, maintainerReplied: true };
        }
      }
      const page = comments.pageInfo;
      if (!page?.hasNextPage) break;
      const query = `query($id: ID!, $after: String!) { node(id: $id) { ... on ${type} {
        repository { visibility }
        comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${selection} } }
      } } }`;
      const data = await this.graphql(query, { id: node.id, after: page.endCursor }, thread.where);
      this.observeVisibility(thread.where, data.node?.repository?.visibility);
      if (data.node?.repository?.visibility !== "PUBLIC") throw new Error("GitHub thread visibility is not public");
      comments = data.node.comments;
      if (!comments) throw new Error("GitHub response missing comments for " + thread.url);
    }
    return thread;
  }

  /** Issues and discussions of one repository, newest first, back to `since`. */
  async repoThreads(repo: string, since: string, limit: number): Promise<Thread[]> {
    const [owner, name] = repo.split("/");
    return this.publicThreads(`public-gh-repo:${repo}:${since}:${limit}`, async () => {
      const out: Thread[] = [];
      let discussionsEnabled = true;
      for (const [field, fragment, convert] of [["issues", ISSUE, fromIssue], ["discussions", DISCUSSION, fromDiscussion]] as const) {
        if (field === "discussions" && !discussionsEnabled) continue;
        let after: string | null = null, count = 0;
        for (;;) {
          const q = `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) {
            visibility hasDiscussionsEnabled
            ${field}(first: 50, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
              pageInfo { hasNextPage endCursor } nodes { ${fragment} } } } }`;
          const { repository } = await this.graphql(q, { owner, name, after }, repo);
          this.observeVisibility(repo, repository?.visibility);
          if (repository?.visibility !== "PUBLIC") throw new Error("GitHub repository visibility is not public");
          discussionsEnabled = repository.hasDiscussionsEnabled !== false;
          const conn = repository?.[field];
          if (!conn) throw new Error("GitHub response missing " + field + " for " + repo);
          let older = false;
          const candidates: { node: any; thread: Thread }[] = [];
          for (const n of conn.nodes) {
            if (n?.repository?.nameWithOwner) this.observeVisibility(n.repository.nameWithOwner, n.repository.visibility);
            if (n?.repository?.visibility !== "PUBLIC") continue;
            if (day(n.createdAt) < since) { older = true; break; }
            candidates.push({ node: n, thread: this.observedThread(convert(n, "github")) });
            count++;
          }
          for (const entry of candidates) out.push(await this.continuedReplies(entry.node, entry.thread));
          if (older || !conn.pageInfo.hasNextPage || count >= limit) break;
          after = conn.pageInfo.endCursor;
        }
      }
      return out;
    });
  }

  /** GitHub-wide search for issues and discussions. */
  async search(term: string, since: string, limit: number): Promise<Thread[]> {
    return this.publicThreads(`public-gh-search:${term}:${since}:${limit}`, async () => {
      const out: Thread[] = [];
      for (const [type, fragment, convert, extra] of [["ISSUE", `... on Issue { ${ISSUE} }`, fromIssue, " is:issue"], ["DISCUSSION", `... on Discussion { ${DISCUSSION} }`, fromDiscussion, ""]] as const) {
        let after: string | null = null;
        for (let n = 0; n < limit;) {
          const q = `query($q: String!, $after: String) { search(query: $q, type: ${type}, first: 50, after: $after) {
            pageInfo { hasNextPage endCursor } nodes { ${fragment} } } }`;
          const data = await this.graphql(q, { q: `${term}${extra} created:>=${since} is:public`, after });
          const candidates: { node: any; thread: Thread }[] = [];
          for (const node of data.search.nodes) {
            if (node?.repository?.nameWithOwner) this.observeVisibility(node.repository.nameWithOwner, node.repository.visibility);
            if (node?.url && node.repository?.visibility === "PUBLIC") {
              candidates.push({ node, thread: this.observedThread(convert(node, "github-search")) });
              n++;
            }
          }
          for (const entry of candidates) out.push(await this.continuedReplies(entry.node, entry.thread));
          if (!data.search.pageInfo.hasNextPage) break;
          after = data.search.pageInfo.endCursor;
        }
      }
      return out;
    });
  }
}

function githubReplayNote(gh: GitHub, threads: Thread[], note?: string): string | undefined {
  const dates = [...new Set(threads.map((thread) => thread.githubVisibilityObserved?.slice(0, 10)).filter(Boolean))].sort();
  if (!gh.offline || !dates.length) return note;
  const observed = dates.length === 1 ? dates[0] : dates[0] + " to " + dates.at(-1);
  return [note, "historical public visibility observed " + observed].filter(Boolean).join("; ");
}

export async function harvestGitHub(gh: GitHub, repos: string[], since: string, stats: SourceStat[]): Promise<Thread[]> {
  const batches: { stat: SourceStat; all: Thread[]; generic: boolean; search: boolean }[] = [];
  const collect = async (source: string, load: () => Promise<Thread[]>, generic: boolean, search: boolean) => {
    const stat = { source, read: 0, kept: 0 } as SourceStat;
    stats.push(stat);
    try {
      batches.push({ stat, all: await load(), generic, search });
    } catch (e) { stat.note = `failed: ${(e as Error).message.slice(0, 120)}`; }
  };
  for (const repo of repos) {
    const generic = GENERIC_REPOS.has(repo);
    await collect(`GitHub ${repo}`, () => gh.repoThreads(repo, since, generic ? GENERIC_REPO_LIMIT : 2000), generic, false);
  }
  for (const term of GITHUB_SEARCHES) {
    await collect(`GitHub search ${term}`, () => gh.search(term, since, GITHUB_SEARCH_LIMIT), true, true);
  }
  // A later request can withdraw a repository already collected during this run.
  const repoSet = new Set(repos.map((repo) => repo.toLowerCase()));
  const seen = new Set<string>();
  const out: Thread[] = [];
  for (const { stat, all, generic, search } of batches) {
    const visible = all.filter((thread) => gh.keepsThread(thread));
    const kept = visible.filter((thread) =>
      (!search || (!seen.has(thread.url) && !repoSet.has(thread.where.toLowerCase()) && !OWN_ORGS.test(thread.where)))
      && (!generic || isRelevant(thread.title, thread.text)));
    for (const thread of kept) seen.add(thread.url);
    stat.read = visible.length;
    stat.kept = kept.length;
    stat.note = githubReplayNote(gh, kept, search ? "other repositories only" : generic ? "IRL relevance filter" : undefined);
    out.push(...kept);
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
      const all = await rememberThreads(cache, `se:${site}:${tag}:${since}`, async () => {
        const got: Thread[] = [];
        for (let page = 1; page <= 10; page++) {
          const r = await fetcher.json(`https://api.stackexchange.com/2.3/questions?site=${site}&tagged=${encodeURIComponent(tag)}&fromdate=${from}&pagesize=100&page=${page}&order=desc&sort=creation&filter=withbody`);
          got.push(...(r.items ?? []).map((q: any) => fromStackExchange(q, site)));
          if (r.backoff) fetcher.deferPath("https://api.stackexchange.com/2.3/questions", r.backoff);
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
  return s.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, digits: string) => {
    const code = /^x/i.test(digits) ? parseInt(digits.slice(1), 16) : Number(digits);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\uFFFD";
  })
    .replace(/&quot;/g, "\"").replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<(script|style|pre|code)[\s\S]*?<\/\1>/gi, " ").replace(/<\/?[a-z][a-z0-9:-]*(?:\s[^>]*|\/?)>/gi, " "));
}

function xmlText(value: string): string {
  return value.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g)
    .map((part) => part.startsWith("<![CDATA[") ? part.slice(9, -3) : decodeEntities(part)).join("");
}

export type RssItem = { title: string; link: string; date: string; comments: number; text: string };
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?=\\s|>)(?![^>]*\\/\\s*>)[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "";

function feedDate(value: string): string {
  const date = new Date(value.trim());
  return Number.isNaN(+date) ? "" : date.toISOString().slice(0, 10);
}

export function parseRss(xml: string): RssItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, b]) => ({
    title: xmlText(tag(b, "title")).trim(),
    link: xmlText(tag(b, "link")).trim(),
    date: feedDate(xmlText(tag(b, "pubDate"))),
    comments: Number(stripHtml(tag(b, "slash:comments"))) || 0,
    text: stripHtml(xmlText(tag(b, "content:encoded") || tag(b, "description"))),
  }));
}

function xmlAttr(attributes: string, name: string): string {
  const value = attributes.match(new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')"));
  return decodeEntities(value?.[1] ?? value?.[2] ?? "");
}

type XmlElement = {
  name: string; namespace: string; qualified: string; attributes: string;
  namespaces: Record<string, string>; start: number; end: number; children: XmlElement[];
};

function xmlRoot(xml: string): XmlElement | undefined {
  const stack: XmlElement[] = [];
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([\w:.-]+)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
  for (const token of xml.matchAll(tokens)) {
    const [, closing, qualified, attributes] = token;
    if (!qualified) continue;
    const parent = stack.at(-1);
    if (closing) {
      if (parent?.qualified !== qualified) return undefined;
      stack.pop();
      parent.end = token.index;
      if (!stack.length) return parent;
      continue;
    }
    const parts = qualified.split(":");
    const prefix = parts.length === 1 ? "" : parts[0];
    const namespaces = Object.create(parent?.namespaces ?? null) as Record<string, string>;
    for (const declaration of attributes.matchAll(/\sxmlns(?::([\w.-]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      namespaces[declaration[1] ?? ""] = decodeEntities(declaration[2] ?? declaration[3]);
    }
    const start = token.index + token[0].length;
    const node: XmlElement = { qualified, name: parts.at(-1)!, namespace: namespaces[prefix] ?? "", namespaces,
      attributes, start, end: start, children: [] };
    if (parent) parent.children.push(node);
    if (!attributes.trimEnd().endsWith("/")) stack.push(node);
    else if (!parent) return node;
  }
}

function atomChild(node: XmlElement, ...names: string[]): XmlElement | undefined {
  for (const name of names) {
    const child = node.children.find((item) => item.name === name && item.namespace === node.namespace);
    if (child) return child;
  }
}

function atomText(xml: string, node: XmlElement | undefined): string {
  if (!node) return "";
  const content = xml.slice(node.start, node.end);
  const type = xmlAttr(node.attributes, "type");
  if (type === "xhtml") return stripHtml(content);
  const decoded = xmlText(content);
  return type === "html" ? stripHtml(decoded) : decoded;
}

function atomEntryText(xml: string, entry: XmlElement): string {
  const content = atomChild(entry, "content");
  const type = content && xmlAttr(content.attributes, "type");
  const external = content && xmlAttr(content.attributes, "src");
  const text = content && !external && (!type || /^(text|html|xhtml|text\/)/i.test(type)) ? atomText(xml, content) : "";
  return text.trim() ? text : atomText(xml, atomChild(entry, "summary"));
}

export function parseFeed(xml: string, url: string): RssItem[] {
  const feed = xmlRoot(xml);
  if (feed?.name !== "feed" || !["", "http://www.w3.org/2005/Atom"].includes(feed.namespace)) return parseRss(xml);
  const feedBase = new URL(xmlAttr(feed.attributes, "xml:base") || url, url);
  const items: RssItem[] = [];
  for (const entry of feed.children) {
    if (entry.name !== "entry" || entry.namespace !== feed.namespace) continue;
    for (const link of entry.children) {
      if (link.name !== "link" || link.namespace !== feed.namespace) continue;
      const href = xmlAttr(link.attributes, "href");
      if (!href || !["", "alternate"].includes(xmlAttr(link.attributes, "rel"))) continue;
      let page: URL;
      try {
        const entryBase = new URL(xmlAttr(entry.attributes, "xml:base") || feedBase.href, feedBase);
        const linkBase = new URL(xmlAttr(link.attributes, "xml:base") || entryBase.href, entryBase);
        page = new URL(href, linkBase);
      } catch { continue; }
      if (!["http:", "https:"].includes(page.protocol) || page.username || page.password) continue;
      items.push({
        title: atomText(xml, atomChild(entry, "title")).trim(),
        link: page.href,
        date: feedDate(atomText(xml, atomChild(entry, "published", "updated"))),
        comments: Number(atomText(xml, entry.children.find((child) =>
          child.name === "total" && (child.namespace === "http://purl.org/syndication/thread/1.0" || child.qualified === "thr:total")))) || 0,
        text: atomEntryText(xml, entry),
      });
      break;
    }
  }
  return items;
}

export async function harvestForums(fetcher: Fetcher, cache: Cache, since: string, stats: SourceStat[]): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const feed of FORUM_FEEDS) {
    try {
      const key = `forum-threads:${feed.url}`;
      const legacy = cache.offline && !cache.entry(key)
        ? cache.get<Thread[]>(`threads-v2:rss:${feed.url}`, 20) ?? cache.get<Thread[]>(`rss:${feed.url}`, 20) : undefined;
      const all = legacy ?? await cache.remember(key, 20, async () => {
        const document = await fetcher.document(feed.url);
        return parseFeed(document.text, document.url).map((i): Thread => ({
          id: `forum:${i.link}`, source: "forum", where: feed.name, url: i.link, title: i.title, created: i.date, updated: i.date, type: "thread",
          labels: [], category: null, open: true, closedAs: null, accepted: false, upvotedAnswer: false, maintainerReplied: false,
          replies: i.comments, score: 0, byMaintainer: false, text: sanitize(i.text),
        }));
      });
      const kept = all.filter((t) => t.created >= since && isRelevant(t.title, t.text));
      stats.push({ source: feed.name, read: all.length, kept: kept.length, note: "latest posts in the feed; IRL relevance filter" + (legacy ? "; older forum-feed cache" : "") });
      out.push(...kept);
    } catch (e) { stats.push({ source: feed.name, read: 0, kept: 0, note: `failed: ${(e as Error).message.slice(0, 120)}` }); }
  }
  return out;
}
