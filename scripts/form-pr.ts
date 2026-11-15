// The read-only half of the form workflow. `prepare` checks who added the label, reads the
// issue form from the event file and writes the entry; `compose` writes the pull request text
// after `bun run check` has run. Results go to $FORM_OUT for the job that opens the pull request.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { files, type FileName } from "../schema/src/schema.ts";
import { applyRequest, fenced, formFor, loadForms, parseBody, readRequest, serialize, type Request } from "./forms.ts";

export const TRIGGER_LABEL = "make-pr";

export type Meta = {
  issue: number;
  status: "ready" | "manual" | "invalid";
  problems: string[];
  summary: string[];
  notes: string[];
  request: Request | null;
  author: { login: string; id: number };
};

const here = (p: string) => new URL(p, import.meta.url);

/** A listed steward, or anyone with write access to the repository, may turn a form into a draft. */
export async function mayLabel(login: string, stewards: { github: string | null }[], permission: (login: string) => Promise<string>): Promise<boolean> {
  if (stewards.some((s) => s.github && s.github.toLowerCase() === login.toLowerCase())) return true;
  return ["admin", "maintain", "write"].includes(await permission(login));
}

async function repoPermission(login: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/collaborators/${encodeURIComponent(login)}/permission`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (response.status === 404) return "none";
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const body = (await response.json()) as any;
  return body.role_name ?? body.permission ?? "none";
}

/** Everything the form says, checked and applied. Pure apart from reading the forms and data. */
export function prepare(event: any, today: string, data: Record<FileName, any>): { meta: Meta; doc: any } {
  const issue = event.issue;
  const author = { login: String(issue.user.login), id: Number(issue.user.id) };
  const meta: Meta = { issue: Number(issue.number), status: "invalid", problems: [], summary: [], notes: [], request: null, author };
  const form = formFor(loadForms(), (issue.labels ?? []).map((l: any) => String(l.name)));
  const fail = (problems: string[]) => ({ meta: { ...meta, problems }, doc: null });
  if (typeof form === "string") return fail([form]);
  const parsed = parseBody(form, String(issue.body ?? ""));
  if (parsed.problems.length) return fail(parsed.problems);
  const read = readRequest(form, parsed.values, today);
  if (!read.request) return fail(read.problems);
  const change = applyRequest(read.request, data);
  return {
    meta: { ...meta, status: change.status, problems: change.problems, summary: change.summary, notes: change.notes, request: read.request },
    doc: change.doc,
  };
}

const TITLE = { new: "Add", edit: "Update", confirm: "Confirm", maker: "Update" } as const;

export function title(r: Request): string {
  const ref = `${r.dataset}/${r.id}`;
  if (r.kind === "confirm") return `Confirm ${ref} against its source`;
  if (r.kind === "maker") return `Update ${ref} (maker edit request)`;
  return `${TITLE[r.kind]} ${ref}`;
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function commitMessage(meta: Meta): string {
  const r = meta.request!;
  const lines = [title(r), "", `From the form in #${meta.issue}. The source was read on ${r.readOn}.`];
  if (LOGIN.test(meta.author.login) && Number.isInteger(meta.author.id))
    lines.push("", `Co-authored-by: ${meta.author.login} <${meta.author.id}+${meta.author.login}@users.noreply.github.com>`);
  return lines.join("\n") + "\n";
}

const link = (url: string) => (/[<>\s]/.test(url) ? fenced(url, "") : `<${url}>`);

export function prBody(meta: Meta, check: { passed: boolean; output: string }): string {
  const r = meta.request!;
  const who = LOGIN.test(meta.author.login) ? `@${meta.author.login}` : "the person who filled it in";
  const out: string[] = [];
  out.push(`This draft comes from the form in #${meta.issue}, filled in by ${who}. Thank you!`, "");
  out.push("**What it changes**", "", ...meta.summary.map((s) => `- ${s}`), "");
  out.push(`**Source:** ${link(r.source)}, read on ${r.readOn}.`, "");
  if (r.kind === "confirm") out.push("**What they checked**", "", fenced(r.checked), "");
  else if (r.kind === "new") out.push("**Description from the form**", "", fenced(r.description), "");
  else out.push("**What changed, in their words**", "", fenced(r.changes), "");
  if (r.productLabel) out.push("**The label their product uses, and why**", "", fenced(r.productLabel), "");
  if (r.kind === "maker") out.push("**Conflict of interest:** this is an edit request from the maker or a competitor. An independent steward reviews and merges it.", "", fenced(r.conflictDetails), "");
  else if (r.conflict) out.push("**Conflict of interest:** declared in the form. An independent steward reviews it.", "", fenced(r.conflictDetails), "");
  else out.push("**Conflict of interest:** none declared.", "");
  if (check.passed) out.push("**Data check:** passes.", "");
  else {
    const lines = check.output.split("\n").filter((l) => l.trim() && !l.startsWith("$ ") && !l.startsWith("error: script ")).slice(0, 30);
    out.push("**Data check:** doesn't pass yet. A steward fills in or fixes these on this branch:", "", fenced(lines.join("\n")), "");
  }
  if (meta.notes.length) out.push("**Notes**", "", ...meta.notes.map((n) => `- ${n}`), "");
  out.push("**For the steward:** compare the change with the source and finish anything missing on this branch. Then mark the pull request ready for review: that starts the validate and governance checks, and the usual merge rules apply.", "");
  out.push(`Closes #${meta.issue}`);
  return out.join("\n") + "\n";
}

export function problemComment(meta: Meta): string {
  if (meta.status === "manual")
    return "Thank you! The form is complete, but this change can't be written into the data automatically. A steward makes it by hand and links the pull request here.\n";
  return [
    "Thank you! This form can't be turned into a change yet:", "",
    ...meta.problems.map((p) => `- ${p}`), "",
    "Please edit the issue text to fix it. A steward then adds the `make-pr` label again.", "",
  ].join("\n");
}

async function main() {
  const [command] = process.argv.slice(2);
  const outDir = process.env.FORM_OUT;
  if (!outDir) throw new Error("FORM_OUT is not set");
  mkdirSync(join(outDir, "data"), { recursive: true });
  if (command === "prepare") {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8"));
    if (event.label?.name !== TRIGGER_LABEL || !event.issue || event.issue.pull_request) throw new Error("not a form label event");
    const sender = String(event.sender?.login ?? "");
    const stewards = JSON.parse(readFileSync(here("../stewards.json"), "utf8")).stewards;
    if (!(await mayLabel(sender, stewards, repoPermission))) {
      console.error(`${sender} is not a listed steward and has no write access; nothing was done.`);
      process.exit(1);
    }
    const data = {} as Record<FileName, any>;
    for (const name of Object.keys(files) as FileName[]) data[name] = JSON.parse(readFileSync(here(`../data/${name}.json`), "utf8"));
    const { meta, doc } = prepare(event, new Date().toISOString().slice(0, 10), data);
    if (meta.status === "ready") {
      const name = `data/${meta.request!.dataset}.json`;
      writeFileSync(here(`../${name}`), serialize(doc));
      writeFileSync(join(outDir, name), serialize(doc));
    }
    writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
    writeFileSync(process.env.GITHUB_OUTPUT ?? "/dev/null", `status=${meta.status}\n`, { flag: "a" });
    console.log(`Issue #${meta.issue}: ${meta.status}`);
  } else if (command === "compose") {
    const meta: Meta = JSON.parse(readFileSync(join(outDir, "meta.json"), "utf8"));
    if (meta.status === "ready") {
      const checkFile = join(outDir, "check.txt");
      const check = { passed: process.env.CHECK_PASSED === "true", output: existsSync(checkFile) ? readFileSync(checkFile, "utf8") : "" };
      writeFileSync(join(outDir, "pr.json"), JSON.stringify({ title: title(meta.request!), body: prBody(meta, check), message: commitMessage(meta) }, null, 2));
    } else writeFileSync(join(outDir, "comment.md"), problemComment(meta));
  } else throw new Error("usage: form-pr.ts prepare|compose");
}

if (import.meta.main) await main();
