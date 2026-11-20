// Validate ../data with zod, run the cross-reference checks, make sure the
// committed JSON Schema matches the zod schemas, and invalid fixtures are rejected. Exit 1 on any problem.
import { readFileSync, readdirSync } from "node:fs";
import { files, guideTitle, planFacts, RolesByKind, wordAliases, type FileName } from "../schema/src/schema.ts";
import { exported, partsJson } from "./export.ts";
import { comparisonFacts } from "./stale.ts";

const here = (p: string) => new URL(p, import.meta.url);
const problems: string[] = [];
const read = (p: URL) => JSON.parse(readFileSync(p, "utf8"));

// Shared data must stay public and site-free: no preview hosts,
// private paths, tracking references or insecure URLs.
const FORBIDDEN = new RegExp([
  "preview" + "\\.openstreambox",
  "\\.ts\\.net|tail" + "net|local" + "host|127\\.0\\.0\\.1",
  "/ho" + "me/|/s" + "rv/|/Us" + "ers/",
  "no" + "tes/|\\.lo" + "cal/|\\bT\\d+\\b|\\bA\\d{3}\\b",
  "what" + "-fits",
].join("|"), "i");
const INSECURE = new RegExp("http" + "://", "i");

export function hygiene(data: Record<FileName, any>): string[] {
  const out: string[] = [];
  const walk = (x: any, where: string) => {
    if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${where}[${i}]`));
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) walk(v, `${where}.${k}`);
    else if (typeof x === "string") { const m = x.match(FORBIDDEN) ?? x.match(INSECURE); if (m) out.push(`${where}: private or site-only reference '${m[0]}'`); }
  };
  for (const [name, doc] of Object.entries(data)) walk(doc, `data/${name}.json`);
  return out;
}

/** A product name as a whole word, case-insensitive (the same rule as the site build). */
export function productPattern(name: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i");
}

const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";

const stewards = new Set<string>(read(here("../stewards.json")).stewards.map((s: any) => s.github).filter(Boolean).map((s: string) => s.toLowerCase()));

export function semantic(data: Record<FileName, any>): string[] {
  const out: string[] = hygiene(data);
  const today = new Date().toISOString().slice(0, 10);
  for (const [dataset, doc] of Object.entries(data)) {
    const entries = doc[dataset] ?? doc.carriers;
    for (const entry of entries) {
      for (const row of [entry, ...(entry.plans ?? [])])
        if (row.checked_on > today) out.push(`${dataset}: ${row.id}: checked_on is in the future`);
    }
  }
  for (const carrier of data.plans.carriers)
    for (const plan of carrier.plans ?? [])
      for (const [field, fact] of planFacts(plan))
        if (fact.checked_on > today) out.push(`plans: ${carrier.id}/${plan.id}.${field}: checked_on is in the future`);
  for (const service of data.services.services)
    for (const source of service.sources ?? [])
      if (source.read_on > today) out.push(`services: ${service.id}: source read_on is in the future`);
  for (const service of data.services.services)
    for (const channel of service.support)
      if (channel.checked_on > today) out.push(`services: ${service.id}: support checked_on is in the future`);
  const dupes = (where: string, ids: string[]) => {
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) out.push(`${where}: duplicate id ${id}`);
  };
  const wordIds = new Set<string>(data.words.words.map((w: any) => w.id));
  dupes("words", data.words.words.map((w: any) => w.id));
  for (const w of data.words.words)
    for (const r of w.related) if (!wordIds.has(r)) out.push(`words: ${w.id}: related '${r}' is not in the list`);
  // The naming guide: the deprecated aliases stay generated, evidence isn't dated ahead, reviewers are listed stewards.
  for (const w of data.words.words) {
    if (JSON.stringify(w.aliases) !== JSON.stringify(wordAliases(w))) out.push(`words: ${w.id}: aliases is stale: run bun run aliases`);
    for (const e of w.naming?.evidence ?? []) if (e.read_on > today) out.push(`words: ${w.id}: evidence read_on is in the future`);
    const owners = new Set<string>();
    for (const e of w.naming?.evidence ?? []) {
      const service = data.services.services.find((s: any) => s.id === e.service);
      if (!service) out.push(`words: ${w.id}: evidence service '${e.service}' does not exist`);
      else if (e.support === "direct") owners.add(service.maker.trim().toLowerCase());
    }
    if (w.naming?.status === "reviewed" && owners.size < 2) out.push(`words: ${w.id}: reviewed needs direct evidence from two distinct owning makers`);
    for (const r of w.naming?.reviewed_by ?? [])
      if (!stewards.has(r.toLowerCase())) out.push(`words: ${w.id}: reviewed_by '${r}' is not a listed steward`);
  }
  dupes("answers", data.answers.answers.map((a: any) => a.id));
  for (const a of data.answers.answers)
    for (const r of a.words) if (!wordIds.has(r)) out.push(`answers: ${a.id}: word '${r}' is not in words`);
  dupes("services", data.services.services.map((s: any) => s.id));
  for (const s of data.services.services)
    for (const r of s.words) if (!wordIds.has(r)) out.push(`services: ${s.id}: word '${r}' is not in words`);
  const serviceIds = new Set<string>(data.services.services.map((s: any) => s.id));
  // Checks stay generic: no product names in a summary or a check; products are linked through services and guides.
  const products = data.services.services.map((s: any) => ({ name: s.name, re: productPattern(s.name) }));
  for (const a of data.answers.answers) {
    for (const r of a.services) if (!serviceIds.has(r)) out.push(`answers: ${a.id}: service '${r}' is not in services`);
    const texts: [string, string][] = [["summary", a.summary], ...a.checks.map((c: any, i: number): [string, string] => [`checks.${i}`, c.text])];
    for (const [where, text] of texts)
      for (const p of products) if (p.re.test(text)) out.push(`answers: ${a.id}: ${where} names the product '${p.name}'; link it through services or guides instead`);
  }
  // Every product sits somewhere on the chain; community entries point at the products they document instead.
  const kindOf = new Map<string, string>(data.services.services.map((s: any) => [s.id, s.kind]));
  for (const s of data.services.services) {
    const allowed: string[] = (RolesByKind as any)[s.kind] ?? [];
    if (!allowed.includes(s.role)) out.push(`services: ${s.id}: role '${s.role}' doesn't fit kind '${s.kind}' (allowed: ${allowed.join(", ")})`);
    if ((s.kind === "community") !== (s.class === "docs")) out.push(`services: ${s.id}: class 'docs' is for community entries, and only them`);
    if (["bonding", "cloud"].includes(s.class) && s.hosting === null) out.push(`services: ${s.id}: class '${s.class}' needs hosting: self or service`);
    if (s.class === "cloud" && s.hosting === "self") out.push(`services: ${s.id}: class 'cloud' is hosted for you; software you run yourself is class 'production' or 'bonding'`);
    if (s.kind === "community") {
      if (s.part.length) out.push(`services: ${s.id}: a community entry has no part; name the products it documents in covers`);
      if (!s.covers.length) out.push(`services: ${s.id}: a community entry needs covers`);
      for (const c of s.covers)
        if (!kindOf.has(c) || kindOf.get(c) === "community") out.push(`services: ${s.id}: covers '${c}', which is not a product in services`);
    } else {
      if (!s.part.length) out.push(`services: ${s.id}: needs at least one part`);
      if (s.covers.length) out.push(`services: ${s.id}: only community entries have covers`);
    }
  }
  dupes("guides", data.guides.guides.map((g: any) => g.id));
  const serviceName = new Map<string, string>(data.services.services.map((s: any) => [s.id, s.name]));
  const answerById = new Map<string, any>(data.answers.answers.map((a: any) => [a.id, a]));
  for (const g of data.guides.guides) {
    for (const r of g.covers) if (!serviceIds.has(r)) out.push(`guides: ${g.id}: covers '${r}', which is not in services`);
    if (g.publisher !== null && !g.covers.includes(g.publisher)) out.push(`guides: ${g.id}: publisher '${g.publisher}' must be one of covers, or null`);
    for (const r of g.words) if (!wordIds.has(r)) out.push(`guides: ${g.id}: word '${r}' is not in words`);
    for (const r of g.answers) {
      const a = answerById.get(r);
      if (!a) { out.push(`guides: ${g.id}: answer '${r}' is not in answers`); continue; }
      const parts = new Set(a.checks.map((c: any) => c.part).filter(Boolean));
      if (!g.covers.some((c: string) => a.services.includes(c)) && !g.part.some((p: string) => parts.has(p)))
        out.push(`guides: ${g.id}: linked to answer '${r}' but shares no covered service or chain part with it`);
    }
    if (g.covers.every((c: string) => serviceIds.has(c))) {
      const want = guideTitle(g, (id) => serviceName.get(id)!);
      if (g.title_display !== want) out.push(`guides: ${g.id}: title_display is stale ('${g.title_display}', expected '${want}'): run bun titles`);
    }
  }
  // Standards link catalogued products by id; other_users is only for products that aren't catalogued.
  dupes("standards", data.standards.standards.map((x: any) => x.id));
  const catalogued = new Map<string, string>(data.services.services.map((s: any) => [s.name.toLowerCase(), s.id]));
  for (const x of data.standards.standards) {
    for (const r of x.service_ids) if (!serviceIds.has(r)) out.push(`standards: ${x.id}: service '${r}' is not in services`);
    dupes(`standards.${x.id}.service_ids`, x.service_ids);
    for (const name of x.other_users) {
      const id = catalogued.get(name.toLowerCase());
      if (id) out.push(`standards: ${x.id}: '${name}' is catalogued; list it in service_ids as '${id}'`);
    }
    const hidden = x.openness === "not-public";
    if (x.url === null && !hidden) out.push(`standards: ${x.id}: url may be null only when openness is not-public`);
    if (!x.sources.length && !hidden) out.push(`standards: ${x.id}: needs at least one public source`);
    // A format only counts as shared, or as an app format, once a second named product writes or reads it.
    const named = x.service_ids.length + x.other_users.length;
    if (x.group === "app-formats" && named < 2) out.push(`standards: ${x.id}: an app format needs a named second product that writes or reads it`);
    if (["shared", "hardware-codecs"].includes(x.group) && x.status === "in-use" && named < 2) out.push(`standards: ${x.id}: a shared item in use needs at least two named products`);
  }
  // One thing, one definition: a standard that is also a glossary word points at the word and shares its id.
  const wordById = new Map<string, any>(data.words.words.map((w: any) => [w.id, w]));
  const wordByName = new Map<string, string>();
  for (const w of data.words.words)
    for (const n of [w.term, w.naming?.label, ...w.also_called, ...(w.naming?.alternatives ?? []).map((a: any) => a.term), ...w.search_terms])
      if (n) wordByName.set(n.toLowerCase(), w.id);
  for (const x of data.standards.standards) {
    if (x.word !== undefined && !wordById.has(x.word)) out.push(`standards: ${x.id}: word '${x.word}' is not in words`);
    if (x.word !== undefined) continue;
    const short = x.name.replace(/\s*\(.*\)\s*$/, "");
    const same = wordById.has(x.id) ? x.id : wordByName.get(x.name.toLowerCase()) ?? wordByName.get(short.toLowerCase());
    if (same) out.push(`standards: ${x.id}: duplicates the glossary word '${same}'; give it that id, set word, and drop the description`);
  }
  // Comparison facts: efficiency compares with other codecs of the same kind; no fact is dated in the future.
  const codecs = new Map<string, any>(data.standards.standards.filter((x: any) => x.codec).map((x: any) => [x.id, x]));
  for (const x of data.standards.standards) {
    for (const r of x.codec?.efficiency?.compared_with ?? []) {
      const other = codecs.get(r);
      if (!other || r === x.id) out.push(`standards: ${x.id}: efficiency compared_with '${r}', which is not another codec entry`);
      else if (other.codec.media !== x.codec.media) out.push(`standards: ${x.id}: efficiency compared_with '${r}', a ${other.codec.media} codec`);
    }
    for (const [where, f] of comparisonFacts(x)) if (f.checked_on > today) out.push(`standards: ${x.id}: ${where}: checked_on is in the future`);
  }
  const carrierById = new Map<string, any>(data.plans.carriers.map((c: any) => [c.id, c]));
  const countries = new Set(COUNTRY_CODES.split(" "));
  dupes("plans.carriers", data.plans.carriers.map((c: any) => c.id));
  for (const c of data.plans.carriers) {
    if (!countries.has(c.country)) out.push(`plans: ${c.id}: unknown country code`);
    const host = c.host_network_id === null ? null : carrierById.get(c.host_network_id);
    if (c.network_type === "MNO" && c.host_network_id !== null) out.push(`plans: ${c.id}: MNO must have null host_network_id`);
    if (c.network_type === "MVNO" && (!host || host.network_type !== "MNO" || host.country !== c.country))
      out.push(`plans: ${c.id}: MVNO needs an MNO host in the same country`);
    dupes(`plans.${c.id}.plans`, (c.plans ?? []).map((p: any) => p.id));
  }
  return out;
}

// The project's one public chat invite, a contact link for people without a GitHub account.
// Support channel invites have their own schema and evidence requirements.
export const CONTACT_INVITE = "https://disco" + "rd.gg/KChVwU6fjk";
export const CONTACT_FILES = new Set(["README.md", "CONTRIBUTING.md"]);

// Scan the distributable repository tree as well as the parsed datasets.
function scanTree(dir: URL): void {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if ([".git", "node_modules", "__pycache__", ".catalogue-watch"].includes(entry.name)) continue;
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) { scanTree(path); continue; }
    let text = readFileSync(path, "utf8");
    if (CONTACT_FILES.has(path.href.slice(here("../").href.length))) text = text.replaceAll(CONTACT_INVITE, "");
    if (FORBIDDEN.test(text)) problems.push(`tree: ${entry.name}: private reference`);
  }
}
scanTree(here("../"));

const data = {} as Record<FileName, any>;
for (const name of Object.keys(files) as FileName[]) {
  const doc = read(here(`../data/${name}.json`));
  const r = files[name].safeParse(doc);
  if (!r.success) for (const i of r.error.issues) problems.push(`data/${name}.json: ${i.path.join(".")}: ${i.message}`);
  data[name] = doc;
  const committed = readFileSync(here(`../schema/json/${name}.schema.json`), "utf8");
  if (committed !== exported(name)) problems.push(`json/${name}.schema.json is stale: run bun scripts/export.ts`);
}
if (readFileSync(here("../schema/json/parts.json"), "utf8") !== partsJson()) problems.push("json/parts.json is stale: run bun scripts/export.ts");
if (!problems.length) problems.push(...semantic(data));

// Fixtures: <file>--<what>.json, each must fail.
// Documentation uses the same required provenance as tutorials.
const docsGuide = {...data.guides.guides[0], kind: "docs"};
if (!files.guides.safeParse({about: "", guides: [docsGuide]}).success) problems.push("valid docs guide rejected");
let fixtures = 0;
for (const f of readdirSync(here("../schema/fixtures/")).filter((f) => f.endsWith(".json")).sort()) {
  const name = f.split("--")[0] as FileName;
  if (!(name in files)) { problems.push(`fixtures/${f}: unknown file kind`); continue; }
  fixtures++;
  if (files[name].safeParse(read(here(`../schema/fixtures/${f}`))).success) problems.push(`fixtures/${f}: zod accepted an invalid file`);
}

// The self-tests below build on valid data; with problems in the data, report those first.
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}

const carrier = {id: "sample-network", name: "Sample Network", country: "DE", network_type: "MNO", host_network_id: null,
  plans: [{id: "sample-plan", name: "Sample Plan", ...Object.fromEntries([
    ["data_cap_gb", 50], ["max_down_mbps", 100], ["max_up_mbps", 25],
    ["throttle_down_kbps", 64], ["throttle_up_kbps", 16], ["priority", null],
    ["hotspot", "allowed"], ["hotspot_gb", null], ["router_or_modem", "unknown"],
    ["continuous_video", "unknown"], ["roaming_routing", null],
  ].map(([key, value]) => [key, {value, source: "https://example.org/plan", checked_on: "2026-11-14"}]))}],
  esim: false, official_url: "https://example.org/", coverage_map_url: "https://example.org/coverage",
  sources: [{label: "Official details", url: "https://example.org/details"}], checked_on: "2026-11-14"};
const candidate = structuredClone(data);
candidate.plans.carriers = [carrier, {...carrier, id: "sample-virtual", network_type: "MVNO", host_network_id: carrier.id}];
if (!files.plans.safeParse(candidate.plans).success || semantic(candidate).length) problems.push("valid carrier fixture rejected");
for (const mutation of [
  (d: any) => { d.plans.carriers[0].plans[0].max_up_mbps.checked_on = "2999-01-01"; },
  (d: any) => { d.plans.carriers[1].host_network_id = "missing"; },
  (d: any) => { d.plans.carriers[1].country = "FR"; },
  (d: any) => { d.plans.carriers[0].country = "ZZ"; },
  (d: any) => { d.plans.carriers.push(d.plans.carriers[0]); },
  (d: any) => { d.plans.carriers[0].host_network_id = carrier.id; },
  (d: any) => { d.plans.carriers[0].plans.push(d.plans.carriers[0].plans[0]); },
]) {
  const bad = structuredClone(candidate); mutation(bad);
  if (!semantic(bad).length) problems.push("invalid carrier reference accepted");
}
const standard = {id: "sample-format", checked_on: "2026-11-14", name: "Sample format", group: "app-formats", kind: "settings",
  status: "in-use", openness: "open", licence: null, maker: "Sample maker", url: "https://example.org/format",
  description: "A synthetic format.", service_ids: [data.services.services[0].id, data.services.services[1].id], other_users: [],
  sources: [{label: "Format page", url: "https://example.org/format"}], notes: null};
const withStandard = structuredClone(data);
withStandard.standards.standards = [standard];
if (!files.standards.safeParse(withStandard.standards).success || semantic(withStandard).length) problems.push("valid standard fixture rejected");
for (const mutation of [
  (d: any) => { d.standards.standards[0].service_ids.push("missing-service"); },
  (d: any) => { d.standards.standards[0].service_ids.push(d.standards.standards[0].service_ids[0]); },
  (d: any) => { d.standards.standards[0].other_users.push(data.services.services[0].name); },
  (d: any) => { d.standards.standards[0].service_ids.pop(); },
  (d: any) => { d.standards.standards[0].group = "shared"; d.standards.standards[0].service_ids.pop(); },
  (d: any) => { d.standards.standards[0].url = null; },
  (d: any) => { d.standards.standards[0].sources = []; },
  (d: any) => { d.standards.standards.push(d.standards.standards[0]); },
  (d: any) => { d.standards.standards[0].id = data.words.words[0].id; },
  (d: any) => { d.standards.standards[0].name = data.words.words[0].term; },
  (d: any) => { d.standards.standards[0].name = `${data.words.words[0].also_called[0]} (long name)`; },
  (d: any) => { const s = d.standards.standards[0]; s.id = "not-a-word"; s.word = "not-a-word"; delete s.description; },
]) {
  const bad = structuredClone(withStandard); mutation(bad);
  if (!semantic(bad).length) problems.push("invalid standard reference accepted");
}
// A glossary word as a standard: same id, word set, no description of its own.
const asWord = structuredClone(withStandard);
const w0 = data.words.words[0];
asWord.standards.standards = [{...standard, id: w0.id, name: w0.term, word: w0.id, description: undefined}];
delete asWord.standards.standards[0].description;
if (!files.standards.safeParse(asWord.standards).success || semantic(asWord).length) problems.push("valid glossary-word standard rejected");
// Codec comparison references.
const fact = {text: "A synthetic claim.", sources: [{label: "Source", url: "https://example.org/source"}], checked_on: "2026-11-14"};
const yes = {...fact, value: "yes"};
const hw = {encode: "yes", decode: "yes", ...fact};
const codecFacts = (media: string) => ({media, licensing: {...fact, value: "royalty-free"}, efficiency: null,
  hardware: media === "video" ? {ios: hw, android: hw, rk3588: hw, intel: hw, nvidia: hw, apple_mac: hw} : null,
  ingest: {twitch: yes, youtube: yes, kick: yes}});
const codec = (id: string, media: string) => ({...standard, id, name: id, group: "hardware-codecs", kind: "codec", codec: codecFacts(media)});
const withCodecs = structuredClone(data);
withCodecs.standards.standards = [codec("sample-old", "video"), codec("sample-new", "video"), codec("sample-sound", "audio")];
withCodecs.standards.standards[1].codec.efficiency = {...fact, compared_with: ["sample-old"]};
if (!files.standards.safeParse(withCodecs.standards).success || semantic(withCodecs).length) problems.push("valid codec fixture rejected");
for (const mutation of [
  (d: any) => { d.standards.standards[1].codec.efficiency.compared_with = ["sample-sound"]; },
  (d: any) => { d.standards.standards[1].codec.efficiency.compared_with = ["sample-new"]; },
  (d: any) => { d.standards.standards[1].codec.efficiency.compared_with = ["missing"]; },
  (d: any) => { d.standards.standards[1].codec.ingest.kick.checked_on = "2999-01-01"; },
]) {
  const bad = structuredClone(withCodecs); mutation(bad);
  if (!semantic(bad).length) problems.push("invalid codec comparison accepted");
}
// Service classes and hosting: docs only for community entries; bonding and cloud say who runs them.
const serviceAt = (cls: string) => data.services.services.findIndex((s: any) => s.class === cls);
for (const mutation of [
  (d: any) => { d.services.services[serviceAt("bonding")].hosting = null; },
  (d: any) => { d.services.services[serviceAt("cloud")].hosting = null; },
  (d: any) => { d.services.services[serviceAt("cloud")].hosting = "self"; },
  (d: any) => { d.services.services[serviceAt("docs")].class = "production"; },
  (d: any) => { d.services.services[serviceAt("phone-app")].class = "docs"; },
]) {
  const bad = structuredClone(data); mutation(bad);
  if (!semantic(bad).length) problems.push("invalid service class or hosting accepted");
}
// Naming guide: rules that need the other files (generated aliases, evidence dates, steward list).
const named = data.words.words.findIndex((w: any) => w.naming);
const reviewed = structuredClone(data);
Object.assign(reviewed.words.words[named].naming, { status: "reviewed", reviewed_by: ["pjeweb", "sample-second-steward"] });
if (!semantic(reviewed).some((p) => p.includes("not a listed steward"))) problems.push("a reviewer outside stewards.json was accepted");
for (const mutation of [
  (d: any) => { d.words.words[named].aliases.push("Something else"); },
  (d: any) => { d.words.words[named].also_called.push("A new synonym"); },
  (d: any) => { d.words.words[named].naming.evidence[0].read_on = "2999-01-01"; },
]) {
  const bad = structuredClone(data); mutation(bad);
  if (!semantic(bad).length) problems.push("invalid naming data accepted");
}
const chat = "https://disco" + "rd.gg/example";
if (files.services.safeParse({...data.services, services: [{...data.services.services[0], url: chat}]}).success)
  problems.push("chat URL accepted");
for (const p of problems) console.error(p);
if (problems.length) process.exit(1);
console.log(`ok: zod accepts the ${Object.keys(files).length} data files and rejects ${fixtures} fixtures`);
