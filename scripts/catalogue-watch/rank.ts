// Ranking entries for a human recheck. Pure: takes the entries, this run's snapshot and the
// baseline snapshot, and explains every point of the score.
import { due, months } from "../stale.ts";
import { resourceKey, type Entry, type Resource, type Role } from "./sources.ts";
import { lineDiff, quote } from "./text.ts";
import type { Snapshot } from "./signals.ts";

export type Reason = { weight: number; text: string; detail?: string[] };
export type Assessment = { entry: Entry; score: number; reasons: Reason[]; unchecked: string[]; baseline: string | null };

/** The first snapshot taken on or after the entry's check: what the sources looked like when a person last compared them. */
export function pickBaseline(dates: string[], checkedOn: string): string | null {
  return [...dates].sort().find(d => d >= checkedOn) ?? null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const bareHost = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
const licenceKey = (s: string) => s.toLowerCase().replace(/-(only|or-later)$/, "").replace(/[^a-z0-9.]+/g, "");
/** GitHub reports one SPDX id; the entry may name several (dual licences, several repositories). */
export const licenceMentioned = (entry: string, spdx: string) =>
  entry.split(/[^A-Za-z0-9.+-]+/).some(t => t && licenceKey(t) === licenceKey(spdx));
/** Redirects that don't move a page: www, a trailing slash, http to https. */
const trivialRedirect = (a: string, b: string) => {
  try { const x = new URL(a), y = new URL(b); return x.host.replace(/^www\./, "") === y.host.replace(/^www\./, "") && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "") && x.search === y.search; }
  catch { return false; }
};

const PAGE_GONE: Record<Role, number> = { main: 50, link: 30, source: 30, "fact-source": 20, support: 25, "channel-source": 25 };
const PAGE_TEXT: Record<Role, number> = { main: 20, link: 14, source: 14, "fact-source": 12, "channel-source": 6, support: 3 };
const label: Record<Role, string> = { main: "main page", link: "official link", source: "source", "fact-source": "comparison-fact source", support: "support page", "channel-source": "page that publishes a support channel" };

function diffDetail(before: string | null, after: string | null, max = 8): { detail: string[]; size: number } {
  if (before === null || after === null) return { detail: [], size: 0 };
  const d = lineDiff(before, after);
  const detail = [...d.removed.slice(0, max / 2).map(l => `- ${l}`), ...d.added.slice(0, max / 2).map(l => `+ ${l}`)].map(l => l.length > 200 ? l.slice(0, 199) + "…" : l);
  const more = d.added.length + d.removed.length - detail.length;
  if (more > 0) detail.push(`(${more} more changed lines)`);
  return { detail, size: d.added.length + d.removed.length };
}
const sized = (w: number, size: number) => Math.round(w * (size === 0 ? 1 : size <= 2 ? 0.5 : size <= 10 ? 1 : 1.4));

export function assess(e: Entry, cur: Snapshot, base: Snapshot | null, today: string, readText: (hash: string) => string | null): Assessment {
  const reasons: Reason[] = [];
  const unchecked: string[] = [];
  const checked = e.checked_on;
  const add = (weight: number, text: string, detail?: string[]) => { if (weight > 0) reasons.push({ weight, text, ...(detail?.length ? { detail } : {}) }); };

  const resources: Resource[] = [...e.resources];
  for (const id of cur.linked[e.key]?.apps ?? []) if (!resources.some(r => r.type === "app" && r.id === id)) resources.push({ type: "app", id, role: "link" });
  for (const id of cur.linked[e.key]?.play ?? []) if (!resources.some(r => r.type === "play" && r.id === id)) resources.push({ type: "play", id, role: "link" });

  for (const r of resources) {
    const main = r.role === "main";
    if (r.type === "page") {
      const p = cur.pages[r.url];
      if (!p) continue;
      const was = base?.pages[r.url];
      if (p.problem?.startsWith("robots")) { unchecked.push(`${r.url}: robots.txt asks automated clients not to fetch it`); continue; }
      if (p.problem) {
        if (main && /ENOTFOUND|resolve|DNS|refused/i.test(p.problem)) add(25, `${label[r.role]} did not answer (${quote(p.problem, 80)}): ${r.url}`);
        else unchecked.push(`${r.url}: ${p.problem}`);
        continue;
      }
      if (p.status === 404 || p.status === 410) { add(PAGE_GONE[r.role], `${label[r.role]} returns ${p.status}: ${r.url}`); continue; }
      if ([401, 403, 429, 503].includes(p.status)) { unchecked.push(`${r.url}: status ${p.status}; the site may block automated requests`); continue; }
      if (p.status >= 400) { add(main ? 15 : 8, `${label[r.role]} returns ${p.status}: ${r.url}`); continue; }
      if (!trivialRedirect(p.finalUrl, r.url) && !(was && sameUrl(was.finalUrl, p.finalUrl))) {
        const otherHost = bareHost(p.finalUrl) !== bareHost(r.url);
        const login = /\/(?:login|signin|sign-in|auth)\b/i.test(new URL(p.finalUrl).pathname);
        const w = login ? 2 : otherHost ? (main ? 30 : 15) : (main ? 8 : 4);
        if (r.role !== "support" || otherHost) add(w, `${label[r.role]} ${was ? "now redirects" : "redirects"} ${login ? "to a login page" : otherHost ? "to another site" : "within the site"}: ${r.url} → ${p.finalUrl}`);
      }
      const shell = p.scriptShell ? " (the page is mostly scripts; its static text says little)" : "";
      if (was?.textHash && p.textHash && was.textHash !== p.textHash) {
        const { detail, size } = diffDetail(readText(was.textHash), readText(p.textHash));
        const w = sized(PAGE_TEXT[r.role], size) * (p.scriptShell ? 0.3 : 1);
        add(Math.round(w), `${label[r.role]} text changed since ${base!.date} (${size} lines)${shell}: ${r.url}`, detail);
      }
      if (p.declaredModified && p.declaredModified > checked && p.declaredModified <= today && r.role !== "support")
        add(main ? 8 : 4, `${label[r.role]} says it was modified on ${p.declaredModified}, after the check on ${checked}: ${r.url}`);
    }
    if (r.type === "repo") {
      const g = cur.repos[r.repo.toLowerCase()];
      if (!g) continue;
      const was = base?.repos[r.repo.toLowerCase()];
      const at = `https://github.com/${g.fullName ?? r.repo}`;
      if (g.problem) { unchecked.push(`github.com/${r.repo}: ${g.problem}`); continue; }
      if (g.status === 404) { add(main ? 50 : 30, `repository ${r.repo} is gone or private`); continue; }
      if (g.status !== 200) { unchecked.push(`github.com/${r.repo}: status ${g.status}`); continue; }
      if (g.archived) add(60, `repository ${r.repo} is archived: ${at}`);
      if (g.disabled) add(60, `repository ${r.repo} is disabled`);
      if (g.fullName && g.fullName.toLowerCase() !== r.repo.toLowerCase()) add(20, `repository ${r.repo} moved to ${g.fullName}`);
      if ((main || r.role === "link") && e.dataset === "services" && e.kind !== "community") {
        if (e.licence && g.license && g.license !== "NOASSERTION" && !licenceMentioned(e.licence, g.license))
          add(35, `GitHub reports licence ${g.license} for ${r.repo}; the entry says ${quote(e.licence, 60)}`);
        if (!e.licence && g.license && g.license !== "NOASSERTION" && main)
          add(10, `GitHub reports licence ${g.license} for ${r.repo}; the entry has none`);
      }
      const relW = main ? 25 : 12;
      if (g.release?.date && g.release.date > checked) add(relW, `release ${quote(g.release.tag, 40)} published ${g.release.date}, after the check on ${checked}: ${at}/releases`);
      else if (was?.release && g.release && was.release.tag !== g.release.tag) add(relW, `new release ${quote(g.release.tag, 40)} since ${base!.date} (was ${quote(was.release.tag, 40)})`);
      if (!g.release && was && was.latestTag !== g.latestTag && g.latestTag) add(main ? 10 : 5, `new tag ${quote(g.latestTag, 40)} since ${base!.date}`);
      if (g.readme) {
        const changedAfter = g.readme.changedOn && g.readme.changedOn > checked;
        const textChanged = was?.readme && was.readme.textHash !== g.readme.textHash;
        if (changedAfter || textChanged) {
          const { detail, size } = textChanged ? diffDetail(readText(was!.readme!.textHash), readText(g.readme.textHash)) : { detail: [], size: 0 };
          const w = sized(main ? 18 : 10, size);
          add(w, `${g.readme.path} ${changedAfter ? `last changed ${g.readme.changedOn}, after the check on ${checked}` : `changed since ${base!.date}`}${size ? ` (${size} lines differ from ${base!.date})` : ""}: ${at}`, detail);
        }
      }
      if (main && g.pushedAt && g.pushedAt.slice(0, 10) > checked) add(4, `commits pushed since the check (last push ${g.pushedAt.slice(0, 10)})`);
      if (was && was.description !== g.description) add(10, `repository description changed: ${quote(was.description, 80)} → ${quote(g.description, 80)}`);
      if (was && was.homepage !== g.homepage) add(12, `repository homepage changed: ${quote(was.homepage, 80)} → ${quote(g.homepage, 80)}`);
    }
    if (r.type === "file") {
      const f = cur.files[resourceKey(r)];
      if (!f || f.pinned) continue;
      const was = base?.files[resourceKey(r)];
      const where = `github.com/${r.repo}/${r.dir ? "tree" : "blob"}/${r.ref}/${r.path}`;
      if (f.problem) { unchecked.push(`${where}: ${f.problem}`); continue; }
      if (f.status === 404) { add(main ? 40 : 25, `${r.path} is gone from ${r.repo} (${r.ref})`); continue; }
      const changedAfter = f.changedOn && f.changedOn > checked;
      const textChanged = was?.textHash && f.textHash && was.textHash !== f.textHash;
      if (changedAfter || textChanged) {
        const { detail, size } = textChanged ? diffDetail(readText(was!.textHash!), readText(f.textHash!)) : { detail: [], size: 0 };
        // Docs and directories say more about the product than build or code files do.
        const doc = r.dir || /\.(md|markdown|txt|rst|adoc)$/i.test(r.path) || /licen[cs]e/i.test(r.path);
        add(Math.round(sized(main ? 18 : 12, size) * (doc ? 1 : 0.4)), `${r.path} in ${r.repo} ${changedAfter ? `last changed ${f.changedOn}, after the check on ${checked}` : `changed since ${base!.date}`}: https://${where}`, detail);
      }
    }
    if (r.type === "app") {
      const a = cur.apps[r.id];
      if (!a) continue;
      const was = base?.apps[r.id];
      const from = r.role === "link" && !e.resources.includes(r) ? " (listing linked from the maker's page)" : "";
      const at = `https://apps.apple.com/us/app/id${r.id}`;
      if (a.listed === null) { unchecked.push(`App Store ${r.id}: ${a.problem ?? "lookup failed"}`); continue; }
      if (!a.listed) { add(was?.listed === false ? 30 : 60, `App Store lookup (US store) no longer finds ${r.id}${from}: ${at}`); continue; }
      if (a.releaseDate && a.releaseDate > checked) add(from ? 12 : 15, `App Store version ${quote(a.version, 30)} released ${a.releaseDate}, after the check on ${checked}${from}: ${at}`);
      else if (was?.version && was.version !== a.version) add(12, `App Store version changed ${quote(was.version, 30)} → ${quote(a.version, 30)}${from}`);
      if (was?.seller && was.seller !== a.seller) add(30, `App Store seller changed: ${quote(was.seller, 60)} → ${quote(a.seller, 60)}`);
      if (was?.name && was.name !== a.name) add(15, `App Store name changed: ${quote(was.name, 60)} → ${quote(a.name, 60)}`);
      if (was?.price && was.price !== a.price) add(10, `App Store price changed: ${quote(was.price, 20)} → ${quote(a.price, 20)}`);
    }
    if (r.type === "play") {
      const p = cur.play[r.id];
      if (!p) continue;
      if (p.listed === false) add(50, `Google Play listing ${r.id} returns 404`);
      else if (p.listed === null) unchecked.push(`Google Play ${r.id}: ${p.problem ?? `status ${p.status}`}`);
    }
    if (r.type === "discord") {
      const inv = cur.invites[r.url];
      if (!inv) continue;
      if (inv.valid === false) add(40, `Discord invite is no longer valid: ${r.url}`);
      else if (inv.valid === null) unchecked.push(`${r.url}: ${inv.problem ?? "invite not checked"}`);
      const seen = r.source ? cur.channelSeen[`${r.url}|${r.source}`] : undefined;
      if (seen === false) add(20, `the page cited for the Discord invite no longer shows it: ${r.source}`);
    }
  }

  // Freshness, with the same windows as stale.ts.
  const window = months[e.dataset];
  const deadline = due(checked, { months: window });
  if (today >= deadline) add(30 + Math.min(30, Math.floor(daysBetween(deadline, today) / 7)), `stale since ${deadline} (checked ${checked}, ${window}-month window)`);
  else if (daysBetween(today, deadline) <= 30) add(8, `due for its ${window}-month recheck on ${deadline}`);
  if (e.status) {
    const statusDue = due(checked, { days: 90 });
    if (today >= statusDue) add(15, `release stage ${quote(e.status, 30)} stale since ${statusDue} (90-day window)`);
    else if (daysBetween(today, statusDue) <= 21) add(5, `release stage ${quote(e.status, 30)} due ${statusDue}`);
  }

  // Many small signals of one kind shouldn't outrank one strong signal: after the top three, reasons count half.
  reasons.sort((a, b) => b.weight - a.weight);
  const age = Math.max(0, daysBetween(checked, today));
  const score = Math.round(reasons.reduce((s, r, i) => s + (i < 3 ? r.weight : r.weight / 2), 0) + age / 60);
  return { entry: e, score, reasons, unchecked: [...new Set(unchecked)], baseline: base?.date ?? null };
}

const fence = (lines: string[]) => ["  ~~~diff", ...lines.map(l => "  " + l.replace(/~~~/g, "~ ~ ~").replace(/\s+/g, " ")), "  ~~~"];

export function renderRecheck(list: Assessment[], meta: { date: string; snapshots: string[]; stats: string[]; limit?: number }): string {
  const ranked = list.filter(a => a.reasons.length).sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key));
  const quiet = list.filter(a => !a.reasons.length);
  const previous = meta.snapshots.filter(d => d < meta.date);
  const lines: string[] = [];
  lines.push("# Recheck these first", "");
  lines.push(`Run on ${meta.date}. ${previous.length ? `Text and listing changes compare each entry with the first run on or after its check date (runs so far: ${[...previous, meta.date].join(", ")}).` : "First run: it is the baseline. Changes in page text can only show from the next run; this ranking uses dates the sources publish (releases, README commits, store versions) against each entry's check date, plus link, invite and freshness signals."}`, "");
  lines.push("These are machine signals, not checks. A signal says where to look first; an entry without signals is not checked either. Nothing here is a check date: `checked_on` changes only when a person compares the entry with its source.", "");
  const limit = meta.limit ?? 40;
  lines.push("| Rank | Entry | Score | Checked on | Strongest reasons |", "| ---: | --- | ---: | --- | --- |");
  ranked.slice(0, limit).forEach((a, i) => {
    const top = a.reasons.slice(0, 2).map(r => r.text.replace(/\|/g, "\\|").replace(/: https:\/\/\S+$/, "")).join("; ");
    lines.push(`| ${i + 1} | ${a.entry.key} (${a.entry.name.replace(/\|/g, "/")}) | ${a.score} | ${a.entry.checked_on} | ${top} |`);
  });
  if (ranked.length > limit) lines.push("", `${ranked.length - limit} more entries with weaker signals are listed in the details below.`);
  lines.push("", "## Details", "");
  ranked.forEach((a, i) => {
    lines.push(`### ${i + 1}. ${a.entry.key}, score ${a.score}`, "");
    lines.push(`${a.entry.name}. Checked on ${a.entry.checked_on}.${a.baseline && a.baseline !== meta.date ? ` Compared with the run of ${a.baseline}.` : ""}`, "");
    for (const r of a.reasons) {
      lines.push(`- [${r.weight}] ${r.text}`);
      if (r.detail) lines.push(...fence(r.detail));
    }
    if (a.unchecked.length) lines.push(`- Not checked: ${a.unchecked.length} source${a.unchecked.length > 1 ? "s" : ""} (see below)`);
    lines.push("");
  });
  const unchecked = list.flatMap(a => a.unchecked.map(u => [a.entry.key, u] as const));
  if (unchecked.length) {
    lines.push("## Not checked this run", "", "Robots rules, bot blocks, timeouts and rate limits. These need a person or a later run.", "");
    const byText = new Map<string, string[]>();
    for (const [key, u] of unchecked) byText.set(u, [...(byText.get(u) ?? []), key]);
    for (const [u, keys] of [...byText].sort()) lines.push(`- ${u} (${[...new Set(keys)].join(", ")})`);
    lines.push("");
  }
  lines.push("## No signals", "", quiet.length ? quiet.map(a => a.entry.key).join(", ") : "None.", "");
  lines.push("## Run", "", ...meta.stats.map(s => `- ${s}`), "");
  return lines.join("\n");
}
