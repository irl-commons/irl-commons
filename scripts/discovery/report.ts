// Markdown reports for people. They list titles, links, dates and states; never names of people.
import { NOT_READ, THEMES } from "./config.ts";
import { covered, type Sorted } from "./classify.ts";
import type { SourceStat } from "./harvest.ts";

const themeLabel = new Map(THEMES.map((t) => [t.id, t.label]));
themeLabel.set("other", "Other or unclear");
const md = (s: string) => s.replace(/([\[\]|*_`<>])/g, "\\$1");
const link = (s: { title: string; url: string }) => `[${md(s.title.slice(0, 110))}](${s.url})`;

function daysBetween(a: string, b: string) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400_000); }

function sourcesTable(stats: SourceStat[]): string[] {
  const out = ["| Source | Read | Kept | Note |", "| --- | ---: | ---: | --- |"];
  for (const s of stats) out.push(`| ${md(s.source)} | ${s.read} | ${s.kept} | ${md(s.note ?? "")} |`);
  out.push("", "Not read:", "", ...NOT_READ.map((n) => `- ${n.source}: ${n.reason}`));
  return out;
}

/** Threads that describe a user's problem or question: not feature requests, not developer reports, not the maintainers' own notes. */
export const isSupport = (s: Sorted) => !s.byMaintainer && s.kind !== "feature" && s.kind !== "dev";
const answeredElsewhere = (s: Sorted) => isSupport(s) && (s.answered === "answered" || (s.answered === "maintainer-replied" && s.open)) && !covered(s);
/** A question answered in public but not by this project. */
export const isCheapWin = (s: Sorted) => answeredElsewhere(s) && s.kind === "question";
/** A problem report with a public resolution (a fix, a workaround or a maintainer's explanation). */
export const isResolvedProblem = (s: Sorted) => answeredElsewhere(s) && s.kind === "problem";
export const isOpenGap = (s: Sorted) => isSupport(s) && s.kind === "question" && s.open && (s.answered === "unanswered" || s.answered === "replied") && !covered(s);

const rank = (a: Sorted, b: Sorted) => (b.score + b.replies) - (a.score + a.replies) || b.created.localeCompare(a.created);
const describe = (s: Sorted) => `${s.where}, ${s.created}, ${s.answered}${s.coverage !== "none" ? `, has ${s.coverage}` : ""}`;

export type ThemeRow = { theme: string; label: string; threads: number; uncovered: number; cheap: number; resolved: number; open: number; newest: string; recent: number; examples: Sorted[] };

export function themeRows(items: Sorted[], today: string): ThemeRow[] {
  const by = new Map<string, Sorted[]>();
  for (const s of items.filter(isSupport)) by.set(s.theme, [...(by.get(s.theme) ?? []), s]);
  return [...by.entries()].map(([theme, xs]) => {
    const unc = xs.filter((s) => !covered(s));
    return {
      theme, label: themeLabel.get(theme) ?? theme, threads: xs.length, uncovered: unc.length,
      cheap: xs.filter(isCheapWin).length, resolved: xs.filter(isResolvedProblem).length, open: xs.filter(isOpenGap).length,
      newest: xs.map((s) => s.created).sort().at(-1) ?? "",
      recent: xs.filter((s) => daysBetween(s.created, today) <= 90).length,
      examples: [...unc].sort(rank).slice(0, 2),
    };
  }).sort((a, b) => b.uncovered - a.uncovered || b.threads - a.threads);
}

export function questionsReport(items: Sorted[], stats: SourceStat[], opts: { today: string; since: string }): string {
  const support = items.filter(isSupport);
  const count = <K extends string>(xs: Sorted[], f: (s: Sorted) => K) => xs.reduce((m, s) => m.set(f(s), (m.get(f(s)) ?? 0) + 1), new Map<K, number>());
  const fmt = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  const out: string[] = [
    "# Public IRL streaming questions: coverage report", "",
    `Run on ${opts.today}, threads created since ${opts.since}. Read-only: nothing in data/ was changed. Matching is by plain word lists (see Method).`, "",
    "## Sources", "", ...sourcesTable(stats), "",
    "## Totals", "",
    `- Threads kept: ${items.length} (${fmt(count(items, (s) => s.kind))}).`,
    `- Opened by the projects' own maintainers, left out below: ${items.filter((s) => s.byMaintainer).length}.`,
    `- Support threads (questions and problems): ${support.length}. Answer state: ${fmt(count(support, (s) => s.answered))}.`,
    `- Coverage of support threads: ${fmt(count(support, (s) => s.coverage))}. "answer" and "guide" count as covered.`, "",
    "## Themes", "",
    "Sorted by threads not covered. Cheap wins: questions answered elsewhere (marked answer, maintainer reply, or closed as done after one) but not covered here. Resolved problems: the same for problem reports, usually a fix or a workaround. Open: questions still open with no maintainer answer.", "",
    "| Theme | Threads | Not covered | Cheap wins | Resolved problems | Open | Newest | Last 90 days | Examples |", "| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |",
  ];
  for (const r of themeRows(items, opts.today))
    out.push(`| ${r.label} | ${r.threads} | ${r.uncovered} | ${r.cheap} | ${r.resolved} | ${r.open} | ${r.newest} | ${r.recent} | ${r.examples.map((e) => `[${md(e.title.slice(0, 50))}](${e.url})`).join("<br>")} |`);

  const section = (title: string, intro: string, pick: (s: Sorted) => boolean, per = 6) => {
    out.push("", `## ${title}`, "", intro);
    const by = new Map<string, Sorted[]>();
    for (const s of items.filter(pick)) by.set(s.theme, [...(by.get(s.theme) ?? []), s]);
    for (const [theme, xs] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
      out.push("", `### ${themeLabel.get(theme) ?? theme} (${xs.length})`, "");
      for (const s of xs.sort(rank).slice(0, per)) out.push(`- ${link(s)} (${describe(s)}; theme words: ${s.themeWhy.slice(0, 4).join(", ") || "none"})`);
      if (xs.length > per) out.push(`- and ${xs.length - per} more in questions.json`);
    }
  };
  section("Cheap wins", "Questions answered in public, not by this project. A quick check, a word or a guide link could carry the answer.", isCheapWin);
  section("Resolved problems", "Problem reports with a public resolution and no cover here. Worth a look for workarounds a check could name; many are plain bug fixes.", isResolvedProblem, 4);
  section("Open questions without an answer", "Still open, no maintainer reply, not covered here. A guide or a check would help most.", isOpenGap);

  out.push("", "## Existing quick checks that match", "", "How often each answers.json entry matched a support thread. Low counts may mean narrow phrasing.", "",
    "| Answer | Threads | Example |", "| --- | ---: | --- |");
  const byAnswer = new Map<string, Sorted[]>();
  for (const s of support) for (const a of s.answers) byAnswer.set(a.id, [...(byAnswer.get(a.id) ?? []), s]);
  for (const [id, xs] of [...byAnswer.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const e = xs.sort(rank)[0];
    out.push(`| ${id} | ${xs.length} | ${link(e)} (${e.answers.find((a) => a.id === id)?.why}) |`);
  }

  out.push("", "## Glossary words in threads not covered", "", "Words already explained in words.json that appear in uncovered threads: linking them from a check or guide is cheap.", "");
  const wordCount = new Map<string, number>();
  for (const s of support.filter((s) => !covered(s))) for (const w of s.words) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  out.push([...wordCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w, n]) => `${w} ${n}`).join(", ") || "None.");

  out.push("", "## Frequent title words in threads not covered", "", "Word pairs from titles, for spotting topics the themes miss. Not glossary terms yet.", "");
  const pairs = new Map<string, number>();
  for (const s of support.filter((s) => !covered(s))) {
    const ws = s.title.toLowerCase().replace(/[^a-z0-9.+ ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|with|not|when|from|does|can|how|why|what|this|that|after|into|using|use|but|are|you|was|have|has|any|its|get|while)$/.test(w));
    for (const p of new Set(ws.slice(1).map((w, i) => `${ws[i]} ${w}`))) pairs.set(p, (pairs.get(p) ?? 0) + 1);
  }
  out.push([...pairs.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([p, n]) => `"${p}" ${n}`).join(", ") || "None.");

  out.push("", "## By product", "", "| Product | Support threads | Not covered | Feature requests |", "| --- | ---: | ---: | ---: |");
  const prod = new Map<string, { t: number; u: number; f: number }>();
  for (const s of items.filter((s) => isSupport(s) || (!s.byMaintainer && s.kind === "feature"))) for (const p of s.products.length ? s.products : ["(none named)"]) {
    const r = prod.get(p) ?? { t: 0, u: 0, f: 0 };
    if (s.kind === "feature") r.f++; else { r.t++; if (!covered(s)) r.u++; }
    prod.set(p, r);
  }
  for (const [p, r] of [...prod.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 30)) out.push(`| ${p} | ${r.t} | ${r.u} | ${r.f} |`);

  out.push("", "## Method", "",
    "- Kind: labels first, then discussion category, then the title (a question word or a question mark is a question; add, allow or feature request is a feature; explicit code references, security findings and builds are developer reports). Otherwise an issue counts as a problem and a discussion or forum thread as a question.",
    "- Answer state: answered means a marked answer, an upvoted Stack Exchange answer, or closed as done after a maintainer reply. Maintainers are owners, members and collaborators of the repository.",
    "- Theme: the theme in config.ts with the most pattern hits (title hits count twice).",
    "- Coverage: answer when a symptom phrase in config.ts for an answers.json entry matches; guide when a guide covers a named product at the theme's part of the chain and shares a glossary word or check with the thread; related-guide when a guide covers the product but not this topic; word when only a glossary name appears. Generic glossary names never count.",
    "- Threads from large general projects, searches, Stack Exchange and forums are kept only when they show IRL signs (config.ts RELEVANCE_STRONG and RELEVANCE_CONTEXT): a strong one, two in all, one in the title.",
    "- Every thread with its reasons is in questions.json next to this report.");
  return out.join("\n") + "\n";
}
