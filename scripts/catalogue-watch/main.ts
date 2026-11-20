// Catalogue watch: machine signals that say which entries most likely need a human recheck,
// and candidates for products that aren't listed yet. It writes reports and never edits data.
//
//   bun run watch [--state DIR] [--today YYYY-MM-DD] [--only signals|discover] [--max-age HOURS] [--offline]
//
// State (cache, snapshots, page text, reports) goes to --state, else $CATALOGUE_WATCH_DIR,
// else .catalogue-watch/ in the repository (ignored by Git). Set GITHUB_TOKEN or GH_TOKEN for
// GitHub's API limits; a read-only token is enough.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Fetcher, USER_AGENT } from "./http.ts";
import { entries } from "./sources.ts";
import { Gatherer, type Snapshot } from "./signals.ts";
import { assess, pickBaseline, renderRecheck } from "./rank.ts";
import { Discovery, knownIndex, rankCandidates, renderCandidates } from "./discover.ts";

const { values: args } = parseArgs({
  options: {
    state: { type: "string" }, today: { type: "string" }, only: { type: "string" },
    "max-age": { type: "string" }, offline: { type: "boolean" },
  },
});
const repoRoot = new URL("../../", import.meta.url).pathname;
const stateDir = resolve(args.state ?? process.env.CATALOGUE_WATCH_DIR ?? join(repoRoot, ".catalogue-watch"));
const today = args.today ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("--today takes YYYY-MM-DD");
const only = args.only;
if (only && !["signals", "discover"].includes(only)) throw new Error("--only takes signals or discover");

const read = (name: string) => JSON.parse(readFileSync(join(repoRoot, "data", `${name}.json`), "utf8"));
const services = read("services").services, standards = read("standards").standards;
const started = Date.now();
const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
const http = new Fetcher({ stateDir, githubToken, offline: args.offline, maxAge: args["max-age"] ? Number(args["max-age"]) * 3600 : undefined });
const log = (s: string) => console.error(`[watch] ${s}`);
for (const d of ["snapshots", "reports"]) mkdirSync(join(stateDir, d), { recursive: true });
const reportDir = join(stateDir, "reports", today);
mkdirSync(reportDir, { recursive: true });
log(`state in ${stateDir}; ${githubToken ? "GitHub token set" : "no GitHub token: API limits are low"}`);

const list = entries(services, standards);
const gatherer = new Gatherer(http, stateDir, today);
let snap: Snapshot | null = null;
const stats = () => {
  const s = http.stats;
  const hosts = Object.entries(s.byHost).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(", ");
  return [
    `Runtime ${Math.round((Date.now() - started) / 1000)} s; user agent \`${USER_AGENT}\`.`,
    `${s.requests} network requests (${hosts || "none"}); ${s.cacheHits} answered from the cache, ${s.notModified} not modified.`,
    `${s.robotsBlocked} fetches skipped for robots.txt; ${s.errors} failed requests.`,
  ];
};

if (only !== "discover") {
  log(`signals for ${list.length} entries`);
  snap = await gatherer.run(list, log);
  writeFileSync(join(stateDir, "snapshots", `${today}.json`), JSON.stringify(snap, null, 1));
  const dates = readdirSync(join(stateDir, "snapshots")).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).filter(d => d <= today).sort();
  const loaded = new Map<string, Snapshot>([[today, snap]]);
  const load = (d: string) => { if (!loaded.has(d)) loaded.set(d, JSON.parse(readFileSync(join(stateDir, "snapshots", `${d}.json`), "utf8"))); return loaded.get(d)!; };
  const readText = (h: string) => { const p = join(stateDir, "text", `${h}.txt`); return existsSync(p) ? readFileSync(p, "utf8") : null; };
  const assessed = list.map(e => {
    const b = pickBaseline(dates, e.checked_on);
    return assess(e, snap!, b && b !== today ? load(b) : null, today, readText);
  });
  const md = renderRecheck(assessed, { date: today, snapshots: dates, stats: stats() });
  writeFileSync(join(reportDir, "recheck.md"), md);
  writeFileSync(join(stateDir, "recheck.md"), md);
  writeFileSync(join(reportDir, "recheck.json"), JSON.stringify(assessed.map(a => ({ key: a.entry.key, score: a.score, checked_on: a.entry.checked_on, baseline: a.baseline, reasons: a.reasons, unchecked: a.unchecked })).sort((a, b) => b.score - a.score), null, 1));
  log(`recheck list written (${assessed.filter(a => a.reasons.length).length} entries with signals)`);
}

if (only !== "signals") {
  const known = knownIndex(services, standards);
  const d = new Discovery(http, known, log);
  log("discovery: GitHub search");
  await d.githubSearch();
  log("discovery: repositories of listed makers");
  await d.makerRepos();
  log("discovery: App Store search");
  await d.appSearch();
  if (snap) { log("discovery: links on makers' pages"); await d.fromMakerPages(snap, list, gatherer.bodies); }
  log("discovery: names in standards other_users");
  await d.otherUsers(standards);
  let ranked = rankCandidates(d.pool.values(), known, today);
  log(`discovery: READMEs for the top candidates (${d.pool.size} in the pool)`);
  // Look up the pool's own objects: ranking returns scored copies, and the next ranking starts from the pool again.
  const top = ranked.filter(c => !c.flags.includes("weak relevance") || c.score > 10).map(c => d.pool.get(c.key)!);
  await d.readmes(top, 50);
  log("discovery: releases and outside users for the top candidates");
  await d.maturity(top, 50);
  ranked = rankCandidates(d.pool.values(), known, today);
  const md = renderCandidates(ranked, { date: today, raw: d.raw, dropped: d.dropped, related: d.related, unresolved: d.unresolved, min: 15, limit: 60, stats: stats() });
  writeFileSync(join(reportDir, "candidates.md"), md);
  writeFileSync(join(stateDir, "candidates.md"), md);
  writeFileSync(join(reportDir, "candidates.json"), JSON.stringify(ranked.map(({ readme, ...c }) => c), null, 1));
  log(`candidates written (${ranked.length} in the pool)`);
}

// A short version for a rolling issue: the two tables, without details.
const head = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n## Details")[0].trim() : "";
const issue = [head(join(reportDir, "recheck.md")), head(join(reportDir, "candidates.md")), "Full details with diffs and draft entries are in the run's report files.", ...stats().map(s => `- ${s}`)].filter(Boolean).join("\n\n");
writeFileSync(join(reportDir, "issue.md"), issue.length > 60000 ? issue.slice(0, 60000) + "\n\n(cut to fit an issue)" : issue);
const summary = { date: today, stats: http.stats, seconds: Math.round((Date.now() - started) / 1000) };
writeFileSync(join(reportDir, "run.json"), JSON.stringify(summary, null, 1));
for (const s of stats()) log(s);
log(`reports in ${reportDir}`);
