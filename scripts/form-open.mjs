// The write half of the form workflow, with no dependencies and no checkout of issue content:
// it reads what the read-only job wrote, accepts only one known data file, and opens a draft
// pull request through the GitHub API. Nothing here runs a shell or evaluates issue text.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const DATASETS = ["words", "answers", "services", "guides", "standards", "plans"];
export const TRIGGER_LABEL = "make-pr";
const MAX_FILE = 5 * 1024 * 1024;

/** Read and check the bundle from the read-only job. Throws on anything unexpected. */
export function readBundle(dir, issue) {
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  if (meta.issue !== issue) throw new Error("bundle is for another issue");
  if (meta.status !== "ready") {
    return { status: meta.status, comment: String(readFileSync(join(dir, "comment.md"), "utf8")).slice(0, 20000) };
  }
  const dataset = meta.request?.dataset;
  if (!DATASETS.includes(dataset)) throw new Error("unknown dataset");
  const path = `data/${dataset}.json`;
  if (statSync(join(dir, path)).size > MAX_FILE) throw new Error("data file too large");
  const content = readFileSync(join(dir, path), "utf8");
  JSON.parse(content);
  const pr = JSON.parse(readFileSync(join(dir, "pr.json"), "utf8"));
  for (const key of ["title", "body", "message"]) if (typeof pr[key] !== "string" || !pr[key]) throw new Error(`missing ${key}`);
  return {
    status: "ready", path, content,
    title: pr.title.slice(0, 200), body: pr.body.slice(0, 60000), message: pr.message.slice(0, 5000),
  };
}

export const branchFor = (issue) => `form/issue-${issue}`;

async function main() {
  const issue = Number(process.env.ISSUE);
  if (!Number.isInteger(issue) || issue < 1) throw new Error("ISSUE must be an issue number");
  const repo = process.env.GH_REPO;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) throw new Error("GH_REPO must be owner/name");
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, json: text ? JSON.parse(text) : null };
  };
  const must = async (...args) => {
    const result = await api(...args);
    if (!result.ok) throw new Error(`GitHub API ${result.status} for ${args[1] ?? "GET"} ${args[0]}`);
    return result.json;
  };
  const comment = (text) => must(`issues/${issue}/comments`, "POST", { body: text });
  const unlabel = () => api(`issues/${issue}/labels/${TRIGGER_LABEL}`, "DELETE");

  const bundle = readBundle(process.env.FORM_DIR, issue);
  if (bundle.status !== "ready") {
    await comment(bundle.comment);
    await unlabel();
    return;
  }
  const branch = branchFor(issue);
  const owner = repo.split("/")[0];
  const open = await must(`pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (open.length) {
    await comment(`A draft for this issue is already open: #${open[0].number}. To start again from the form, close that pull request and add the \`${TRIGGER_LABEL}\` label again.`);
    await unlabel();
    return;
  }
  const main = await must("git/ref/heads/main");
  const created = await api("git/refs", "POST", { ref: `refs/heads/${branch}`, sha: main.object.sha });
  // A branch left from an earlier, closed draft starts again from main.
  if (created.status === 422) await must(`git/refs/heads/${branch}`, "PATCH", { sha: main.object.sha, force: true });
  else if (!created.ok) throw new Error(`GitHub API ${created.status} creating the branch`);
  const file = await must(`contents/${bundle.path}?ref=${encodeURIComponent(branch)}`);
  await must(`contents/${bundle.path}`, "PUT", {
    message: bundle.message, branch, sha: file.sha, content: Buffer.from(bundle.content, "utf8").toString("base64"),
  });
  const pr = await must("pulls", "POST", { title: bundle.title, head: branch, base: "main", body: bundle.body, draft: true });
  await comment(`Thank you! The draft pull request is #${pr.number}. A steward checks it against the source, finishes anything missing and then marks it ready for review.`);
  await unlabel();
  console.log(`Opened draft #${pr.number} for issue #${issue}`);
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) await main();
