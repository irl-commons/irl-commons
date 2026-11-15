import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const workflow = (name: string) => Bun.YAML.parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8")) as any;

test("fork reviews signal a default-branch reporter without executing fork code", () => {
  const trigger = workflow("governance-review");
  expect(trigger.name).toBe("Governance review trigger");
  expect(trigger.on.pull_request_review.types).toEqual(["submitted", "edited", "dismissed"]);
  expect(trigger.permissions).toEqual({});
  expect(trigger.jobs.notify.steps).toEqual([{run: "true"}]);
  const report = workflow("governance");
  expect(report.on.pull_request_review).toBeUndefined();
  expect(report.on.workflow_run).toEqual({workflows: [trigger.name], types: ["completed"]});
  expect(report.permissions).toEqual({});
  expect(report.jobs.evaluate.permissions).toEqual({contents: "read", "pull-requests": "read", issues: "read"});
  const checkout = report.jobs.evaluate.steps.find((s: any) => s.uses?.startsWith("actions/checkout@"));
  expect(checkout.with).toEqual({ref: "${{ github.event.repository.default_branch }}", "persist-credentials": false});
  // workflow_run has no top-level pull_request; an empty number evaluates all open PRs.
  expect(report.jobs.evaluate.steps[1].env.PR_NUMBER).toBe("${{ github.event.pull_request.number }}");
  expect(JSON.stringify(report)).not.toContain("workflow_run.pull_requests");
  expect(JSON.stringify(report)).not.toContain("download-artifact");
  expect(report.jobs.report.permissions).toEqual({"checks": "write", "pull-requests": "read"});
  expect(report.jobs.report.steps.every((s: any) => !s.uses)).toBe(true);
});

test("the reported check carries the evaluator's title, so bootstrap is visible on the PR", () => {
  const script = workflow("governance").jobs.report.steps[0].run as string;
  expect(script).toContain("title: report.title || 'Steward review and consensus window'");
  expect(script).toContain("state: 'failure', title: 'Governance evidence unavailable'");
  // Pending stays in progress; every other state, including a bootstrap success, completes with its conclusion.
  expect(script).toContain("status: report.state === 'pending' ? 'in_progress' : 'completed'");
});

test("only verified main tags reach the OIDC staging job", () => {
  const w = workflow("publish");
  expect(w.on).toEqual({push: {tags: ["v*"]}});
  expect(w.permissions).toEqual({});
  expect(w.jobs.verify.permissions).toEqual({contents: "read"});
  expect(w.jobs.verify.if).toContain("github.ref_type == 'tag'");
  expect(w.jobs.verify.steps[0].with["fetch-depth"]).toBe(0);
  expect(w.jobs.verify.steps[1].run).toContain('git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main');
  expect(w.jobs.publish.needs).toBe("verify");
  expect(w.jobs.publish.environment).toBe("npm-release");
  expect(w.jobs.publish.permissions).toEqual({contents: "read", "id-token": "write"});
  const commands = w.jobs.publish.steps.map((s: any) => s.run || "").join("\n");
  expect(commands).not.toMatch(/bun test|bun install|npm install|npm publish/);
  expect(commands).toContain("npm stage publish --ignore-scripts --provenance --access public");
});

test("tag creation exception cannot bypass immutability", () => {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../.github/rulesets/${name}.json`, import.meta.url), "utf8"));
  const creation = read("release-tags");
  expect(creation.conditions.ref_name.include).toEqual(["refs/tags/v*"]);
  expect(creation.bypass_actors).toEqual([{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always"}]);
  expect(creation.rules).toEqual([{type: "creation"}]);
  const immutable = read("release-tags-immutable");
  expect(immutable.conditions).toEqual(creation.conditions);
  expect(immutable.bypass_actors).toEqual([]);
  expect(immutable.rules).toEqual([{type: "update"}, {type: "deletion"}]);
});

test("a form becomes a draft only through a read-only job and a write job that runs no issue text", () => {
  const w = workflow("form-to-pr");
  expect(w.on).toEqual({issues: {types: ["labeled"]}});
  expect(w.permissions).toEqual({});
  expect(w.jobs.prepare.if).toBe("github.event.label.name == 'make-pr' && github.event.issue.state == 'open'");
  expect(w.jobs.prepare.permissions).toEqual({contents: "read"});
  expect(w.jobs.open.needs).toBe("prepare");
  expect(w.jobs.open.permissions).toEqual({contents: "write", "pull-requests": "write", issues: "write"});
  for (const job of Object.values<any>(w.jobs)) {
    for (const step of job.steps) {
      if (step.uses?.startsWith("actions/checkout@")) expect(step.with["persist-credentials"]).toBe(false);
      // Issue text reaches the scripts only through the event file, never through an expression.
      expect(JSON.stringify(step)).not.toMatch(/github\.event\.(issue\.(body|title)|comment)|github\.event\.label\.description/);
    }
  }
  const install = w.jobs.prepare.steps.find((s: any) => s.run?.startsWith("bun install"));
  expect(install.run).toContain("--ignore-scripts");
  expect(w.jobs.open.steps.map((s: any) => s.run).filter(Boolean)).toEqual(["node scripts/form-open.mjs"]);
  // GitHub refuses a workflow whose job-level env uses the runner context.
  for (const job of Object.values<any>(w.jobs)) expect(JSON.stringify(job.env ?? {})).not.toContain("runner.");
});

test("every action is pinned to a full commit", () => {
  const { readdirSync } = require("node:fs");
  for (const file of readdirSync(new URL("../.github/workflows/", import.meta.url)).filter((f: string) => f.endsWith(".yml"))) {
    const w = workflow(file.replace(/\.yml$/, ""));
    for (const job of Object.values<any>(w.jobs)) for (const step of job.steps ?? [])
      if (step.uses) expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  }
});

test("drafts get the validate check once a steward marks them ready", () => {
  expect(workflow("check").on.pull_request.types).toEqual(["opened", "synchronize", "reopened", "ready_for_review"]);
  expect(workflow("governance").on.pull_request_target.types).toContain("ready_for_review");
});
