// Turn an issue form into a data change. Everything in an issue body is untrusted text:
// it is parsed here as text and JSON, never evaluated, and every value is checked
// before it reaches a data file. The workflow runs `bun run check` on the result.
import { readFileSync, readdirSync } from "node:fs";
import { Day, HttpsUrl, Id, ServiceTag, files, guideTitle, wordAliases, type FileName } from "../schema/src/schema.ts";

export const DATASETS = ["words", "answers", "services", "guides", "standards", "plans"] as const satisfies readonly FileName[];
export type Dataset = (typeof DATASETS)[number];
export type Kind = "new" | "edit" | "confirm" | "maker";
export const listKey = (d: Dataset) => (d === "plans" ? "carriers" : d);

export type Field = { id: string; label: string; type: string; required: boolean; render?: string };
export type Form = { file: string; kind: Kind; label: string; fields: Field[] };

/** Which kind of change each form file asks for. The form's own label marks its issues. */
const KIND_BY_FILE: Record<string, Kind> = {
  "new-entry.yml": "new",
  "edit-entry.yml": "edit",
  "confirm-entry.yml": "confirm",
  "maker-edit-request.yml": "maker",
};

export function loadForms(dir = new URL("../.github/ISSUE_TEMPLATE/", import.meta.url)): Form[] {
  return readdirSync(dir).filter((f) => f in KIND_BY_FILE).sort().map((file) => {
    const doc = Bun.YAML.parse(readFileSync(new URL(file, dir), "utf8")) as any;
    const fields = (doc.body as any[]).filter((b) => b.type !== "markdown").map((b) => ({
      id: b.id, label: b.attributes.label, type: b.type,
      required: b.validations?.required === true, render: b.attributes.render,
    }));
    return { file, kind: KIND_BY_FILE[file], label: doc.labels[0], fields };
  });
}

/** The form an issue came from, by the label its template set. Exactly one must match. */
export function formFor(forms: Form[], labels: string[]): Form | string {
  const found = forms.filter((f) => labels.includes(f.label));
  if (found.length === 1) return found[0];
  return found.length ? "The issue has the labels of more than one form; keep only one." : "The issue has no form label, so it is not clear which form it came from.";
}

const NO_RESPONSE = "_No response_";

/** Read the values out of a rendered form body ("### Label", a blank line, the value).
 *  Only headings that exactly match this form's labels count, each at most once and in form order. */
export function parseBody(form: Form, body: string): { values: Record<string, string>; problems: string[] } {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const problems: string[] = [];
  const found: { field: Field; at: number }[] = [];
  for (const field of form.fields) {
    const heading = `### ${field.label}`;
    const at = lines.flatMap((l, i) => (l.trimEnd() === heading ? [i] : []));
    if (at.length > 1) problems.push(`The heading "${field.label}" appears more than once in the issue text.`);
    else if (at.length === 1) found.push({ field, at: at[0] });
    else if (field.required) problems.push(`The field "${field.label}" is missing from the issue text.`);
  }
  for (let i = 1; i < found.length; i++)
    if (found[i].at < found[i - 1].at) problems.push("The fields are not in the order of the form; please don't move them.");
  const values: Record<string, string> = {};
  if (problems.length) return { values, problems };
  found.forEach(({ field, at }, i) => {
    const end = i + 1 < found.length ? found[i + 1].at : lines.length;
    let value = lines.slice(at + 1, end).join("\n").trim();
    if (value === NO_RESPONSE) value = "";
    if (field.render && value) {
      // A textarea with `render` is wrapped in a code fence by GitHub.
      const fence = value.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/);
      if (fence) value = fence[2].trim();
    }
    values[field.id] = value;
  });
  return { values, problems };
}

export type Request = {
  kind: Kind;
  dataset: Dataset;
  id: string;
  name: string;
  link: string;
  source: string;
  readOn: string;
  /** True when the form left the date empty and the day the issue was opened is used. */
  readOnFromIssue: boolean;
  description: string;
  checked: string;
  changes: string;
  conflict: boolean;
  conflictDetails: string;
  /** Optional, on edits: the label the person's product uses for a word, and why. */
  productLabel: string;
  /** Optional, on edits of services: the tags ticked in the form. */
  tags: string[];
};

const LIMITS: Record<string, number> = {
  entry: 120, name: 200, link: 500, source: 500, read_on: 20, description: 1000,
  checked: 5000, changes: 5000, conflict_details: 2000, product_label: 2000, tags: 1000,
};

const LABEL = (form: Form, id: string) => form.fields.find((f) => f.id === id)?.label ?? id;

/** Check every value and turn the form into a request. Problem texts never quote the values. */
/** `opened` is the day the issue was opened (YYYY-MM-DD); it stands in for an empty read date. */
export function readRequest(form: Form, values: Record<string, string>, today: string, opened: string = today): { request?: Request; problems: string[] } {
  const problems: string[] = [];
  const v = (id: string) => values[id] ?? "";
  for (const [id, max] of Object.entries(LIMITS))
    if (v(id).length > max) problems.push(`"${LABEL(form, id)}" is longer than ${max} characters.`);
  for (const f of form.fields) if (f.required && !v(f.id)) problems.push(`"${f.label}" is empty.`);
  if (problems.length) return { problems };

  let dataset = "";
  let id = v("entry");
  const slash = id.indexOf("/");
  if (slash >= 0) { dataset = id.slice(0, slash).trim(); id = id.slice(slash + 1).trim(); }
  const picked = v("dataset").split(":")[0].trim();
  if (picked && dataset && picked !== dataset) problems.push(`"${LABEL(form, "entry")}" and "${LABEL(form, "dataset")}" name different datasets.`);
  dataset ||= picked;
  if (!(DATASETS as readonly string[]).includes(dataset)) problems.push(`Pick a dataset, or write the entry as dataset/id (for example services/moblin).`);
  if (!Id.safeParse(id).success) problems.push(`The id may only use lowercase letters, numbers and single dashes.`);

  const url = (fieldId: string) => {
    const value = v(fieldId);
    if (value && (!HttpsUrl.safeParse(value).success || !URL.canParse(value)))
      problems.push(`"${LABEL(form, fieldId)}" must be one https:// link, and not a chat invite.`);
  };
  url("source");
  url("link");

  const readOnFromIssue = !v("read_on");
  const readOn = v("read_on") || opened;
  if (!Day.safeParse(readOn).success) problems.push(`"${LABEL(form, "read_on")}" must be a real date written as YYYY-MM-DD.`);
  else if (readOn > today) problems.push(`"${LABEL(form, "read_on")}" is in the future.`);
  else if (readOn < "2000-01-01") problems.push(`"${LABEL(form, "read_on")}" is too far in the past.`);

  // Ticked boxes render as "- [X] tag: words"; only the tag before the colon counts.
  const tags: string[] = [];
  for (const line of v("tags").split("\n")) {
    const m = line.trim().match(/^- \[[xX]\] ([^:]+):/);
    if (!m) continue;
    if (ServiceTag.safeParse(m[1].trim()).success) tags.push(m[1].trim());
    else problems.push(`"${LABEL(form, "tags")}" has a box this form doesn't offer.`);
  }

  let conflict = true;
  if (form.kind !== "maker") {
    const answer = v("conflict");
    if (answer !== "Yes" && answer !== "No") problems.push(`Answer the conflict of interest question with Yes or No.`);
    conflict = answer === "Yes";
    if (conflict && !v("conflict_details")) problems.push(`Please say what the connection is, under "${LABEL(form, "conflict_details")}".`);
  }
  if (problems.length) return { problems };
  return {
    problems,
    request: {
      kind: form.kind, dataset: dataset as Dataset, id, readOn, readOnFromIssue, conflict,
      name: v("name"), link: v("link"), source: v("source"), description: v("description"),
      checked: v("checked"), changes: v("changes"), conflictDetails: v("conflict_details"),
      productLabel: v("product_label"), tags,
    },
  };
}

/** Where the form's common fields go in each dataset. */
type Mapping = { name: string; link: string | null; description: string | null; lists: string[]; extra?: Record<string, unknown> };
const MAP: Record<Dataset, Mapping> = {
  words: { name: "term", link: null, description: "plain", lists: ["also_called", "search_terms", "aliases", "related"], extra: { heard_when: "", uncertain: true } },
  answers: { name: "question", link: null, description: "summary", lists: ["words", "services"] },
  services: { name: "name", link: "url", description: "description", lists: ["links", "support", "tags", "words", "covers"] },
  guides: { name: "title", link: "url", description: null, lists: ["words", "answers"] },
  standards: { name: "name", link: "url", description: "description", lists: ["service_ids", "other_users"] },
  plans: { name: "name", link: "official_url", description: null, lists: [] },
};

/** The entry fields of a dataset, in schema order. */
export function entryKeys(dataset: Dataset): string[] {
  const list = (files[dataset] as any).shape[listKey(dataset)];
  return Object.keys(list.element.shape);
}

const sourceLink = (url: string) => ({ label: new URL(url).hostname.replace(/^www\./, ""), url });

/** Copy own properties into a fresh object: JSON keys such as "__proto__" stay plain data. */
function put(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Keys in the order of `like` (the entry before the edit, or a sibling entry for a new one),
 *  then in schema order, so a change touches only the lines it changes. */
function ordered(dataset: Dataset, entry: Record<string, unknown>, like?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = [...new Set([...Object.keys(like ?? {}), ...entryKeys(dataset)])];
  for (const k of keys) if (Object.hasOwn(entry, k)) put(out, k, entry[k]);
  for (const k of Object.keys(entry)) if (!keys.includes(k)) put(out, k, entry[k]);
  return out;
}

function mentions(entry: unknown, url: string): boolean {
  if (typeof entry === "string") return entry === url;
  if (Array.isArray(entry)) return entry.some((x) => mentions(x, url));
  if (entry && typeof entry === "object") return Object.values(entry).some((x) => mentions(x, url));
  return false;
}

export type Change = {
  status: "ready" | "manual" | "invalid";
  problems: string[];
  /** Plain lines for the pull request: what changed in the entry. */
  summary: string[];
  /** Things a steward still has to do or know. */
  notes: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  doc: any;
};

/** Apply a request to the parsed data files. `data` is not changed; the new file is in `doc`. */
export function applyRequest(request: Request, data: Record<FileName, any>): Change {
  const { dataset, id, kind } = request;
  const map = MAP[dataset];
  const doc = structuredClone(data[dataset]);
  const rows: any[] = doc[listKey(dataset)];
  const index = rows.findIndex((r) => r.id === id);
  const fail = (problem: string): Change => ({ status: "invalid", problems: [problem], summary: [], notes: [], before: null, after: null, doc: null });
  const summary: string[] = [];
  const notes: string[] = [];
  const allowed = entryKeys(dataset);

  if (kind === "new") {
    if (index >= 0) return fail(`${dataset}/${id} already exists. To change it, use the "Fix or update an entry" form.`);
    const entry: Record<string, unknown> = { id, checked_on: request.readOn };
    for (const list of map.lists) entry[list] = [];
    Object.assign(entry, structuredClone(map.extra ?? {}));
    entry[map.name] = request.name;
    if (map.description) entry[map.description] = request.description;
    const link = request.link || request.source;
    if (map.link) entry[map.link] = link;
    if (dataset === "words") entry.source = request.source;
    else if (dataset === "services") { if (request.source !== link) entry.links = [sourceLink(request.source)]; }
    else if (dataset !== "guides") entry.sources = [sourceLink(request.source)];
    retitle(dataset, entry, data);
    const after = ordered(dataset, entry, rows[0]);
    rows.push(after);
    summary.push(`Adds \`${dataset}/${id}\`, checked on ${request.readOn}.`);
    if (dataset === "words") notes.push("A new word starts with `uncertain: true`; a steward sets it to false once the definition is settled.");
    const missing = allowed.filter((k) => !Object.hasOwn(after, k) && !optionalKey(dataset, k));
    if (missing.length) notes.push(`Still missing, for a steward to fill in: ${missing.map((k) => `\`${k}\``).join(", ")}.`);
    if (!map.description && request.description) notes.push(`The description from the form isn't a field in ${dataset}; it is shown below for the steward.`);
    return { status: "ready", problems: [], summary, notes, before: null, after, doc };
  }

  if (index < 0) return fail(`${dataset}/${id} doesn't exist. Check the id, or use the "Suggest a new entry" form.`);
  const before = rows[index];
  const entry: Record<string, unknown> = structuredClone(before);
  const current = typeof before.checked_on === "string" ? before.checked_on : null;

  if (kind === "confirm") {
    if (current && request.readOn < current) return fail(`The entry was already checked on a later date. Nothing to confirm.`);
    if (current === request.readOn) return fail(`That date is already recorded on the entry. Nothing to change.`);
  } else {
    if (request.name && request.name !== before[map.name]) { entry[map.name] = request.name; summary.push(`Sets \`${map.name}\` to the new name.`); }
    if (request.link && map.link && request.link !== before[map.link]) { entry[map.link] = request.link; summary.push(`Sets \`${map.link}\` to the new link.`); }
    if (request.link && !map.link) notes.push(`${dataset} entries have no official link; the new link from the form is left for the steward.`);
    if (request.tags.length && dataset !== "services") notes.push(`Tags are only for apps and services; the ticked boxes are left out.`);
    else if (request.tags.length) {
      const added = request.tags.filter((t) => !(entry.tags as string[]).includes(t));
      if (added.length) {
        entry.tags = [...(entry.tags as string[]), ...added];
        summary.push(`Adds the tag${added.length > 1 ? "s" : ""} ${added.map((t) => `\`${t}\``).join(" and ")}.`);
      }
    }
    if (!summary.length) {
      return { status: "manual", problems: [], summary: [], notes: [], before, after: null, doc: null };
    }
  }
  if (!current || request.readOn > current) {
    entry.checked_on = request.readOn;
    summary.push(current ? `Moves \`checked_on\` from ${current} to ${request.readOn}.` : `Sets \`checked_on\` to ${request.readOn}.`);
  } else if (request.readOn < current) {
    notes.push(`The entry was checked on ${current}, later than the date in the form, so \`checked_on\` stays.`);
  }
  retitle(dataset, entry, data);
  notes.push(mentions(before, request.source)
    ? "The source in the form is already listed on the entry."
    : "The source in the form isn't listed on the entry yet. A steward decides whether to add it.");
  const after = ordered(dataset, entry, before);
  rows[index] = after;
  return { status: "ready", problems: [], summary, notes, before, after, doc };
}

/** Guides carry a generated display title, and words the deprecated aliases; keep them in step. */
function retitle(dataset: Dataset, entry: Record<string, unknown>, data: Record<FileName, any>) {
  if (dataset === "words" && Array.isArray(entry.also_called) && Array.isArray(entry.search_terms) && typeof entry.term === "string")
    entry.aliases = wordAliases(entry as any);
  if (dataset !== "guides" || !Array.isArray(entry.covers) || !Array.isArray(entry.part) || !entry.part.length) return;
  const names = new Map<string, string>(data.services.services.map((s: any) => [s.id, s.name]));
  entry.title_display = guideTitle({ covers: entry.covers, publisher: (entry.publisher as string) ?? null, part: entry.part }, (x) => names.get(x) ?? x);
}

function optionalKey(dataset: Dataset, key: string): boolean {
  const list = (files[dataset] as any).shape[listKey(dataset)];
  return list.element.shape[key].safeParse(undefined).success;
}

/** A data file exactly as the repository stores it. */
export const serialize = (doc: unknown) => JSON.stringify(doc, null, 2) + "\n";

/** A Markdown code fence around untrusted text: no mentions, links or HTML from it render. */
export function fenced(text: string, info = "text"): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${info}\n${text}\n${fence}`;
}
