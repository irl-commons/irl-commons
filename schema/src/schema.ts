import { z } from "zod";

/** A lowercase slug, used as an anchor and as a cross-reference. */
export const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and single dashes");
/** An https URL without spaces; chat invites are not accepted in shared data. */
export const HttpsUrl = z.string().regex(/^https:\/\/(?![^/]*discord(?:app)?\.(?:gg|com))\S+$/, "an https:// URL, not a chat invite");
/** A BCP 47 style tag such as es-419 or pt-BR. */
export const LanguageTag = z.string().regex(/^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$/, "a language tag such as es-419 or pt-BR");
/** Non-empty text: at least one non-space character (the same rule in zod and JSON Schema). */
export const Text = z.string().regex(/\S/, "not empty");
export const Day = z.iso.date();
export const Link = z.strictObject({ label: Text.describe("What the page is, in a few words."), url: HttpsUrl.describe("The page's https address.") });

// ---------- Words ----------

export const WordL10n = z.strictObject({
  term: Text.describe("The term in that language. Usually the scene's English word."),
  plain: Text.describe("The explanation, in that language."),
  heard_when: z.string().optional().describe("When the word comes up, in that language."),
});

// Naming guide for app makers: an optional `naming` block on a word.
export const NamingStatus = z.enum(["also-used", "narrower", "technical", "ambiguous"]).describe("also-used: means the same thing. narrower: one part or one kind of it. technical: the engineering name. ambiguous: here it can also mean something else.");
export const LabelCase = z.enum(["sentence", "proper", "acronym"]).describe("How the label is written: sentence case (\"Relay server\"; acronyms stay capitals), a proper name, or an acronym (\"BRB\").");
/** A GitHub login, as listed in stewards.json. */
export const Login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "a GitHub login");

export const Alternative = z.strictObject({
  term: Text.max(60).describe("The other name."),
  status: NamingStatus,
  why: Text.max(200).optional().describe("Why it isn't the recommended label here, about the word. Required unless the status is also-used."),
  see: Id.optional().describe("The word this name normally means, for an ambiguous, narrower or product-specific also-used name."),
  seen_in: z.array(Id).min(1).optional().describe("Service ids whose evidence shows exactly this name. Never on ambiguous names."),
}).superRefine((a, ctx) => {
  if (a.status !== "also-used" && a.why === undefined)
    ctx.addIssue({ code: "custom", path: ["why"], message: "give a reason unless the status is also-used" });
  if (a.status === "ambiguous" && a.seen_in !== undefined)
    ctx.addIssue({ code: "custom", path: ["seen_in"], message: "ambiguous items don't name products" });
}).meta({
  allOf: [
    { if: { properties: { status: { not: { const: "also-used" } } } }, then: { required: ["why"] } },
    { if: { properties: { status: { const: "ambiguous" } } }, then: { not: { required: ["seen_in"] } } },
  ],
});

export const SourceKind = z.enum(["public primary", "behind login (supplied by a user)"]).describe("Where the claim comes from. Left out on older evidence, which means public primary.");
export const Source = z.strictObject({
  kind: SourceKind,
  url: HttpsUrl.describe("The public page. For a description behind a login, the public login page."),
  read_on: Day.describe("The day it was read, or the day a description was supplied."),
  note: Text.max(300).describe("What the page shows, in a sentence or two."),
});

/** A source, its observed label, and whether it directly supports this meaning. */
export const Evidence = z.strictObject({
  kind: SourceKind.optional(),
  service: Id.describe("The service id of the product whose label the page shows."),
  label: Text.describe("The label exactly as the product shows it."),
  support: z.enum(["direct", "context-only"]).describe("direct: the page shows this label for this meaning. context-only: related use or doubt; never counts for review."),
  url: HttpsUrl.describe("The public page."),
  read_on: Day.describe("The day it was read."),
  note: Text.max(300).describe("What the page shows, quoting the label."),
});

export const Naming = z.strictObject({
  label: Text.max(40).describe("The recommended label for the place in scope."),
  short_label: Text.max(20).optional().describe("A shorter label for tight spaces."),
  case: LabelCase,
  plural: Text.max(40).optional().describe("The plural of the label."),
  scope: Text.max(200).describe("Where the label fits: the screen or setting it names."),
  why: Text.max(300).describe("Why this label, about the word, never about a maker."),
  alternatives: z.array(Alternative).describe("Other names, each with a status."),
  evidence: z.array(Evidence).describe("Public pages that show a product's own label."),
  translation_note: Text.max(300).describe("Help for translators."),
  status: z.enum(["draft", "reviewed"]).describe("draft, or reviewed. Reviewed needs direct evidence from two makers and two stewards."),
  reviewed_by: z.array(Login).optional().describe("The stewards who reviewed it: at least two for reviewed, none for draft."),
}).superRefine((n, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  const makers = new Set(n.evidence.filter((e) => e.support === "direct").map((e) => e.service));
  if (n.status === "reviewed" && makers.size < 2) issue("evidence", "reviewed needs direct evidence from at least two services (distinct owners checked across files)");
  if (n.status === "reviewed" && new Set((n.reviewed_by ?? []).map((x) => x.toLowerCase())).size < 2)
    issue("reviewed_by", "reviewed needs a second steward");
  if (n.status === "draft" && n.reviewed_by !== undefined) issue("reviewed_by", "only reviewed entries list reviewers");
  n.alternatives.forEach((a, i) => {
    for (const m of a.seen_in ?? []) if (!n.evidence.some((e) => e.service === m && e.support === "direct" && e.label.toLowerCase() === a.term.toLowerCase())) issue("alternatives", `alternatives[${i}].seen_in: '${m}' has no evidence`);
    if (a.term.toLowerCase() === n.label.toLowerCase()) issue("alternatives", `alternatives[${i}] repeats the label`);
  });
  const terms = n.alternatives.map((a) => a.term.toLowerCase());
  if (new Set(terms).size !== terms.length) issue("alternatives", "an alternative is listed twice");
  if (n.case === "acronym" && /[a-z]/.test(n.label)) issue("case", "an acronym label has no lowercase letters");
  if (n.case === "sentence" && !sentenceCase(n.label)) issue("case", "sentence case: capital first letter, later words lowercase unless they are acronyms");
}).meta({
  allOf: [
    { if: { properties: { status: { const: "reviewed" } } }, then: { required: ["reviewed_by"], properties: { reviewed_by: { minItems: 2, uniqueItems: true }, evidence: { minItems: 2 } } } },
    { if: { properties: { status: { const: "draft" } } }, then: { not: { required: ["reviewed_by"] } } },
    { if: { properties: { case: { const: "acronym" } } }, then: { properties: { label: { pattern: "^[^a-z]*$" } } } },
  ],
});

/** "SRT latency", "Relay server", "Max bitrate": first letter capital, later words lowercase or all capitals. */
export function sentenceCase(label: string): boolean {
  const words = label.split(/\s+/);
  return /^[A-Z0-9]/.test(words[0]) && words.slice(1).every((w) => w === w.toLowerCase() || w === w.toUpperCase());
}

/** The deprecated `aliases` list, generated for one release from the fields that replaced it:
 *  the label (when it differs from the term), also_called, the plural, the other names and the search terms. */
export function wordAliases(w: { term: string; also_called: string[]; search_terms: string[]; naming?: { label: string; plural?: string; alternatives: { term: string }[] } }): string[] {
  const out: string[] = [];
  const seen = new Set([w.term.toLowerCase()]);
  const n = w.naming;
  for (const x of [n?.label, ...w.also_called, n?.plural, ...(n?.alternatives ?? []).map((a) => a.term), ...w.search_terms])
    if (x !== undefined && !seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); out.push(x); }
  return out;
}

export const Word = z.strictObject({
  id: Id.describe("Permanent id, used as an anchor and in links from other files."),
  checked_on: Day.optional().describe("The day the entry was compared with its public source. Left out when no check is recorded; freshness is then unknown."),
  term: Text.describe("The word as streamers use it."),
  also_called: z.array(Text).describe("True synonyms: other names for exactly this thing. With a naming block, each one is the label or an also-used alternative."),
  search_terms: z.array(Text).describe("For search only, never shown as a name: plurals, units, spellings and nearby phrases."),
  aliases: z.array(Text).meta({ deprecated: true, description: "Deprecated, kept for one release. Generated by `bun run aliases` from the label, also_called, the plural, the other names and search_terms." }),
  tier: z.enum(["core", "more"]).describe("core: the few basics people meet first. more: everything else."),
  who: z.enum(["streamer", "helper", "both"]).describe("Who usually meets the word."),
  heard_when: z.string().describe("When the word comes up, in one sentence. May be empty."),
  plain: Text.describe("The explanation in simple language. It says what the word means, not how to fix anything."),
  related: z.array(Id).describe("Ids of related words in words.json."),
  source: Text.describe("A public source for the explanation."),
  uncertain: z.boolean().describe("True while the explanation is not settled."),
  l10n: z.record(LanguageTag, WordL10n).optional().describe("Translations by language tag, such as es-419 or pt-BR. A native speaker reads each one before it is published."),
  naming: Naming.optional().describe("A naming guide for app makers: a recommended label for one screen or setting. Advice, not the only right name."),
}).superRefine((w, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
  const also = lower(w.also_called), search = lower(w.search_terms);
  if (also.includes(w.term.toLowerCase())) issue("also_called", "repeats the term");
  for (const x of also) if (search.includes(x)) issue("search_terms", `'${x}' is already in also_called`);
  if (w.naming) {
    const same = lower(w.naming.alternatives.filter((a) => a.status === "also-used").map((a) => a.term));
    const label = w.naming.label.toLowerCase();
    for (const x of also) if (x !== label && !same.includes(x)) issue("also_called", `'${x}' is neither the label nor an also-used alternative`);
    for (const x of same) if (!also.includes(x)) issue("naming", `the also-used alternative '${x}' belongs in also_called too`);
  }
});

export const WordsFile = z.strictObject({
  about: z.string().describe("What this file holds, in a sentence or two, with a link to the docs."),
  words: z.array(Word).min(1),
}).superRefine((f, ctx) => {
  // Recommended labels stay unique; ambiguous/narrower collisions require a resolving see.
  const labels = new Map<string, string>();
  f.words.forEach((w, i) => {
    if (!w.naming) return;
    const key = w.naming.label.toLowerCase();
    if (labels.has(key)) ctx.addIssue({ code: "custom", path: ["words", i, "naming", "label"], message: `'${w.naming.label}' is already the label of ${labels.get(key)}` });
    else labels.set(key, w.id);
  });
  f.words.forEach((w, i) => {
    for (const name of w.also_called) {
      const other = labels.get(name.toLowerCase());
      const scoped = w.naming?.alternatives.some(a => a.term.toLowerCase() === name.toLowerCase() && a.status === "also-used" && a.see === other && a.seen_in?.length);
      if (other && other !== w.id && !scoped) ctx.addIssue({ code: "custom", path: ["words", i, "also_called"], message: `'${name}' is the label of ${other}` });
    }
    w.naming?.alternatives.forEach((a, j) => {
      const other = labels.get(a.term.toLowerCase());
      const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["words", i, "naming", "alternatives", j], message });
      if (a.see && (!(["ambiguous", "narrower"].includes(a.status) || (a.status === "also-used" && !!a.seen_in?.length)) || !f.words.some((target) => target.id === a.see && target.id !== w.id && (target.naming?.label ?? target.term).toLowerCase() === a.term.toLowerCase())))
        issue("see must resolve to the word normally named by an ambiguous, narrower or product-scoped also-used alternative");
      if (other && other !== w.id && (!(["ambiguous", "narrower"].includes(a.status) || (a.status === "also-used" && !!a.seen_in?.length)) || a.see !== other))
        issue(`'${a.term}' is the label of ${other}; ambiguous or narrower needs see: ${other}`);
    });
  });
});

// ---------- Answers (quick checks) ----------

export const Part = z.enum(["camera", "sender", "connections", "receiver", "obs", "platform"]).describe("Where along the chain: camera (camera and mic into the sender), sender (the app or box), connections, receiver, obs, platform.");

/** One short check in plain words: which part to look at and what to look for.
 *  No product names or product settings; those live in guides and services. */
export const Check = z.strictObject({
  part: Part.optional(),
  text: Text.max(140).describe("One short check in simple language. No product names or product settings."),
});

export const Answer = z.strictObject({
  id: Id.describe("Permanent id, used as an anchor and in links from other files."),
  checked_on: Day.optional().describe("The day the entry was compared with its public source. Left out when no check is recorded; freshness is then unknown."),
  question: Text.describe("The question as people ask it."),
  summary: Text.max(220).describe("Which part most likely broke, in one or two sentences."),
  checks: z.array(Check).min(1).max(3).describe("One to three checks, in the order worth trying."),
  words: z.array(Id).describe("Ids of related words in words.json."),
  services: z.array(Id).describe("Service ids of products whose own docs and support help with this question."),
  sources: z.array(Link).min(1).describe("The public docs behind the checks. At least one."),
});

export const AnswersFile = z.strictObject({
  about: z.string().describe("What this file holds, in a sentence or two, with a link to the docs."),
  answers: z.array(Answer).min(1),
});

// ---------- Services catalogue ----------

export const ServiceKind = z.enum(["app", "relay", "hub", "hardware", "production", "community"]).describe("What kind of product it is. The kind limits which roles it can have.");
export const Platform = z.enum(["android", "ios", "windows", "macos", "linux", "web", "hardware", "service"]).describe("Where it runs. hardware: its own device. service: a hosted service.");

export const Role = z.enum([
  "streaming-app", "extra-connections", "camera-capture", "remote-control", "chat-overlays", "other-app",
  "relay", "hub", "production", "hardware", "community",
]).describe("What it is for, as a reader picks it. streaming-app: sends your stream. extra-connections: adds a network path. camera-capture: brings a camera or screen in. remote-control: runs OBS or the sender from another device. chat-overlays: chat, alerts, overlays and location. other-app: an app that fits none of these. relay: relays, receivers and protocols. hub: hosted hubs that go out to the platform. production: OBS and its tools. hardware: encoders, backpacks and parts. community: docs and wikis.");

export const ServiceClass = z.enum([
  "phone-app", "helper-app", "connections", "bonding", "hardware", "parts", "store", "cloud", "production",
  "building-block", "docs",
]).describe("Which overview it belongs in, as a streamer looks for it. phone-app: the phone app that sends the stream. helper-app: small apps around it (chat, location, remote control, a camera into the phone). connections: ways to add another network. bonding: receivers and relays that join a bonded stream, and bonding services. hardware: backpacks, encoders and kits. parts: add-ons for a box or backpack. store: shops for built backpacks, cases and parts. cloud: hosted production (cloud OBS, drop protection, restreaming). production: OBS and tools on your own computer or in the browser. building-block: protocols, libraries and media servers that apps are built from. docs: community docs and wikis.");

export const Hosting = z.enum(["self", "service"]).describe("self: software you run on your own server or computer. service: someone runs it for you, paid or free.");

export const ServiceTag = z.enum(["camera-in", "multi-camera", "scene-control"]).describe("camera-in: takes the picture from a standalone camera (a DSLR, mirrorless or action camera) over HDMI, USB or the network. multi-camera: shows several cameras in one scene at once. scene-control: switches the scenes in OBS or a hub from outside it, by remote, chat commands or on its own.");

/** Which roles each kind may take. */
export const RolesByKind: Record<z.infer<typeof ServiceKind>, z.infer<typeof Role>[]> = {
  app: ["streaming-app", "extra-connections", "camera-capture", "remote-control", "chat-overlays", "other-app"],
  relay: ["relay", "extra-connections"],
  hub: ["hub"],
  production: ["production", "chat-overlays", "remote-control", "camera-capture"],
  hardware: ["hardware", "extra-connections"],
  community: ["community"],
};

export const Service = z.strictObject({
  id: Id.describe("Permanent id, used as an anchor and in links from other files."),
  checked_on: Day.describe("The day the entry was compared with its public source."),
  name: Text.describe("The name as the maker writes it."),
  kind: ServiceKind,
  role: Role,
  class: ServiceClass,
  hosting: Hosting.nullable().describe("Who runs the server side. Set for bonding and cloud entries; null where it doesn't apply."),
  maker: Text.describe("The maker or organisation that owns it."),
  url: HttpsUrl.describe("The maker's own page."),
  links: z.array(Link).describe("Other official pages."),
  open_source: z.boolean().nullable().describe("True when the code is open source. Null when unknown."),
  licence: Text.nullable().describe("The licence, or null."),
  status: Text.nullable().describe("A release stage the maker states, such as beta or pre-release. Null for a normal release."),
  description: Text.describe("What it is, in a sentence or two, written for this list."),
  sources: z.array(Source).min(1).optional().describe("Sources for claims the maker's page doesn't show, such as a description behind a login."),
  platforms: z.array(Platform).min(1).describe("Where it runs."),
  part: z.array(Part).max(3).describe("Where along the chain it sits, the main part first. Empty only for community entries."),
  covers: z.array(Id).describe("For community entries (docs, wikis): the products they document. Empty otherwise."),
  support: z.array(Link).describe("Official public help: help centres, docs, issue trackers, contact pages. No chat invites."),
  /** Optional tags from ServiceTag, each at most once. */
  tags: z.array(ServiceTag).refine((t) => new Set(t).size === t.length, "each tag at most once").meta({ uniqueItems: true }),
  words: z.array(Id).describe("Ids of related words in words.json."),
});

export const ServicesFile = z.strictObject({
  about: z.string().describe("What this file holds, in a sentence or two, with a link to the docs."),
  services: z.array(Service).min(1),
});

// ---------- Guides ----------

/** What a guide helps with, as a short task, by chain part. Used to generate `title_display`. */
export const PartTask: Record<z.infer<typeof Part>, string> = {
  camera: "connect the camera",
  sender: "set up the sender",
  connections: "bond the connections",
  receiver: "run the receiver",
  obs: "set up OBS and switching",
  platform: "go out to the platform",
};

/** The generated display title: "Moblin with IRLhosting: set up the sender" when the
 *  publisher is one of several covered products, "OBS Studio: set up OBS and switching"
 *  for one product, "A, B and C: …" otherwise. Alternatives before "with" are joined by "or". */
export function guideTitle(g: { covers: string[]; publisher: string | null; part: string[] }, name: (id: string) => string): string {
  const join = (xs: string[], last: string) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${last} ${xs[xs.length - 1]}`);
  const others = g.covers.filter((c) => c !== g.publisher);
  const who = g.publisher && g.covers.includes(g.publisher) && others.length
    ? `${join(others.map(name), "or")} with ${name(g.publisher)}`
    : join(g.covers.map(name), "and");
  return `${who}: ${PartTask[g.part[0] as keyof typeof PartTask]}`;
}

export const Guide = z.strictObject({
  id: Id.describe("Permanent id, used as an anchor and in links from other files."),
  checked_on: Day.describe("The day the entry was compared with its public source."),
  title: Text.describe("The page's own title."),
  title_display: Text.describe("Generated by scripts/titles.ts from covers, publisher and part. Never written by hand."),
  url: HttpsUrl.describe("The tutorial."),
  creator: Text.describe("Who made it."),
  publisher: Id.nullable().describe("The service id of the maker who wrote it, when that maker is one of covers. Otherwise null."),
  language: LanguageTag.describe("The language it is in."),
  kind: z.enum(["article", "video", "docs"]).describe("article, video or docs."),
  published: Day.nullable().describe("The date the page states, or null."),
  covers: z.array(Id).min(1).describe("The products it is about, as service ids."),
  part: z.array(Part).min(1).max(3).describe("Where along the chain it helps. The first one decides the title and the group."),
  words: z.array(Id).describe("Ids of related words in words.json."),
  answers: z.array(Id).describe("Ids of quick checks in answers.json it helps with."),
});

export const GuidesFile = z.strictObject({
  about: z.string().describe("What this file holds, in a sentence or two, with a link to the docs."),
  guides: z.array(Guide).min(1),
});

// ---------- Carriers and optional plans ----------

export const Plan = z.strictObject({
  id: Id.describe("Permanent id, unique within the carrier."),
  checked_on: Day.describe("The day the plan was compared with its source."),
  name: Text.describe("The plan's name, as the carrier writes it."),
  data_cap_gb: z.number().nonnegative().nullable().describe("Data cap in decimal GB. Null means unlimited."),
  throttle_after_cap_kbps: z.number().nonnegative().nullable().describe("Speed after the cap, in kbit/s. Null means unknown."),
  tethering_allowed: z.boolean().nullable().describe("Whether the plan allows tethering. Null means unknown."),
  roaming_routing: z.enum(["home-routed", "local-breakout", "unknown"]).describe("How roaming data is routed. Never guessed from marketing."),
  source_url: HttpsUrl.describe("The plan's official page."),
});
export const Carrier = z.strictObject({
  id: Id.describe("Permanent id, used as an anchor and in links from other files."),
  checked_on: Day.describe("The day the entry was compared with its public source."),
  name: Text.describe("The carrier's name, as it writes it."),
  country: z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 country code").describe("ISO 3166-1 alpha-2 country code."),
  network_type: z.enum(["MNO", "MVNO"]).describe("MNO: runs its own network. MVNO: uses another carrier's network."),
  host_network_id: Id.nullable().describe("For an MVNO, the id of the MNO in the same country whose network it uses. Null for an MNO."),
  esim: z.boolean().describe("True when it offers eSIM."),
  official_url: HttpsUrl.describe("The carrier's own page."),
  coverage_map_url: HttpsUrl.describe("The carrier's coverage map."),
  sources: z.array(Link).min(1).describe("Official pages that back the carrier fields."),
  plans: z.array(Plan).optional().describe("Optional plans, each with its own source and date."),
});
export const PlansFile = z.strictObject({
  about: Text.describe("What this file holds, in a sentence or two, with a link to the docs."),
  carriers: z.array(Carrier),
});

// ---------- Standards (shared formats and protocols) ----------

export const StandardGroup = z.enum(["shared", "app-formats", "hardware-codecs", "steward-projects"]).describe("shared: several makers' products write or read it. app-formats: one app's own format that a named second product also writes or reads. hardware-codecs: codecs and camera interfaces. steward-projects: made by stewards of this repository, listed apart so they are not mistaken for established standards.");
export const StandardKind = z.enum(["protocol", "format", "settings", "data", "codec", "interface"]).describe("protocol: two programs speak it over a network or link. format: a file, URL or message shape. settings: a setup link or settings file one app imports. data: a dataset. codec: a way to compress video or audio. interface: a cable or bus that carries a camera's picture.");
export const Openness = z.enum(["open", "documented-closed", "undocumented", "not-public"]).describe("open: a public spec, or open-licensed code whose docs describe it. documented-closed: the maker describes it publicly, but the spec is partial or the product closed. undocumented: no written description; public code, if any, is the only reference. not-public: not published yet.");

// Comparison facts. Each one is a single claim for one table cell: short text written for this list,
// the public pages that support it, and the day they were read. unverified: true when the makers'
// and platforms' own pages don't confirm it (shown as [U]); the claim then says what is known.
const factFields = {
  text: Text.max(240).describe("The claim, written for this list."),
  sources: z.array(Link).min(1).describe("Public pages that support the claim."),
  checked_on: Day.describe("The day the sources were read."),
  unverified: z.literal(true).optional().describe("True when the makers' and platforms' own pages don't confirm it. The text then says what is known."),
};
const valued = <T extends z.ZodType>(value: T) => z.strictObject({ value, ...factFields });

export const LicenceModel = z.enum(["royalty-free", "patent-pools", "open-spec", "open-code", "proprietary"]).describe("How it may be used, as its licensors describe it: royalty-free patent licences, patent pools, an open spec, open-source code without a separate spec, or a proprietary SDK. Not legal advice.");
export const Support = z.enum(["yes", "some", "no", "unknown"]).describe("yes. some: only some models, versions or modes. no: listed as unsupported, or only other options are listed. unknown: nothing public says either way.");
export const Ingest = z.strictObject({ twitch: valued(Support), youtube: valued(Support), kick: valued(Support) }).describe("Ingest on the big platforms, from their own help pages (or OBS's services.json where a page needs JavaScript).");
export const HardwareSupport = z.strictObject({ encode: Support, decode: Support, ...factFields }).describe("Hardware encode and decode on this kind of gear, from the chip or platform maker's docs.");
export const Hardware = z.strictObject({
  ios: HardwareSupport, android: HardwareSupport, rk3588: HardwareSupport,
  intel: HardwareSupport, nvidia: HardwareSupport, apple_mac: HardwareSupport,
});

/** Codec comparison. efficiency comes only from a published comparison against the codecs in
 *  compared_with (ids of other codec entries); null when none is listed. Audio has no hardware row. */
export const CodecFacts = z.strictObject({
  media: z.enum(["video", "audio"]).describe("video or audio."),
  licensing: valued(LicenceModel).describe("How it may be used."),
  efficiency: z.strictObject({ compared_with: z.array(Id).min(1), ...factFields }).nullable().describe("Efficiency, only from a published comparison with the codecs in compared_with. Null when none is listed."),
  hardware: Hardware.nullable().describe("Hardware encode and decode on common IRL gear. Null for audio."),
  ingest: Ingest.describe("Ingest on Twitch, YouTube and Kick."),
});
/** Transport comparison. bonding: built into the protocol, through an add-on protocol, or not at all.
 *  latency: a receive buffer you set, real-time by design, or whatever TCP gives (no buffer setting).
 *  loss_recovery: resends, resends plus forward error correction, or TCP's own resends. */
export const TransportFacts = z.strictObject({
  bonding: valued(z.enum(["built-in", "add-on", "no"])).describe("Bonding: built into the protocol, through an add-on protocol, or not at all."),
  latency: valued(z.enum(["buffer", "real-time", "tcp"])).describe("Latency: a receive buffer you set, real-time by design, or whatever TCP gives."),
  loss_recovery: valued(z.enum(["resend", "resend-and-fec", "tcp"])).describe("Loss recovery: resends, resends plus error correction, or TCP's own resends."),
  licensing: valued(LicenceModel).describe("How it may be used."),
  ingest: Ingest.describe("Ingest on Twitch, YouTube and Kick."),
});

export const Standard = z.strictObject({
  id: Id.describe("Permanent id, used as an anchor and in links from other files."),
  checked_on: Day.describe("The day the entry was compared with its public source."),
  name: Text.describe("The name as the maker writes it."),
  group: StandardGroup,
  kind: StandardKind,
  status: z.enum(["in-use", "proposed"]).describe("in-use, or proposed."),
  openness: Openness,
  licence: Text.nullable().describe("A short licence line. Null when codec or transport facts carry the licensing."),
  maker: Text.describe("Who makes or maintains it. The credit belongs to them, not to this list."),
  url: HttpsUrl.nullable().describe("The page that best describes it, the maker's own where one exists. Null only when not public."),
  description: Text.max(200).optional().describe("One line written for this list. Left out when word is set."),
  word: Id.optional().describe("The words.json id of the same thing, when it is also a glossary word. Equal to this entry's id; the glossary explanation is used instead of a description."),
  service_ids: z.array(Id).describe("Catalogued products that write or read it, as service ids."),
  other_users: z.array(Text).describe("Named products that write or read it but are not in services.json."),
  sources: z.array(Link).describe("Public sources for the claims. Empty only when not public."),
  notes: Text.nullable().describe("Anything else worth knowing, or null."),
  codec: CodecFacts.optional().describe("Comparison facts, for codecs."),
  transport: TransportFacts.optional().describe("Comparison facts, for transport protocols."),
}).superRefine((x, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if ((x.description === undefined) === (x.word === undefined))
    issue("description", "give either description or word (a glossary word's definition is not repeated here)");
  if (x.word !== undefined && x.word !== x.id) issue("word", "a glossary word shares the entry's id");
  if ((x.codec || x.transport) && x.licence !== null) issue("licence", "null when codec or transport facts carry the licensing");
  if (x.codec && x.kind !== "codec") issue("codec", "codec facts need kind codec");
  if (x.transport && x.kind !== "protocol") issue("transport", "transport facts need kind protocol");
  if (["codec", "interface"].includes(x.kind) !== (x.group === "hardware-codecs"))
    issue("group", "codecs and hardware interfaces, and only they, sit in hardware-codecs");
  if (x.codec && (x.codec.media === "video") !== (x.codec.hardware !== null))
    issue("codec", "a video codec has hardware facts; an audio codec has hardware null");
}).meta({
  // The same rules for JSON Schema validators (zod refinements are not exported).
  allOf: [
    { oneOf: [{ required: ["description"] }, { required: ["word"] }] },
    { if: { anyOf: [{ required: ["codec"] }, { required: ["transport"] }] }, then: { properties: { licence: { type: "null" } } } },
    { if: { required: ["codec"] }, then: { properties: { kind: { const: "codec" } } } },
    { if: { required: ["transport"] }, then: { properties: { kind: { const: "protocol" } } } },
    { if: { properties: { kind: { enum: ["codec", "interface"] } } }, then: { properties: { group: { const: "hardware-codecs" } } },
      else: { properties: { group: { not: { const: "hardware-codecs" } } } } },
    { if: { required: ["codec"], properties: { codec: { properties: { media: { const: "video" } } } } },
      then: { properties: { codec: { properties: { hardware: { type: "object" } } } } } },
    { if: { required: ["codec"], properties: { codec: { properties: { media: { const: "audio" } } } } },
      then: { properties: { codec: { properties: { hardware: { type: "null" } } } } } },
  ],
});

export const StandardsFile = z.strictObject({
  about: Text.describe("What this file holds, in a sentence or two, with a link to the docs."),
  standards: z.array(Standard).min(1),
});

export const files = {
  plans: PlansFile,
  words: WordsFile,
  answers: AnswersFile,
  services: ServicesFile,
  guides: GuidesFile,
  standards: StandardsFile,
} as const;
export type FileName = keyof typeof files;
