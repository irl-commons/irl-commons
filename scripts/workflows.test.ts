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
