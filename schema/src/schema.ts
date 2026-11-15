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
export const Link = z.strictObject({ label: Text, url: HttpsUrl });

// ---------- Words ----------

export const WordL10n = z.strictObject({
  term: Text,
  plain: Text,
  heard_when: z.string().optional(),
});

export const Word = z.strictObject({
  id: Id,
  checked_on: Day.optional(),
  term: Text,
  aliases: z.array(Text),
  tier: z.enum(["core", "more"]),
  who: z.enum(["streamer", "helper", "both"]),
  heard_when: z.string(),
  plain: Text,
  related: z.array(Id),
  source: Text,
  uncertain: z.boolean(),
  l10n: z.record(LanguageTag, WordL10n).optional(),
});

export const WordsFile = z.strictObject({
  about: z.string(),
  words: z.array(Word).min(1),
});

// ---------- Answers (quick checks) ----------

/** Where along the chain a check looks: the camera and mic into the sender,
 *  the sender (app or box), its connections, the receiver, OBS, the platform. */
export const Part = z.enum(["camera", "sender", "connections", "receiver", "obs", "platform"]);

/** One short check in plain words: which part to look at and what to look for.
 *  No product names or product settings; those live in guides and services. */
export const Check = z.strictObject({
  part: Part.optional(),
  text: Text.max(140),
});

export const Answer = z.strictObject({
  id: Id,
  checked_on: Day.optional(),
  question: Text,
  /** Which part most likely broke, in one or two sentences. */
  summary: Text.max(220),
  checks: z.array(Check).min(1).max(3),
  words: z.array(Id),
  /** Products whose own docs and support channels help with this question. */
  services: z.array(Id),
  sources: z.array(Link).min(1),
});

export const AnswersFile = z.strictObject({
  about: z.string(),
  answers: z.array(Answer).min(1),
});

// ---------- Services catalogue ----------

export const ServiceKind = z.enum(["app", "relay", "hub", "hardware", "production", "community"]);
export const Platform = z.enum(["android", "ios", "windows", "macos", "linux", "web", "hardware", "service"]);

/** What a product is for, as a reader picks it: the groups on a link list and the steps of a stack picker.
 *  streaming-app: the app that sends your stream; extra-connections: adds a network path;
 *  camera-capture: brings a camera or screen in; remote-control: runs OBS or the sender from another device;
 *  chat-overlays: chat, alerts, overlays and location; other-app: an app that fits none of these;
 *  relay: relays, receivers and protocols; hub: hosted hubs that go out to the platform;
 *  production: OBS and its tools; hardware: encoders, backpacks and parts; community: docs and wikis. */
export const Role = z.enum([
  "streaming-app", "extra-connections", "camera-capture", "remote-control", "chat-overlays", "other-app",
  "relay", "hub", "production", "hardware", "community",
]);

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
  id: Id,
  checked_on: Day,
  name: Text,
  kind: ServiceKind,
  role: Role,
  maker: Text,
  url: HttpsUrl,
  links: z.array(Link),
  open_source: z.boolean().nullable(),
  licence: Text.nullable(),
  status: Text.nullable(),
  description: Text,
  platforms: z.array(Platform).min(1),
  /** Where along the chain it sits, the main part first. Empty only for community entries. */
  part: z.array(Part).max(3),
  /** For community entries (docs, wikis): the products they document. Empty otherwise. */
  covers: z.array(Id),
  support: z.array(Link),
  tags: z.array(Id),
  words: z.array(Id),
});

export const ServicesFile = z.strictObject({
  about: z.string(),
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
  id: Id,
  checked_on: Day,
  /** The page's own title, as it shows it. */
  title: Text,
  /** Generated by scripts/titles.ts from covers, publisher and part; never written by hand. */
  title_display: Text,
  url: HttpsUrl,
  creator: Text,
  /** The service id of the maker who wrote it, when that maker is one of `covers`. */
  publisher: Id.nullable(),
  language: LanguageTag,
  kind: z.enum(["article", "video"]),
  published: Day.nullable(),
  /** The products the guide is about, as service ids. */
  covers: z.array(Id).min(1),
  /** Where along the chain it helps; the first one decides the title and the group. */
  part: z.array(Part).min(1).max(3),
  words: z.array(Id),
  answers: z.array(Id),
});

export const GuidesFile = z.strictObject({
  about: z.string(),
  guides: z.array(Guide).min(1),
});

// ---------- Carriers and optional plans ----------

export const Plan = z.strictObject({
  id: Id,
  checked_on: Day,
  name: Text,
  data_cap_gb: z.number().nonnegative().nullable(),
  throttle_after_cap_kbps: z.number().nonnegative().nullable(),
  tethering_allowed: z.boolean().nullable(),
  roaming_routing: z.enum(["home-routed", "local-breakout", "unknown"]),
  source_url: HttpsUrl,
});
export const Carrier = z.strictObject({
  id: Id,
  checked_on: Day,
  name: Text,
  country: z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 country code"),
  network_type: z.enum(["MNO", "MVNO"]),
  host_network_id: Id.nullable(),
  esim: z.boolean(),
  official_url: HttpsUrl,
  coverage_map_url: HttpsUrl,
  sources: z.array(Link).min(1),
  plans: z.array(Plan).optional(),
});
export const PlansFile = z.strictObject({
  about: Text,
  carriers: z.array(Carrier),
});

// ---------- Standards (shared formats and protocols) ----------

/** Which list an entry sits in. shared: several makers' products write or read it;
 *  app-formats: one app's own format that a named second product also writes or reads;
 *  hardware-codecs: the codecs and hardware interfaces a stream's picture and sound go through;
 *  steward-projects: made by people who steward this repository, listed apart so
 *  they are never mistaken for established standards. */
export const StandardGroup = z.enum(["shared", "app-formats", "hardware-codecs", "steward-projects"]);
/** protocol: something two programs speak over a network or link; format: a file, URL
 *  or message shape; settings: a setup link or settings file one app imports; data: a dataset;
 *  codec: a way of compressing video or audio; interface: a cable or bus that carries a camera's picture. */
export const StandardKind = z.enum(["protocol", "format", "settings", "data", "codec", "interface"]);
/** open: a public spec, or open-licensed reference code whose docs describe it;
 *  documented-closed: the maker describes it publicly, but the spec is partial or the product closed;
 *  undocumented: no written description, the code (if public) is the only reference;
 *  not-public: not published yet. */
export const Openness = z.enum(["open", "documented-closed", "undocumented", "not-public"]);

// Comparison facts. Each one is a single claim for one table cell: short text written for this list,
// the public pages that support it, and the day they were read. unverified: true when the makers'
// and platforms' own pages don't confirm it (shown as [U]); the claim then says what is known.
const factFields = {
  text: Text.max(240),
  sources: z.array(Link).min(1),
  checked_on: Day,
  unverified: z.literal(true).optional(),
};
const valued = <T extends z.ZodType>(value: T) => z.strictObject({ value, ...factFields });

/** How it may be used, as its licensors describe it: royalty-free patent licences, patent pools,
 *  an open spec, open-source code without a separate spec, or a proprietary SDK. Never legal advice. */
export const LicenceModel = z.enum(["royalty-free", "patent-pools", "open-spec", "open-code", "proprietary"]);
/** yes; some: only some models, versions or modes; no: the platform or maker lists it as unsupported,
 *  or lists only other options; unknown: nothing public says either way. */
export const Support = z.enum(["yes", "some", "no", "unknown"]);
/** Ingest on the big platforms, from their own help pages (or OBS's services.json where a page needs JavaScript). */
export const Ingest = z.strictObject({ twitch: valued(Support), youtube: valued(Support), kick: valued(Support) });
/** Hardware encode and decode on one kind of common IRL gear, from the chip or platform maker's docs. */
export const HardwareSupport = z.strictObject({ encode: Support, decode: Support, ...factFields });
export const Hardware = z.strictObject({
  ios: HardwareSupport, android: HardwareSupport, rk3588: HardwareSupport,
  intel: HardwareSupport, nvidia: HardwareSupport, apple_mac: HardwareSupport,
});

/** Codec comparison. efficiency comes only from a published comparison against the codecs in
 *  compared_with (ids of other codec entries); null when none is listed. Audio has no hardware row. */
export const CodecFacts = z.strictObject({
  media: z.enum(["video", "audio"]),
  licensing: valued(LicenceModel),
  efficiency: z.strictObject({ compared_with: z.array(Id).min(1), ...factFields }).nullable(),
  hardware: Hardware.nullable(),
  ingest: Ingest,
});
/** Transport comparison. bonding: built into the protocol, through an add-on protocol, or not at all.
 *  latency: a receive buffer you set, real-time by design, or whatever TCP gives (no buffer setting).
 *  loss_recovery: resends, resends plus forward error correction, or TCP's own resends. */
export const TransportFacts = z.strictObject({
  bonding: valued(z.enum(["built-in", "add-on", "no"])),
  latency: valued(z.enum(["buffer", "real-time", "tcp"])),
  loss_recovery: valued(z.enum(["resend", "resend-and-fec", "tcp"])),
  licensing: valued(LicenceModel),
  ingest: Ingest,
});

export const Standard = z.strictObject({
  id: Id,
  checked_on: Day,
  name: Text,
  group: StandardGroup,
  kind: StandardKind,
  status: z.enum(["in-use", "proposed"]),
  openness: Openness,
  /** Short licence line. Null when the entry has codec or transport facts: their licensing fact says it once. */
  licence: Text.nullable(),
  /** Who makes or maintains it; the credit belongs to them, not to this catalogue. */
  maker: Text,
  /** The page that best describes it, the maker's own where one exists. Null only when not public. */
  url: HttpsUrl.nullable(),
  /** A one-line description written for this list. Left out when `word` is set: the glossary definition is used instead. */
  description: Text.max(200).optional(),
  /** The words.json id of the same thing, when it is also a glossary word. It must equal this entry's id,
   *  and the entry then carries no description of its own. */
  word: Id.optional(),
  /** Catalogued products that write or read it, as service ids. */
  service_ids: z.array(Id),
  /** Named products that write or read it but are not in services.json. */
  other_users: z.array(Text),
  /** Public primary sources for the claims. Empty only when not public. */
  sources: z.array(Link),
  notes: Text.nullable(),
  /** Comparison facts for codecs (kind codec) and transports (kind protocol); the site's tables are generated from them. */
  codec: CodecFacts.optional(),
  transport: TransportFacts.optional(),
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
  about: Text,
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
