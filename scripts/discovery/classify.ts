// Sorting harvested threads: question or bug report, answered or not, which theme,
// and what in the project already covers it. Every decision keeps its reason.
import { RELEVANCE_CONTEXT, RELEVANCE_STRONG, THEMES, type Part } from "./config.ts";
import { tokens, type Index } from "./project.ts";

/** One public thread, reduced to what the report needs. No names of people. */
export type Thread = {
  id: string;                 // source-specific stable key
  source: "github" | "github-search" | "stackexchange" | "forum";
  where: string;              // repository, site or board
  url: string;
  title: string;
  created: string;            // ISO date
  updated: string;
  type: "issue" | "discussion" | "question" | "thread";
  labels: string[];
  category: string | null;    // discussion category
  open: boolean;
  closedAs: "completed" | "not-planned" | "duplicate" | null;
  accepted: boolean;          // a marked answer (discussion or Stack Exchange)
  upvotedAnswer: boolean;     // Stack Exchange: an answer with a positive score
  maintainerReplied: boolean;
  replies: number;
  score: number;              // reactions, upvotes or Stack Exchange score
  byMaintainer: boolean;      // opened by the project's own people
  text: string;               // sanitized start of the body, for matching and local review
};

export type Kind = "question" | "problem" | "feature" | "dev" | "other";
export type Answered = "answered" | "maintainer-replied" | "replied" | "unanswered" | "closed-unanswered";
export type Coverage = "answer" | "guide" | "related-guide" | "word" | "none";

export type Sorted = Thread & {
  kind: Kind; kindWhy: string;
  answered: Answered;
  theme: string; themeWhy: string[];
  part: Part | null;
  products: string[];
  answers: { id: string; why: string }[];
  guides: string[];
  words: string[];
  coverage: Coverage;
};

// ---------- privacy ----------

/** Remove things that identify people or setups: links, addresses, keys, handles, e-mail. */
export function sanitize(text: string, max = 600): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[link]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]")
    .replace(/(^|\s)@[A-Za-z0-9_-]+/g, "$1[user]")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, "[address]")
    .replace(/\b[0-9a-f]{0,4}(:[0-9a-f]{0,4}){3,7}\b/gi, "[address]")
    .replace(/\b(streamid|stream_id|key|token|password|passphrase|secret)\s*[=:]\s*\S+/gi, "$1=[hidden]")
    .replace(/\b(live|sk|ghp|gho)_[A-Za-z0-9_]{8,}\b/g, "[hidden]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ---------- relevance ----------

const strong = RELEVANCE_STRONG.map((r) => new RegExp(r, "i"));
const context = RELEVANCE_CONTEXT.map((r) => new RegExp(r, "i"));
const noSubtitles = (t: string) => t.replace(/\b(subtitles?|captions?)\b.{0,40}\bsrt\b|\bsrt\b.{0,40}\b(subtitles?|captions?|files?)\b/gi, " ");

/** The IRL signs a text shows, strong ones first. */
export function relevanceHits(text: string): { strong: string[]; context: string[] } {
  const t = noSubtitles(text);
  const hits = (res: RegExp[]) => res.map((r) => r.exec(t)?.[0].toLowerCase()).filter((x): x is string => !!x);
  return { strong: hits(strong), context: hits(context) };
}

/** A thread from a general source: a strong sign, two signs in all, one of them in the title. */
export function isRelevant(title: string, text = ""): boolean {
  const all = relevanceHits(`${title}\n${text}`), inTitle = relevanceHits(title);
  return all.strong.length >= 1 && all.strong.length + all.context.length >= 2 && inTitle.strong.length + inTitle.context.length >= 1;
}

// ---------- kind and answer state ----------

const Q_START = /^(how|what|why|where|which|when|who|can|could|is|are|does|do|did|should|would|will|any|anyone|has anyone|need help|help|question|is there|possible)\b/i;
const FEATURE_PREFIX = /^\s*\[?(feature|feat|fr|request|enhancement|suggestion|proposal|idea|wish)\b|\b(feature request)\b/i;
const FEATURE_TITLE = /^\s*(add|allow|support|expose|make|enable|option to|ability to|implement|show|let)\b|\b(please add|would be (nice|great|helpful)|support for)\b/i;
/** Reports written for developers: code names, security findings, builds and dependencies. */
const CODE_NAME = /`[^`]+`|\b[a-z]{2,}[A-Z][A-Za-z]+\b|\b[a-z]+_[a-z_]+\b|\b[A-Z0-9]+_[A-Z0-9_]+\b|^\s*(HIGH|MEDIUM|LOW|CRITICAL)\s*:|\b(fix|feat|chore|docs|refactor)\(/;
const DEV_WORDS = /\b(bump|dependency dashboard|dependencies|refactor\w*|ci|compile\w*|unit tests?|security|cve|ssrf|denial of service|bypass\w*|leaks?|race condition|deadlock|memory|main (actor|queue|thread)|retains?|allocat\w*|traverses|upstream: merge|spike|epic|unauthenticated|exhaust\w*|brute.?force|spoof\w*|hijack\w*|injection|siphon|privilege|world.readable|rate.?limit\w*)\b|^\s*(docs?|chore|ci|build|test)\s*:/i;
const isDevTitle = (title: string) => CODE_NAME.test(title) || DEV_WORDS.test(title);

export function kindOf(t: Pick<Thread, "title" | "labels" | "category" | "type">): { kind: Kind; why: string } {
  const labels = t.labels.map((l) => l.toLowerCase());
  const title = t.title.trim();
  if (labels.some((l) => /question|support|help|how.?to|usage/.test(l))) return { kind: "question", why: "label" };
  if (t.category && /q\s*&\s*a|q&a|help|support|question/i.test(t.category)) return { kind: "question", why: `category ${t.category}` };
  if (t.category && /idea|feature|request|suggest/i.test(t.category)) return { kind: "feature", why: `category ${t.category}` };
  if (labels.some((l) => /enhancement|feature|request|idea|suggestion/.test(l))) return { kind: "feature", why: "label" };
  if (labels.some((l) => /dependenc|security|chore|refactor|ci\b|build|internal|tech.?debt/.test(l)) || isDevTitle(title)) return { kind: "dev", why: "developer report" };
  if (labels.some((l) => /bug|crash|regression|defect/.test(l))) return { kind: "problem", why: "label" };
  if (FEATURE_PREFIX.test(title)) return { kind: "feature", why: "title" };
  if (/^\s*\[?(question|help|support|q)\b[\]:)]?/i.test(title) || Q_START.test(title) || /\?\s*$/.test(title)) return { kind: "question", why: "title" };
  if (FEATURE_TITLE.test(title)) return { kind: "feature", why: "title" };
  if (/^\s*\[?(bug|crash|issue|fehler|problema?)\b[\]:)]?/i.test(title)) return { kind: "problem", why: "title" };
  if (t.type === "question" || t.type === "thread" || t.type === "discussion") return { kind: "question", why: `${t.type} default` };
  if (t.type === "issue") return { kind: "problem", why: "issue default" };
  return { kind: "other", why: "no signal" };
}

export function answeredOf(t: Thread): Answered {
  if (t.accepted || t.upvotedAnswer) return "answered";
  if (!t.open && t.closedAs === "completed" && t.maintainerReplied) return "answered";
  if (t.maintainerReplied) return "maintainer-replied";
  if (t.replies > 0) return "replied";
  return t.open ? "unanswered" : "closed-unanswered";
}

// ---------- themes and coverage ----------

const themes = THEMES.map((th) => ({ ...th, res: th.patterns.map((p) => new RegExp(p, "i")) }));

export function themeOf(title: string, text: string): { theme: string; part: Part | null; why: string[] } {
  let best: { theme: string; part: Part | null; why: string[]; score: number } = { theme: "other", part: null, why: [], score: 0 };
  for (const th of themes) {
    let score = 0;
    const why: string[] = [];
    for (const re of th.res) {
      const inTitle = re.exec(title), inText = inTitle ? null : re.exec(text);
      if (inTitle) { score += 2; why.push(inTitle[0].toLowerCase()); } else if (inText) { score += 1; why.push(inText[0].toLowerCase()); }
    }
    if (score > best.score) best = { theme: th.id, part: th.part, why, score };
  }
  return { theme: best.theme, part: best.part, why: best.why };
}

const ANSWERED_BY_OVERLAP = 3;

export function sortThread(t: Thread, index: Index): Sorted {
  const { kind, why: kindWhy } = kindOf(t);
  const hay = `${t.title}\n${t.text}`;
  const words = [...new Set(index.words.filter((w) => !w.generic && w.re.test(hay)).map((w) => w.id))];
  const products = new Set<string>();
  const repo = index.repoProduct.get(t.where.toLowerCase());
  if (repo) products.add(repo);
  let rest = hay;
  for (const p of index.products) if (p.re.test(rest)) { products.add(p.id); rest = rest.replace(new RegExp(p.re.source, "gi"), " "); }
  const { theme, part, why: themeWhy } = themeOf(t.title, t.text);

  const answers: { id: string; why: string }[] = [];
  const own = tokens(hay);
  for (const a of index.answers) {
    if (a.hints.length) {
      const hit = a.hints.map((h) => h.exec(hay)).find(Boolean);
      if (hit) answers.push({ id: a.id, why: `phrase "${hit[0].toLowerCase().slice(0, 60)}"` });
    } else {
      const shared = [...a.tokens].filter((x) => own.has(x));
      if (shared.length >= ANSWERED_BY_OVERLAP && a.words.some((w) => words.includes(w))) answers.push({ id: a.id, why: `shared words ${shared.slice(0, 5).join(", ")}` });
    }
  }
  // A guide covers a thread when it is about a product the thread names, at the thread's part
  // of the chain, and shares a glossary word or quick check with it. Otherwise it is only related.
  const guides: string[] = [], related: string[] = [];
  for (const g of index.guides) {
    if (!g.covers.some((c) => products.has(c))) continue;
    const sharesTopic = g.words.some((w) => words.includes(w)) || g.answers.some((a) => answers.some((x) => x.id === a));
    if (part && g.part.includes(part) && sharesTopic) guides.push(g.id); else related.push(g.id);
  }
  const coverage: Coverage = answers.length ? "answer" : guides.length ? "guide" : related.length ? "related-guide" : words.length ? "word" : "none";
  return { ...t, kind, kindWhy, answered: answeredOf(t), theme, themeWhy, part, products: [...products], answers, guides: guides.length ? guides : related, words, coverage };
}

/** Covered well enough that a reader would find the answer in the project today. */
export const covered = (s: Sorted) => s.coverage === "answer" || s.coverage === "guide";
