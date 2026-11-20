// Discovery reports for stewards. Read-only: they never edit data/ and never write to GitHub.
//
//   bun scripts/discovery/main.ts questions --out <dir> [--since YYYY-MM-DD] [--offline]
//   bun scripts/discovery/main.ts guides --out <dir> [--offline]
//   bun scripts/discovery/main.ts all --out <dir>
//
// `questions` reads public threads (GitHub issues and discussions, Stack Exchange, forum
// boards), sorts them and maps them to answers.json, words.json and guides.json.
// `guides` lists public tutorials that guides.json doesn't have yet.
// The output folder must be outside this repository: reports and caches hold copies of
// public posts and are not for committing. DISCOVERY_OUT can stand in for --out.
// GitHub needs a read-only token: GITHUB_TOKEN, or a signed-in gh.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { EXTRA_REPOS, SKIP_REPOS } from "./config.ts";
import { sortThread, type Thread } from "./classify.ts";
import { discoverGuides } from "./guides.ts";
import { GitHub, githubToken, harvestForums, harvestGitHub, harvestStackExchange, type SourceStat } from "./harvest.ts";
import { Cache, Fetcher } from "./http.ts";
import { buildIndex, linkedRepos, loadData } from "./project.ts";
import { guidesReport, questionsReport, themeDemand } from "./report.ts";

export const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);

/** The output folder, refused when it sits inside the repository. */
export function outputDir(arg: string | undefined, repoRoot = REPO_ROOT): string {
  if (!arg) throw new Error("give an output folder outside the repository: --out <dir> or DISCOVERY_OUT");
  const out = resolve(arg);
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  const rel = relative(real(repoRoot), real(out));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("the output folder must be outside the repository, so harvested posts are never committed");
  return out;
}

function args(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const v = argv[i + 1]; if (v && !v.startsWith("--") && !["--offline"].includes(a)) { flags[a.slice(2)] = v; i++; } else flags[a.slice(2)] = true; }
    else rest.push(a);
  }
  return { command: rest[0] ?? "all", flags };
}

function monthsAgo(today: string, months: number): string {
  const d = new Date(today);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const { command, flags } = args(process.argv.slice(2));
  if (!["questions", "guides", "all"].includes(command)) throw new Error(`unknown command ${command}: use questions, guides or all`);
  const out = outputDir((flags.out as string) ?? process.env.DISCOVERY_OUT);
  const today = (flags.today as string) ?? new Date().toISOString().slice(0, 10);
  const since = (flags.since as string) ?? monthsAgo(today, 24);
  mkdirSync(join(out, "state"), { recursive: true });
  const cache = new Cache(join(out, "cache"), !!flags.offline);
  const fetcher = new Fetcher({ "api.github.com": 400, "api.stackexchange.com": 1000 }, 1500);
  const data = loadData();
  const index = buildIndex(data);
  const gh = new GitHub(fetcher, cache, githubToken());

  if (command === "questions" || command === "all") {
    const stats: SourceStat[] = [];
    const repos = [...new Set([...linkedRepos(data), ...EXTRA_REPOS])].filter((r) => !SKIP_REPOS.has(r));
    const threads: Thread[] = [
      ...await harvestGitHub(gh, repos, since, stats),
      ...await harvestStackExchange(fetcher, cache, since, stats),
      ...await harvestForums(fetcher, cache, since, stats),
    ];
    const unique = [...new Map(threads.map((t) => [t.url, t])).values()];
    const sorted = unique.map((t) => sortThread(t, index)).sort((a, b) => b.created.localeCompare(a.created));
    writeFileSync(join(out, "questions.json"), JSON.stringify({ today, since, stats, threads: sorted.map((s) => ({ ...s, text: s.text.slice(0, 200) })) }, null, 1));
    writeFileSync(join(out, "questions.md"), questionsReport(sorted, stats, { today, since }));
    console.log(`questions: ${sorted.length} threads from ${stats.length} sources; ${join(out, "questions.md")}`);
  }

  if (command === "guides" || command === "all") {
    const seenFile = join(out, "state", "guides-seen.json");
    const previous = existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, "utf8")) : null;
    const run = await discoverGuides(fetcher, cache, gh, index, today, previous ?? {});
    writeFileSync(seenFile, JSON.stringify(run.seen, null, 1));
    writeFileSync(join(out, "guide-candidates.json"), JSON.stringify({ today, stats: run.stats, rechecks: run.rechecks, candidates: run.drafts }, null, 1));
    const questionsFile = join(out, "questions.json");
    const demand = existsSync(questionsFile) ? themeDemand(JSON.parse(readFileSync(questionsFile, "utf8")).threads) : null;
    writeFileSync(join(out, "guides.md"), guidesReport(run.drafts, run.rechecks, run.stats, today, previous !== null, demand));
    console.log(`guides: ${run.drafts.length} candidates, ${run.rechecks.length} to re-read; ${join(out, "guides.md")}`);
  }
  console.log(`requests: ${fetcher.log.requests}; blocked by robots.txt: ${fetcher.log.blocked.length}; failures: ${fetcher.log.failures.length}`);
  for (const f of fetcher.log.failures.slice(0, 10)) console.log(`  ${f}`);
}

if (import.meta.main) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
