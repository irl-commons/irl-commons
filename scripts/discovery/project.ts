// What the project already answers: glossary names, quick checks, guides and products,
// turned into plain matchers. Read-only: nothing here writes to data/.
import { readFileSync } from "node:fs";
import { ANSWER_HINTS, GENERIC_NAMES, PRODUCT_ALIASES, PRODUCT_NAME_SKIP, type Part } from "./config.ts";

export type Data = { words: any; answers: any; guides: any; services: any };

export function loadData(root = new URL("../../data/", import.meta.url)): Data {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, root), "utf8"));
  return { words: read("words"), answers: read("answers"), guides: read("guides"), services: read("services") };
}

/** A case-insensitive phrase pattern that only matches whole words; spaces and dashes are interchangeable. */
export function phrase(name: string): RegExp {
  const body = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]+");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "i");
}

export type NameMatcher = { id: string; name: string; re: RegExp; generic: boolean };

export type Index = {
  words: NameMatcher[];
  products: NameMatcher[];
  answers: { id: string; question: string; words: string[]; services: string[]; hints: RegExp[]; tokens: Set<string> }[];
  guides: { id: string; url: string; covers: string[]; part: Part[]; kind: string; words: string[]; answers: string[]; checked_on: string }[];
  repoProduct: Map<string, string>;
  knownUrls: Map<string, string>;
  serviceName: Map<string, string>;
};

const STOP = new Set(("a an and are as at be but by can do does for from get got has have how i if in into is it its just my no not of on or " +
  "so that the their them then there this to up use using was what when where which while who why will with you your one").split(" "));

/** Content words for overlap matching: lowercase, no stop words, a crude singular. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9.+]*[a-z0-9]|[a-z0-9]/g) ?? []) {
    if (STOP.has(raw) || raw.length < 3) continue;
    out.add(raw.replace(/(ies)$/, "y").replace(/(?<![s])s$/, ""));
  }
  return out;
}

/** Strip query noise and trailing slashes so the same page compares equal. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const keep = u.hostname.endsWith("youtube.com") ? ["v", "list"] : u.hostname === "irlhosting.com" ? ["rp"] : [];
    for (const k of [...u.searchParams.keys()]) if (!keep.includes(k)) u.searchParams.delete(k);
    if (u.hostname === "youtu.be") return `https://youtube.com/watch?v=${u.pathname.slice(1)}`;
    return (u.origin + u.pathname.replace(/\/+$/, "") + (u.search || "")).toLowerCase();
  } catch { return url.toLowerCase(); }
}

export function buildIndex(d: Data): Index {
  const words: NameMatcher[] = [];
  for (const w of d.words.words) {
    const names = new Set<string>([w.term, ...w.also_called, ...w.search_terms, ...(w.naming ? [w.naming.label, ...w.naming.alternatives.map((a: any) => a.term)] : [])]);
    for (const name of names) words.push({ id: w.id, name, re: phrase(name), generic: GENERIC_NAMES.has(name.toLowerCase()) });
  }
  const products: NameMatcher[] = [];
  const serviceName = new Map<string, string>();
  for (const s of d.services.services) {
    serviceName.set(s.id, s.name);
    if (s.class === "docs") continue;
    for (const name of new Set([s.name, ...(PRODUCT_ALIASES[s.id] ?? [])])) {
      if (PRODUCT_NAME_SKIP.has(name.toLowerCase())) continue;
      products.push({ id: s.id, name, re: phrase(name), generic: false });
    }
  }
  // The longest names first, so "OBS Blade" wins over "OBS".
  products.sort((a, b) => b.name.length - a.name.length);
  const answers = d.answers.answers.map((a: any) => ({
    id: a.id, question: a.question, words: a.words, services: a.services,
    hints: (ANSWER_HINTS[a.id] ?? []).map((h) => new RegExp(h, "i")),
    tokens: tokens(`${a.question} ${a.summary}`),
  }));
  const guides = d.guides.guides.map((g: any) => ({ id: g.id, url: g.url, covers: g.covers, part: g.part, kind: g.kind, words: g.words, answers: g.answers, checked_on: g.checked_on }));
  const repoProduct = new Map<string, string>();
  const knownUrls = new Map<string, string>();
  for (const g of d.guides.guides) knownUrls.set(normalizeUrl(g.url), `guides/${g.id}`);
  for (const s of d.services.services) {
    for (const url of [s.url, ...s.links.map((l: any) => l.url), ...s.support.map((l: any) => l.url)]) {
      const m = url.match(/^https:\/\/github\.com\/([^/#?]+)\/([^/#?]+)/);
      if (m && s.class !== "docs" && !repoProduct.has(`${m[1]}/${m[2]}`.toLowerCase())) repoProduct.set(`${m[1]}/${m[2]}`.toLowerCase(), s.id);
      if (!knownUrls.has(normalizeUrl(url))) knownUrls.set(normalizeUrl(url), `services/${s.id}`);
    }
  }
  return { words, products, answers, guides, repoProduct, knownUrls, serviceName };
}

/** GitHub repositories linked from services.json, as owner/name. */
export function linkedRepos(d: Data): string[] {
  const out = new Map<string, string>();
  for (const s of d.services.services)
    for (const url of [s.url, ...s.links.map((l: any) => l.url), ...s.support.map((l: any) => l.url)]) {
      const m = url.match(/^https:\/\/github\.com\/([^/#?]+)\/([^/#?]+)/);
      if (m) { const repo = `${m[1]}/${m[2].replace(/\.git$/, "")}`; out.set(repo.toLowerCase(), repo); }
    }
  return [...out.values()];
}
