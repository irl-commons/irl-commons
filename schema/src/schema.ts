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

export const files = {
  plans: PlansFile,
  words: WordsFile,
  answers: AnswersFile,
  services: ServicesFile,
  guides: GuidesFile,
} as const;
export type FileName = keyof typeof files;
